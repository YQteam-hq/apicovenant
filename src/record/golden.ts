import { isPlainObject } from '../util/text.ts';

export const GOLDEN_FORMAT_VERSION = 1;

/**
 * A query key may repeat ("?tag=a&tag=b"). Storing the values in an array keeps
 * both the replayed request and the interaction key faithful to the recording;
 * collapsing them into one string silently dropped a value.
 */
export type QueryValue = string | string[];
export type QueryParams = Record<string, QueryValue>;

export interface GoldenInteraction {
  method: string;

  path: string;

  query: QueryParams;
  requestHeaders: Record<string, string>;
  status: number;
  responseHeaders: Record<string, string>;

  body: string;

  bodyType: 'json' | 'text' | 'empty';

  durationMs: number;
}

export interface GoldenFile {

  apicovenant: number;

  recordedAt: string;

  target: string;

  spec?: string;
  interactions: GoldenInteraction[];
}

export function createGoldenFile(target: string, spec?: string): GoldenFile {
  return {
    apicovenant: GOLDEN_FORMAT_VERSION,
    recordedAt: new Date().toISOString(),
    target,
    spec,
    interactions: [],
  };
}

export function parseGoldenFile(text: string): GoldenFile {
  // Some editors write a UTF-8 BOM; JSON.parse rejects it.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`golden file is not valid JSON: ${(error as Error).message}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('golden file must contain a JSON object');
  }

  const file = parsed as Partial<GoldenFile>;
  if (!Array.isArray(file.interactions)) {
    throw new Error('golden file is missing an "interactions" array');
  }
  if (file.apicovenant !== GOLDEN_FORMAT_VERSION) {
    throw new Error(
      `unsupported golden file format version ${String(file.apicovenant)} (expected ${GOLDEN_FORMAT_VERSION})`,
    );
  }

  return {
    apicovenant: GOLDEN_FORMAT_VERSION,
    recordedAt: typeof file.recordedAt === 'string' ? file.recordedAt : new Date().toISOString(),
    target: typeof file.target === 'string' ? file.target : '',
    spec: typeof file.spec === 'string' ? file.spec : undefined,
    interactions: file.interactions.map((entry, index) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        throw new Error(`golden file: interactions[${index}] must be an object`);
      }
      return {
        method: String(entry.method ?? 'GET').toUpperCase(),
        path: String(entry.path ?? '/'),
        query: normalizeQuery(entry.query),
        requestHeaders: entry.requestHeaders ?? {},
        status: Number(entry.status ?? 0),
        responseHeaders: entry.responseHeaders ?? {},
        body: typeof entry.body === 'string' ? entry.body : '',
        bodyType: entry.bodyType ?? 'text',
        durationMs: Number(entry.durationMs ?? 0),
      };
    }),
  };
}

function normalizeQuery(raw: unknown): QueryParams {
  const out: QueryParams = {};
  if (!isPlainObject(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') out[key] = value;
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = String(value);
    else if (Array.isArray(value)) out[key] = value.map((item) => String(item));
  }
  return out;
}

export function serializeGoldenFile(file: GoldenFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function interactionKey(interaction: { method: string; path: string; query?: QueryParams }): string {
  const parts: string[] = [];
  const query = interaction.query ?? {};
  for (const key of Object.keys(query).sort()) {
    const value = query[key];
    for (const item of Array.isArray(value) ? value : [value as string]) {
      parts.push(`${key}=${item}`);
    }
  }
  const serialised = parts.join('&');
  return serialised
    ? `${interaction.method} ${interaction.path}?${serialised}`
    : `${interaction.method} ${interaction.path}`;
}
