export const GOLDEN_FORMAT_VERSION = 1;

export interface GoldenInteraction {
  method: string;

  path: string;

  query: Record<string, string>;
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
        query: entry.query ?? {},
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

export function serializeGoldenFile(file: GoldenFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function interactionKey(interaction: { method: string; path: string; query?: Record<string, string> }): string {
  const query = Object.keys(interaction.query ?? {})
    .sort()
    .map((key) => `${key}=${(interaction.query as Record<string, string>)[key]}`)
    .join('&');
  return query ? `${interaction.method} ${interaction.path}?${query}` : `${interaction.method} ${interaction.path}`;
}
