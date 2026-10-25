import type { RuleDefinition } from '../types.ts';
import { componentSchemas } from '../../spec/model.ts';
import { isPlainObject, isCamelCase, isSnakeCase, isKebabCase, dominantStyle } from '../../util/text.ts';
import { isRefNode } from '../../spec/ref.ts';

interface RefLocation {
  ref: string;
  path: string;
}

function collectRefLocations(doc: unknown, path = ''): RefLocation[] {
  const out: RefLocation[] = [];
  const visit = (node: unknown, currentPath: string): void => {
    if (isRefNode(node)) {
      out.push({ ref: node.$ref, path: currentPath });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${currentPath}/${index}`));
      return;
    }
    if (isPlainObject(node)) {
      for (const [key, value] of Object.entries(node)) {
        visit(value, `${currentPath}/${key}`);
      }
    }
  };
  visit(doc, path);
  return out;
}

function walkSchema(
  doc: Record<string, unknown>,
  schema: unknown,
  visit: (schema: Record<string, unknown>, pointer: string) => void,
  pointer = '',
  seen: Set<string> = new Set(),
): void {
  if (!isPlainObject(schema)) return;

  if (isRefNode(schema)) {
    // Do not walk into the referenced schema. It is a component of its own
    // and is visited under its own name when componentSchemas() iterates,
    // which keeps every reported pointer reachable in the document. Walking
    // into it would reuse the pointer of the *reference site* and produce
    // paths like "/oneOf/0/required" that resolve to nothing.
    if (seen.has(schema.$ref)) return;
    seen.add(schema.$ref);
    return;
  }

  visit(schema, pointer);

  const properties = schema['properties'];
  if (isPlainObject(properties)) {
    for (const [name, child] of Object.entries(properties)) {
      walkSchema(doc, child, visit, `${pointer}/properties/${name}`, seen);
    }
  }

  const items = schema['items'];
  if (items) walkSchema(doc, items, visit, `${pointer}/items`, seen);

  for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
    const list = schema[keyword];
    if (Array.isArray(list)) {
      list.forEach((sub, index) => walkSchema(doc, sub, visit, `${pointer}/${keyword}/${index}`, seen));
    }
  }
}

function resolveSchemaRef(doc: Record<string, unknown>, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined;
  const tokens = ref.slice(2).split('/');
  let current: unknown = doc;
  for (const token of tokens) {
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
    if (isPlainObject(current)) current = current[key];
    else return undefined;
  }
  return current;
}

const TYPE_LIKE_GROUPS = new Set(['schemas', 'responses', 'parameters', 'requestBodies', 'headers']);

export const componentNamingPascal: RuleDefinition = {
  id: 'component-naming-pascal',
  title: 'Component names follow their group convention',
  description:
    'Schemas, responses and parameters become types in generated code, so they use ' +
    'PascalCase. Security schemes are referenced by name inside security requirements ' +
    'and follow the camelCase convention.',
  severity: 'warn',
  category: 'schemas',
  keywords: ['naming', 'components', 'pascalcase'],
  check({ spec, report }) {
    const components = spec.components;
    for (const group of Object.keys(components)) {
      const entries = components[group];
      if (!isPlainObject(entries)) continue;

      for (const name of Object.keys(entries)) {
        if (group === 'securitySchemes') {
          if (!/^[a-z][a-zA-Z0-9]*$/.test(name)) {
            report({
              message: `Security scheme "${name}" is not camelCase`,
              path: `/components/securitySchemes/${name}`,
              hint: `Rename it to "${name.charAt(0).toLowerCase()}${name.slice(1)}".`,
            });
          }
          continue;
        }

        if (!TYPE_LIKE_GROUPS.has(group)) continue;

        if (!/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
          report({
            message: `Component "${name}" in ${group} is not PascalCase`,
            path: `/components/${group}/${name}`,
            hint: `Rename it to "${name.charAt(0).toUpperCase()}${name.slice(1)}".`,
          });
        }
      }
    }
  },
};

export const componentUnused: RuleDefinition = {
  id: 'component-unused',
  title: 'Components are referenced',
  description:
    'Unused components are dead weight: they are maintained, reviewed and mocked but never ' +
    'returned. They also hide the fact that the intended shape was never wired up.',
  severity: 'info',
  category: 'schemas',
  keywords: ['components', 'dead code', 'hygiene'],
  check({ spec, report }) {
    const locations = collectRefLocations(spec.raw);
    const components = spec.components;

    const securityNames = new Set<string>();
    for (const operation of spec.operations) {
      for (const requirement of operation.security) {
        for (const name of Object.keys(requirement)) securityNames.add(name);
      }
    }

    for (const group of Object.keys(components)) {
      const entries = components[group];
      if (!isPlainObject(entries)) continue;

      for (const name of Object.keys(entries)) {
        const ownPath = `/components/${group}/${name}`;
        const ref = `#/components/${group}/${name}`;
        // A reference "inside" the component must match the whole path
        // segment: "/components/schemas/UserProfile" starts with
        // "/components/schemas/User" as a raw string but is a different
        // component.
        const isInsideOwnSubtree = (p: string): boolean => p === ownPath || p.startsWith(`${ownPath}/`);
        const usedElsewhere = locations.some(
          (location) => location.ref === ref && !isInsideOwnSubtree(location.path),
        );
        const usedBySecurity = group === 'securitySchemes' && securityNames.has(name);
        if (usedElsewhere || usedBySecurity) continue;

        report({
          message: `Component "${name}" in ${group} is never referenced`,
          path: ownPath,
          hint: 'Remove it or reference it from an operation.',
        });
      }
    }
  },
};

