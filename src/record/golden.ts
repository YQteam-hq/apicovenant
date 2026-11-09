/**
 * Golden format 2 adds multi-value query/response headers, the request body,
 * byte-exact base64 bodies and the "binary" body type. Format 1 files remain
 * readable; they are normalised into the v2 model on load.
 */
export const GOLDEN_FORMAT_VERSION = 2;

/** The oldest format this reader still accepts. */
export const MIN_GOLDEN_FORMAT_VERSION = 1;

/**
 * Bodies are stored as UTF-8 when the bytes round-trip through UTF-8, and as
 * base64 otherwise. Decoding a PNG with toString('utf8') replaces every
 * invalid byte with U+FFFD, which silently destroys the payload.
 */
export type BodyEncoding = 'utf8' | 'base64';

export function encodeBody(buffer: Buffer): { body: string; encoding: BodyEncoding } {
  const text = buffer.toString('utf8');
  if (Buffer.from(text, 'utf8').equals(buffer)) return { body: text, encoding: 'utf8' };
  return { body: buffer.toString('base64'), encoding: 'base64' };
}

export function decodeBody(body: string, encoding?: BodyEncoding): Buffer {
  return encoding === 'base64' ? Buffer.from(body, 'base64') : Buffer.from(body, 'utf8');
}

export type MultiValue = string | string[];
export type QueryParams = Record<string, MultiValue>;

/**
 * A query key may appear more than once (`?tag=a&tag=b`) and a response may
 * carry several Set-Cookie headers. Both used to be collapsed to a single
 * value while recording, so the replay no longer looked like the original
 * request.
 */
export function valuesOf(value: MultiValue | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeStringMap(input: unknown): Record<string, string> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'string') out[name] = value;
    else if (Array.isArray(value)) out[name] = value.filter((item): item is string => typeof item === 'string').join(', ');
  }
  return out;
}

function normalizeMultiValueMap(input: unknown): Record<string, MultiValue> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return {};
  const out: Record<string, MultiValue> = {};
  for (const [name, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'string') out[name] = value;
    else if (Array.isArray(value)) out[name] = value.filter((item): item is string => typeof item === 'string');
    else if (typeof value === 'number' || typeof value === 'boolean') out[name] = String(value);
  }
  return out;
}

export interface GoldenInteraction {
  method: string;

  path: string;

  query: Record<string, MultiValue>;
  requestHeaders: Record<string, string>;
  status: number;
  responseHeaders: Record<string, MultiValue>;

  body: string;

  bodyType: 'json' | 'text' | 'empty' | 'binary';

  bodyEncoding?: BodyEncoding;

  requestBody?: string;

  requestBodyEncoding?: BodyEncoding;

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
  // v1 files are read as v2: the omitted fields have v1 defaults (single
  // valued maps, UTF-8 bodies, no request body).
  if (
    file.apicovenant !== 1 &&
    file.apicovenant !== GOLDEN_FORMAT_VERSION
  ) {
    throw new Error(
      `unsupported golden file format version ${String(file.apicovenant)} ` +
        `(expected ${MIN_GOLDEN_FORMAT_VERSION} or ${GOLDEN_FORMAT_VERSION})`,
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
      const bodyEncoding = entry.bodyEncoding === 'base64' ? 'base64' : undefined;
      const declaredType = entry.bodyType;
      const body = typeof entry.body === 'string' ? entry.body : '';
      const bodyType: GoldenInteraction['bodyType'] =
        bodyEncoding === 'base64'
          ? 'binary'
          : declaredType === 'json' || declaredType === 'empty' || declaredType === 'binary'
            ? declaredType
            : 'text';

      return {
        method: String(entry.method ?? 'GET').toUpperCase(),
        path: String(entry.path ?? '/'),
        query: normalizeMultiValueMap(entry.query),
        requestHeaders: normalizeStringMap(entry.requestHeaders),
        status: Number(entry.status ?? 0),
        responseHeaders: normalizeMultiValueMap(entry.responseHeaders),
        body,
        bodyType,
        bodyEncoding,
        requestBody: typeof entry.requestBody === 'string' ? entry.requestBody : undefined,
        requestBodyEncoding: entry.requestBodyEncoding === 'base64' ? 'base64' : undefined,
        durationMs: Number(entry.durationMs ?? 0),
      };
    }),
  };
}

export function serializeGoldenFile(file: GoldenFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function interactionKey(interaction: {
  method: string;
  path: string;
  query?: Record<string, MultiValue>;
}): string {
  const query = Object.keys(interaction.query ?? {})
    .sort()
    .flatMap((key) => valuesOf((interaction.query ?? {})[key]).map((value) => `${key}=${value}`))
    .join('&');
  return query ? `${interaction.method} ${interaction.path}?${query}` : `${interaction.method} ${interaction.path}`;
}
