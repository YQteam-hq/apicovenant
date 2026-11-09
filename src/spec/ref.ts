import { isPlainObject } from '../util/text.ts';

export interface DerefOptions {

  maxDepth?: number;

  /** Resolve only a top-level reference and leave nested values untouched. */
  shallow?: boolean;
}

export function resolveLocalRef(doc: unknown, ref: string): unknown {
  if (ref === '#' || ref === '#/') return doc;
  if (!ref.startsWith('#/')) {
    if (ref.startsWith('#')) {
      // A "#"-prefixed reference that is neither "#" nor "#/..." is a
      // malformed JSON Pointer.
      throw new Error(`Invalid local reference "${ref}": expected "#" or "#/..."`);
    }
    // External references (e.g. "common.yaml#/components/schemas/Foo") are
    // valid OpenAPI but out of scope for this tool. Report them as
    // unresolved instead of throwing: every caller already degrades
    // gracefully when resolution yields undefined.
    return undefined;
  }

  const tokens = ref
    .slice(2)
    .split('/')
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));

  let current: unknown = doc;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      current = current[Number(token)];
    } else if (isPlainObject(current)) {
      current = current[token];
    } else {
      return undefined;
    }
    if (current === undefined) return undefined;
  }
  return current;
}

export function isRefNode(node: unknown): node is { $ref: string } {
  return isPlainObject(node) && typeof node['$ref'] === 'string';
}

function dynamicRefOf(node: unknown): string | undefined {
  if (!isPlainObject(node)) return undefined;
  const value = node['$dynamicRef'];
  return typeof value === 'string' ? value : undefined;
}

export function deref(doc: unknown, node: unknown, options: DerefOptions = {}): unknown {
  const maxDepth = options.maxDepth ?? 40;
  const seen = new Set<string>();

  const walk = (current: unknown, depth: number): unknown => {
    if (depth > maxDepth) return current;

    const ref = isRefNode(current) ? current.$ref : dynamicRefOf(current);
    if (ref !== undefined) {
      if (seen.has(ref)) return current;
      let resolved: unknown;
      try {
        resolved = resolveLocalRef(doc, ref);
      } catch {
        // "$dynamicRef": "#anchor" is a dynamic anchor, not a JSON Pointer;
        // without the caller's dynamic scope it cannot be resolved safely.
        return current;
      }
      if (resolved === undefined) return current;
      if (options.shallow) return resolved;
      seen.add(ref);
      const expanded = walk(resolved, depth + 1);
      seen.delete(ref);
      return expanded;
    }

    if (options.shallow) return current;
    if (Array.isArray(current)) return current.map((item) => walk(item, depth + 1));

    if (isPlainObject(current)) {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(current)) {
        out[key] = walk(value, depth + 1);
      }
      return out;
    }

    return current;
  };

  return walk(node, 0);
}

export function followRef(doc: unknown, node: unknown, maxHops = 20): unknown {
  let current = node;
  for (let i = 0; i < maxHops; i += 1) {
    if (!isRefNode(current)) return current;
    const resolved = resolveLocalRef(doc, current.$ref);
    if (resolved === undefined) return current;
    current = resolved;
  }
  return current;
}

/**
 * Maps whose keys are user-chosen names (schema properties, component names,
 * header names). A key called "example" or "default" inside one of them is
 * still a schema or object, not a data value.
 */
const NAME_MAP_KEYS = new Set([
  'properties',
  'patternProperties',
  'schemas',
  'definitions',
  '$defs',
  'headers',
  'securitySchemes',
  'responses',
  'requestBodies',
  'callbacks',
  'links',
]);

/**
 * OpenAPI keeps raw payloads next to the structure in "example" / "examples",
 * and a JSON Schema keeps a "default" value. A "$ref" inside such a value is
 * ordinary data, not a reference the document must resolve.
 */
export function isDataContainerKey(key: string, parentKey?: string): boolean {
  if (parentKey !== undefined && NAME_MAP_KEYS.has(parentKey)) return false;
  if (key === 'example' || key === 'examples') return true;
  // Anywhere else "default" is a value. Under "responses" it is a Response
  // Object; that case is covered by NAME_MAP_KEYS above.
  if (key === 'default') return true;
  return false;
}

export function collectRefs(node: unknown, out: Set<string> = new Set<string>()): Set<string> {
  const visit = (current: unknown, parentKey?: string): void => {
    if (isRefNode(current)) {
      out.add(current.$ref);
      return;
    }
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    if (isPlainObject(current)) {
      for (const [key, value] of Object.entries(current)) {
        if (isDataContainerKey(key, parentKey)) continue;
        visit(value, key);
      }
    }
  };
  visit(node);
  return out;
}

export function refName(ref: string): string {
  const parts = ref.split('/');
  return parts[parts.length - 1] ?? ref;
}