export const schemaPropertyNamingConsistency: RuleDefinition = {
  id: 'schema-property-naming-consistency',
  title: 'Property names use one naming style',
  description:
    'Mixing camelCase and snake_case inside one API means every consumer needs a ' +
    'per-field mapping table. Pick one style and apply it everywhere.',
  severity: 'warn',
  category: 'schemas',
  keywords: ['naming', 'consistency', 'casing'],
  check({ spec, report }) {
    const schemas = componentSchemas(spec);
    const properties: Array<{ name: string; pointer: string }> = [];

    for (const [schemaName, schema] of Object.entries(schemas)) {
      walkSchema(
        spec.raw,
        schema,
        (node, pointer) => {
          const props = node['properties'];
          if (!isPlainObject(props)) return;
          for (const name of Object.keys(props)) {
            properties.push({ name, pointer: `/components/schemas/${schemaName}${pointer}/properties/${name}` });
          }
        },
      );
    }

    if (properties.length < 4) return;

    const names = properties.map((property) => property.name);
    const style = dominantStyle(names);
    if (style === 'other') return;

    const matches = (name: string): boolean => {
      if (style === 'camelCase') return isCamelCase(name);
      if (style === 'snake_case') return isSnakeCase(name);
      return isKebabCase(name);
    };

    const compliant = names.filter(matches).length;
    if (compliant / names.length < 0.8) return;

    let reported = 0;
    for (const property of properties) {
      if (matches(property.name)) continue;
      if (reported >= 25) break;
      reported += 1;
      report({
        message: `Property "${property.name}" does not follow the ${style} convention used by the rest of the API`,
        path: property.pointer,
        hint: `Rename it to ${style === 'camelCase' ? 'camelCase' : style}.`,
      });
    }
  },
};

export const schemaNoNullable: RuleDefinition = {
  id: 'schema-no-nullable',
  title: 'OpenAPI 3.1 schemas do not use nullable',
  description:
    'In OpenAPI 3.0 "nullable: true" is the only way to express a null value, so it is ' +
    'correct there and is not reported. In OpenAPI 3.1 the keyword does not exist: the ' +
    'value can never be null, whatever the document intended.',
  severity: 'warn',
  category: 'schemas',
  keywords: ['nullable', 'openapi 3.1', 'null'],
  check({ spec, report }) {
    if (spec.version.startsWith('3.0')) return;

    const schemas = componentSchemas(spec);
    for (const [schemaName, schema] of Object.entries(schemas)) {
      walkSchema(spec.raw, schema, (node, pointer) => {
        if (node['nullable'] !== true) return;
        report({
          message: `Schema "${schemaName}" uses "nullable: true", which OpenAPI 3.1 ignores`,
          path: `/components/schemas/${schemaName}${pointer}`,
          hint: 'Use a type union instead, e.g. "type: [string, \'null\']".',
        });
      });
    }
  },
};

