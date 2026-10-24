import { pointer } from '../util/json-pointer.ts';
import { isPlainObject } from '../util/text.ts';

export type DifferenceKind = 'added' | 'removed' | 'changed';

export interface BodyDifference {

  path: string;
  kind: DifferenceKind;
  before?: unknown;
  after?: unknown;
}

function preview(value: unknown): unknown {
  if (typeof value === 'string') return value.length > 120 ? `${value.slice(0, 117)}...` : value;
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (isPlainObject(value)) return `{${Object.keys(value).length} keys}`;
  return value;
}

export function diffJson(before: unknown, after: unknown, basePath = ''): BodyDifference[] {
  const differences: BodyDifference[] = [];

  const beforeIsObject = isPlainObject(before);
  const afterIsObject = isPlainObject(after);

  if (beforeIsObject && afterIsObject) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...keys].sort()) {
      const childPath = pointer(key);
      const fullPath = basePath + childPath;
      if (!(key in before)) {
        differences.push({ path: fullPath, kind: 'added', after: preview(after[key]) });
        continue;
      }
      if (!(key in after)) {
        differences.push({ path: fullPath, kind: 'removed', before: preview(before[key]) });
        continue;
      }
      differences.push(...diffJson(before[key], after[key], fullPath));
    }
    return differences;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const shared = Math.min(before.length, after.length);
    const differences: BodyDifference[] = [];
    for (let index = 0; index < shared; index += 1) {
      differences.push(...diffJson(before[index], after[index], `${basePath}${pointer(index)}`));
    }
    if (before.length > after.length) {
      differences.push({
        path: `${basePath}${pointer(after.length)}`,
        kind: 'removed',
        before: preview(before.slice(after.length)),
      });
    } else if (after.length > before.length) {
      differences.push({
        path: `${basePath}${pointer(before.length)}`,
        kind: 'added',
        after: preview(after.slice(before.length)),
      });
    }

    // Arrays that only changed order (same multiset of items, same length) are
    // reported as one reorder instead of a cascade of positional diffs.
    if (before.length === after.length && differences.length > 0) {
      const beforeItems = before.map(normalizeForCompare).sort();
      const afterItems = after.map(normalizeForCompare).sort();
      const sameItems = beforeItems.every((item, index) => item === afterItems[index]);
      if (sameItems) {
        differences.length = 0;
        differences.push({
          path: basePath || '/',
          kind: 'changed',
          before: '[reordered]',
          after: '[reordered]',
        });
      }
    }

    return differences;
  }

  if (before === after) return differences;

  if (typeof before === 'object' || typeof after === 'object') {
    differences.push({ path: basePath || '/', kind: 'changed', before: preview(before), after: preview(after) });
    return differences;
  }

  differences.push({ path: basePath || '/', kind: 'changed', before: preview(before), after: preview(after) });
  return differences;
}

export function parseBody(body: string, bodyType: string): unknown {
  if (bodyType === 'empty' || body.trim() === '') return undefined;
  if (bodyType !== 'json') return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

// Key-order-insensitive serialisation so two structurally equal objects hash
// identically when comparing array items as a multiset.
function normalizeForCompare(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(normalizeForCompare).join(',')}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${normalizeForCompare(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
