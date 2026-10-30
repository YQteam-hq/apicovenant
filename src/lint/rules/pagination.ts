import type { RuleDefinition } from '../types.ts';
import { isPlainObject } from '../../util/text.ts';
import { followRef } from '../../spec/ref.ts';

const OFFSET_PARAMS = ['limit', 'offset', 'page', 'page_size', 'pageSize', 'per_page', 'perPage', 'count'];
const CURSOR_PARAMS = ['cursor', 'after', 'before', 'start_after', 'startAfter', 'next_cursor', 'nextCursor', 'page_token', 'pageToken'];

type Style = 'offset' | 'cursor' | 'none';

function detectStyle(parameterNames: string[]): Style {
  const lowered = parameterNames.map((name) => name.toLowerCase());
  if (lowered.some((name) => CURSOR_PARAMS.includes(name))) return 'cursor';
  if (lowered.some((name) => OFFSET_PARAMS.includes(name))) return 'offset';
  return 'none';
}

function isCollectionPath(path: string): boolean {
  const segments = path.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last || last.startsWith('{')) return false;
  return last.endsWith('s') && !last.endsWith('ss');
}

export const paginationConsistency: RuleDefinition = {
  id: 'pagination-consistency',
  title: 'Collection endpoints paginate consistently',
  description:
    'When one endpoint pages with "limit/offset" and another with "cursor", clients have ' +
    'to implement two pagination strategies. Pick one model for the whole API.',
  severity: 'warn',
  category: 'pagination',
  keywords: ['pagination', 'limit', 'offset', 'cursor', 'consistency'],
  check({ spec, report }) {
    const styles = new Map<string, { style: Style; path: string; operation: string; pointer: string }>();

    for (const operation of spec.operations) {
      if (operation.method !== 'get') continue;
      if (!isCollectionPath(operation.path)) continue;

      const names = operation.parameters.filter((p) => p.in === 'query').map((p) => p.name);
      const style = detectStyle(names);
      if (style === 'none') continue;

      styles.set(operation.key, {
        style,
        path: operation.path,
        operation: operation.key,
        pointer: operation.pointer,
      });
    }

    if (styles.size < 2) return;

    const counts = new Map<Style, number>();
    for (const entry of styles.values()) counts.set(entry.style, (counts.get(entry.style) ?? 0) + 1);
    if (counts.size < 2) return;

    const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!dominant) return;

    for (const entry of styles.values()) {
      if (entry.style === dominant[0]) continue;
      report({
        message: `${entry.operation} paginates with "${entry.style}" while the API mostly uses "${dominant[0]}"`,
        path: entry.pointer,
        operation: entry.operation,
        hint: `Use the same pagination parameters as the rest of the API ("${dominant[0]}").`,
      });
    }
  },
};

export const paginationEnvelope: RuleDefinition = {
  id: 'pagination-envelope',
  title: 'Collection responses use a stable envelope',
  description:
    'A collection response should expose the items and the total count in a predictable ' +
    'shape. Consumers otherwise write a different unwrapping helper for every endpoint.',
  severity: 'warn',
  category: 'pagination',
  keywords: ['pagination', 'envelope', 'collection'],
  check({ spec, report }) {
    for (const operation of spec.operations) {
      if (operation.method !== 'get') continue;
      if (!isCollectionPath(operation.path)) continue;

      const response = [...operation.responses.values()].find((entry) => /^2\d\d$/.test(entry.status));
      if (!response) continue;

      const mediaType = response.content.get('application/json') ?? response.content.values().next().value;
      if (!mediaType?.schema) continue;

      const schema = followRef(spec.raw, mediaType.schema);
      if (!isPlainObject(schema)) continue;

      const type = schema['type'];
      if (type === 'array') continue;

      const properties = isPlainObject(schema['properties']) ? schema['properties'] : {};
      const names = Object.keys(properties);
      if (names.length === 0) continue;

      const arrayProperty = names.find((name) => {
        const child = followRef(spec.raw, properties[name]);
        return isPlainObject(child) && (child['type'] === 'array' || (Array.isArray(child['type']) && child['type'].includes('array')));
      });

      if (!arrayProperty) {
        report({
          message: `Collection response of ${operation.key} has no array property`,
          path: `${response.pointer}/content/${mediaType.contentType}/schema`,
          operation: operation.key,
          hint: 'Expose the collection as "items" (or "data") inside the response object.',
        });
        continue;
      }

      const hasTotal = names.some((name) => /^(total|totalCount|total_count|count)$/i.test(name));
      if (!hasTotal && !usesCursorPagination(operation, names)) {
        report({
          message: `Collection response of ${operation.key} does not expose a total count`,
          path: `${response.pointer}/content/${mediaType.contentType}/schema`,
          operation: operation.key,
          hint: 'Add a "total" property so consumers can render pagination controls.',
        });
      }
    }
  },
};


function usesCursorPagination(
  operation: { parameters: Array<{ name: string; in: string }> },
  responseProperties: string[],
): boolean {
  const cursorParameter = operation.parameters.some(
    (parameter) =>
      parameter.in === 'query' && /^(cursor|starting_?after|after|before|page_?token|next_?cursor|continuation_?token)$/i.test(parameter.name),
  );
  if (cursorParameter) return true;

  return responseProperties.some((name) => /^(has_?more|has_?next|next_?cursor|next_?page_?token|continuation)$/i.test(name));
}

export const paginationRules = [paginationConsistency, paginationEnvelope];