export const schemaArrayItemsRequired: RuleDefinition = {
  id: 'schema-array-items-required',
  title: 'Arrays define their item schema',
  description:
    'An array without "items" carries no type information at all, so clients receive ' +
    'untyped arrays and validators cannot check the contents.',
  severity: 'error',
  category: 'schemas',
  keywords: ['array', 'items', 'schema'],
  check({ spec, report }) {
    const schemas = componentSchemas(spec);
    for (const [schemaName, schema] of Object.entries(schemas)) {
      walkSchema(spec.raw, schema, (node, pointer) => {
        const type = node['type'];
        const isArray = type === 'array' || (Array.isArray(type) && type.includes('array'));
        if (!isArray) return;
        if (node['items']) return;
        report({
          message: `Array in schema "${schemaName}" has no "items" schema`,
          path: `/components/schemas/${schemaName}${pointer}`,
          hint: 'Describe the element type, e.g. "items: { type: string }".',
        });
      });
    }
  },
};

// The properties a schema defines, including the ones contributed by its
// composition keywords. OpenAPI 3.1 documents routinely split them:
// "required" sits on the parent while "properties" lives in an allOf branch.
function definedProperties(doc: Record<string, unknown>, node: unknown, depth = 0): Set<string> {
  const names = new Set<string>();
  if (!isPlainObject(node)) return names;

  const properties = node['properties'];
  if (isPlainObject(properties)) {
    for (const name of Object.keys(properties)) names.add(name);
  }

  if (depth >= 4) return names;
  for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
    const list = node[keyword];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const target = isRefNode(entry) ? resolveSchemaRef(doc, entry.$ref) : entry;
      for (const name of definedProperties(doc, target, depth + 1)) names.add(name);
    }
  }
  return names;
}

export const schemaRequiredPropertyDefined: RuleDefinition = {
  id: 'schema-required-property-defined',
  title: 'Required properties exist',
  description:
    'Listing a property as required that is not defined in "properties" is contradictory: ' +
    'the value can never be validated and the schema is rejected by strict validators.',
  severity: 'error',
  category: 'schemas',
  keywords: ['required', 'schema', 'consistency'],
  check({ spec, report }) {
    const schemas = componentSchemas(spec);
    for (const [schemaName, schema] of Object.entries(schemas)) {
      walkSchema(spec.raw, schema, (node, pointer) => {
        const reported = new Set<string>();
        const check = (required: unknown, where: string, available: Set<string>): void => {
          if (!Array.isArray(required)) return;
          for (const name of required) {
            if (typeof name !== 'string') continue;
            if (available.has(name)) continue;
            const seen = `${where}:${name}`;
            if (reported.has(seen)) continue;
            reported.add(seen);
            report({
              message: `Schema "${schemaName}" requires "${name}" but does not define it`,
              path: `/components/schemas/${schemaName}${where}/required`,
              hint: `Add "${name}" to "properties" or remove it from "required".`,
            });
          }
        };

        const own = definedProperties(spec.raw, node);
        // A node that is itself an allOf branch is judged by its parent,
        // which pools the properties of every branch. Checking it here
        // would miss the properties a sibling branch contributes.
        if (!/\/allOf\/\d+$/.test(pointer)) check(node['required'], pointer, own);

        // Branches of an allOf describe one object: "required" may sit in
        // one branch while "properties" sits in a sibling one.
        const branches = Array.isArray(node['allOf']) ? node['allOf'] : [];
        for (const [index, branch] of branches.entries()) {
          const target = isRefNode(branch) ? resolveSchemaRef(spec.raw, branch.$ref) : branch;
          if (!isPlainObject(target)) continue;
          const pooled = new Set([...own, ...definedProperties(spec.raw, target)]);
          check(target['required'], `${pointer}/allOf/${index}`, pooled);
        }
      });
    }
  },
};

export const schemaExampleRecommended: RuleDefinition = {
  id: 'schema-example-recommended',
  title: 'Component schemas provide an example',
  description:
    'Examples are the fastest way to communicate the intended payload, and they let the ' +
    'mock server answer with a realistic body without extra configuration.',
  severity: 'info',
  category: 'schemas',
  keywords: ['example', 'documentation', 'mock'],
  check({ spec, report }) {
    const schemas = componentSchemas(spec);
    for (const [schemaName, schema] of Object.entries(schemas)) {

      if (!isPlainObject(schema)) continue;
      if (schema['example'] !== undefined) continue;
      if (schema['examples'] !== undefined) continue;
      report({
        message: `Schema "${schemaName}" has no example`,
        path: `/components/schemas/${schemaName}`,
        hint: 'Add an "example" block to make the contract concrete.',
      });
    }
  },
};

export const schemaRules = [
  componentNamingPascal,
  componentUnused,
  schemaPropertyNamingConsistency,
  schemaNoNullable,
  schemaArrayItemsRequired,
  schemaRequiredPropertyDefined,
  schemaExampleRecommended,
];
