import type { ApiSpec } from '../spec/model.ts';
import { HTTP_METHODS } from '../spec/model.ts';
import { isPlainObject } from '../util/text.ts';

export interface FixChange {
  ruleId: string;
  path: string;
  message: string;
}

export interface FixResult {
  text: string;
  changes: FixChange[];
}

export interface FixOptions {
  /** `operation-id-naming` may break generated clients, so it is opt-in. */
  aggressive?: boolean;
}

function camelCase(value: string): string {
  const words = value.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 0);
  if (words.length < 2) return value;
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index === 0) return lower;
      return `${lower.slice(0, 1).toUpperCase()}${lower.slice(1)}`;
    })
    .join('');
}

function isJsonDocument(text: string): boolean {
  return /^\s*[{[]/.test(text);
}

function fixJson(text: string, spec: ApiSpec, options: FixOptions): FixResult {
  const data = JSON.parse(text) as Record<string, unknown>;
  const changes: FixChange[] = [];
  const paths = isPlainObject(data['paths']) ? (data['paths'] as Record<string, unknown>) : undefined;
  const trailing = spec.paths
    .map((path) => path.path)
    .filter((path) => path.length > 1 && path.endsWith('/'));

  if (paths) {
    for (const path of trailing) {
      const without = path.replace(/\/+$/, '');
      if (!(path in paths) || without in paths) continue;
      paths[without] = paths[path];
      delete paths[path];
      changes.push({
        ruleId: 'path-no-trailing-slash',
        path: `#/paths/${path}`,
        message: `renamed path "${path}" to "${without}"`,
      });
    }
  }

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry);
      return;
    }
    if (!isPlainObject(node)) return;
    const object = node as Record<string, unknown>;
    if (object['nullable'] === true && object['type'] !== undefined) {
      const type = object['type'];
      if (typeof type === 'string') {
        object['type'] = [type, 'null'];
        delete object['nullable'];
        changes.push({
          ruleId: 'schema-no-nullable',
          path: '#',
          message: 'replaced nullable with a "null" type entry',
        });
      } else if (Array.isArray(type) && !type.includes('null')) {
        object['type'] = [...type, 'null'];
        delete object['nullable'];
        changes.push({
          ruleId: 'schema-no-nullable',
          path: '#',
          message: 'added "null" to the type list and removed nullable',
        });
      }
    }
    for (const value of Object.values(object)) visit(value);
  };
  if (spec.version.startsWith('3.1')) visit(data);

  if (options.aggressive && paths) {
    for (const item of Object.values(paths)) {
      if (!isPlainObject(item)) continue;
      for (const method of HTTP_METHODS) {
        const operation = (item as Record<string, unknown>)[method];
        if (!isPlainObject(operation)) continue;
        const id = (operation as Record<string, unknown>)['operationId'];
        if (typeof id !== 'string') continue;
        const fixed = camelCase(id);
        if (fixed !== id) {
          (operation as Record<string, unknown>)['operationId'] = fixed;
          changes.push({
            ruleId: 'operation-id-naming',
            path: '#/paths',
            message: `renamed operationId "${id}" to "${fixed}"`,
          });
        }
      }
    }
  }

  if (changes.length === 0) return { text, changes };
  const indentMatch = /\n([ \t]+)"/.exec(text);
  const indent = indentMatch?.[1] ?? '  ';
  const newline = text.endsWith('\n') ? '\n' : '';
  return { text: `${JSON.stringify(data, null, indent)}${newline}`, changes };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replacePathKey(text: string, path: string): { text: string; changed: boolean } {
  const without = path.replace(/\/+$/, '');
  let changed = false;
  let result = text;

  const variants: Array<[string, string]> = [
    [`"${path}"`, `"${without}"`],
    [`'${path}'`, `'${without}'`],
  ];
  for (const [from, to] of variants) {
    const pattern = new RegExp(`(^|\\n)([ \\t]*)${escapeRegExp(from)}([ \\t]*:)`, 'g');
    const next = result.replace(pattern, (_match, start: string, indent: string, colon: string) => {
      changed = true;
      return `${start}${indent}${to}${colon}`;
    });
    result = next;
  }

  const unquoted = new RegExp(`(^|\\n)([ \\t]*)${escapeRegExp(path)}([ \\t]*:)`, 'g');
  result = result.replace(unquoted, (_match, start: string, indent: string, colon: string) => {
    changed = true;
    return `${start}${indent}${without}${colon}`;
  });
  return { text: result, changed };
}

function fixYaml(text: string, spec: ApiSpec, options: FixOptions): FixResult {
  const changes: FixChange[] = [];
  let result = text;

  for (const path of spec.paths.map((entry) => entry.path)) {
    if (path.length <= 1 || !path.endsWith('/')) continue;
    const replaced = replacePathKey(result, path);
    if (replaced.changed) {
      result = replaced.text;
      changes.push({
        ruleId: 'path-no-trailing-slash',
        path: `#/paths/${path}`,
        message: `renamed path "${path}" to "${path.replace(/\/+$/, '')}"`,
      });
    }
  }

  if (spec.version.startsWith('3.1')) {
    const lines = result.split('\n');
    for (let index = 0; index < lines.length - 1; index += 1) {
      const typeLine = lines[index] as string;
      const nullableLine = lines[index + 1] as string;
      const typeMatch = /^([ \t]*)type:[ \t]*(\S(?:.*?\S)?)[ \t]*$/.exec(typeLine);
      const nullableMatch = /^([ \t]*)nullable:[ \t]*true[ \t]*$/.exec(nullableLine);
      if (!typeMatch || !nullableMatch || typeMatch[1] !== nullableMatch[1]) continue;
      const value = typeMatch[2] as string;
      if (value.includes('#')) continue;
      const type =
        value.startsWith('[') && value.endsWith(']')
          ? `${value.slice(0, -1).trimEnd()}, "null"]`
          : `[${value}, "null"]`;
      lines[index] = `${typeMatch[1]}type: ${type}`;
      lines.splice(index + 1, 1);
      changes.push({
        ruleId: 'schema-no-nullable',
        path: '#',
        message: 'replaced nullable with a "null" type entry',
      });
      index -= 1;
    }
    result = lines.join('\n');
  }

  if (options.aggressive) {
    result = result.replace(
      /^([ \t]*operationId:[ \t]*)(["']?)([A-Za-z0-9_.-]+)\2[ \t]*$/gm,
      (match, prefix: string, quote: string, value: string) => {
        const fixed = camelCase(value);
        if (fixed === value) return match;
        changes.push({
          ruleId: 'operation-id-naming',
          path: '#/paths',
          message: `renamed operationId "${value}" to "${fixed}"`,
        });
        return `${prefix}${quote}${fixed}${quote}`;
      },
    );
  }

  return { text: result, changes };
}

/**
 * Applies the mechanical, low-risk subset of lint fixes. Semantic rules are
 * never rewritten: the caller can review the returned text as a unified diff.
 */
export function applyFixes(text: string, spec: ApiSpec, options: FixOptions = {}): FixResult {
  return isJsonDocument(text) ? fixJson(text, spec, options) : fixYaml(text, spec, options);
}
