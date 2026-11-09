import type { RuleDefinition } from '../types.ts';
import { componentSchemas, securitySchemes } from '../../spec/model.ts';
import { deref } from '../../spec/ref.ts';
import { validateSchema } from '../../spec/schema.ts';
import { isPlainObject } from '../../util/text.ts';

/**
 * The opt-in rule pack enabled by "extends: [apicovenant:strict]". These rules
 * are intentionally absent from ALL_RULES so the default 43-rule contract and
 * every v1 configuration keep their existing behaviour.
 */
export const STRICT_RULES: RuleDefinition[] = [
  {
    id: 'response-204-no-content',
    title: '204 responses must not declare a body',
    description: 'A 204 response has no content by definition; documenting a body confuses clients and generators.',
    severity: 'error',
    category: 'responses',
    check({ spec, report }) {
      for (const operation of spec.operations) {
        const response = operation.responses.get('204');
        if (response && response.content.size > 0) {
          report({
            message: '204 responses must not declare content',
            path: `${response.pointer}/content`,
            operation: operation.operationId ?? operation.key,
            hint: 'Use 200 (or 202) when a response body is returned.',
          });
        }
      }
    },
  },
  {
    id: 'response-201-location',
    title: '201 responses should return a Location header',
    description: 'A created resource is easier to follow when the response points at it with Location.',
    severity: 'warn',
    category: 'responses',
    check({ spec, report }) {
      for (const operation of spec.operations) {
        const response = operation.responses.get('201');
        if (!response) continue;
        const hasLocation = [...response.headers.keys()].some((name) => name.toLowerCase() === 'location');
        if (!hasLocation) {
          report({
            message: '201 response has no Location header',
            path: `${response.pointer}/headers`,
            operation: operation.operationId ?? operation.key,
            hint: 'Document a Location header that points at the created resource.',
          });
        }
      }
    },
  },
  {
    id: 'schema-example-valid',
    title: 'Component examples must satisfy their schema',
    description: 'An invalid component example is copied into documentation and tests, so it must validate against its own schema.',
    severity: 'error',
    category: 'schemas',
    check({ spec, report }) {
      for (const [name, rawSchema] of Object.entries(componentSchemas(spec))) {
        if (!isPlainObject(rawSchema) || rawSchema['example'] === undefined) continue;
        const schema = deref(spec.raw, rawSchema);
        const violations = validateSchema(rawSchema['example'], schema, { maxErrors: 3 });
        if (violations.length > 0) {
          report({
            message: `example does not satisfy the schema: ${violations[0]?.message ?? 'invalid value'}`,
            path: `#/components/schemas/${name}/example`,
            hint: 'Update the example or the schema so they agree.',
          });
        }
      }
    },
  },
  {
    id: 'parameter-example-valid',
    title: 'Parameter examples must satisfy their schema',
    description: 'Parameter examples are rendered in docs and generated clients; an invalid example teaches the wrong value.',
    severity: 'error',
    category: 'parameters',
    check({ spec, report }) {
      for (const operation of spec.operations) {
        for (const parameter of operation.parameters) {
          if (parameter.example === undefined || parameter.schema === undefined) continue;
          const schema = deref(spec.raw, parameter.schema);
          const violations = validateSchema(parameter.example, schema, { maxErrors: 3 });
          if (violations.length > 0) {
            report({
              message: `example does not satisfy the parameter schema: ${violations[0]?.message ?? 'invalid value'}`,
              path: `${parameter.pointer}/example`,
              operation: operation.operationId ?? operation.key,
              hint: 'Update the example or the schema so they agree.',
            });
          }
        }
      }
    },
  },
  {
    id: 'request-body-json-content-type',
    title: 'JSON request bodies should use application/json',
    description: 'Vendor or text JSON media types force clients to special-case Content-Type; application/json is the interoperable default.',
    severity: 'warn',
    category: 'request-bodies',
    check({ spec, report }) {
      for (const operation of spec.operations) {
        const body = operation.requestBody;
        if (!body) continue;
        for (const contentType of body.content.keys()) {
          const normalized = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
          if (normalized !== 'application/json' && normalized.includes('json')) {
            report({
              message: `JSON request body uses "${contentType}" instead of application/json`,
              path: `${body.pointer}/content/${contentType}`,
              operation: operation.operationId ?? operation.key,
              hint: 'Use application/json unless the vendor media type is part of the contract.',
            });
          }
        }
      }
    },
  },
  {
    id: 'security-https',
    title: 'Security endpoints must use HTTPS',
    description: 'OAuth and OpenID Connect endpoints that use plain HTTP leak authorization codes and tokens.',
    severity: 'warn',
    category: 'security',
    check({ spec, report }) {
      const schemes = securitySchemes(spec);
      for (const [name, scheme] of Object.entries(schemes)) {
        const flows = isPlainObject(scheme['flows']) ? scheme['flows'] : {};
        const urls: Array<[string, unknown]> = [
          ['openIdConnectUrl', scheme['openIdConnectUrl']],
        ];
        for (const [flowName, flow] of Object.entries(flows)) {
          if (!isPlainObject(flow)) continue;
          for (const key of ['authorizationUrl', 'tokenUrl', 'refreshUrl']) {
            urls.push([`flows/${flowName}/${key}`, flow[key]]);
          }
        }
        for (const [suffix, value] of urls) {
          if (typeof value === 'string' && value.startsWith('http://')) {
            report({
              message: `security scheme "${name}" uses plain HTTP: ${value}`,
              path: `#/components/securitySchemes/${name}/${suffix}`,
              hint: 'Serve OAuth and OpenID Connect endpoints over HTTPS.',
            });
          }
        }
      }
    },
  },
];
