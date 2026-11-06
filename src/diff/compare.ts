import { compilePath, comparePathSpecificity } from '../mock/server.ts';
import { matchesStatusClass, numericStatus } from '../mock/generator.ts';
import { validateSchema, type SchemaViolation } from '../spec/schema.ts';
import { deref, followRef } from '../spec/ref.ts';
import type { ApiSpec, Operation } from '../spec/model.ts';
import { diffJson, parseBody, type BodyDifference } from './json-diff.ts';
import { interactionKey, type GoldenFile, type GoldenInteraction, type QueryParams } from '../record/golden.ts';

export interface LiveResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface LiveSource {

  readonly description: string;

  readonly derivedFromSpec?: boolean;

  request(interaction: GoldenInteraction): Promise<LiveResponse>;
}

export class HttpLiveSource implements LiveSource {
  readonly description: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly headerOverrides: Record<string, string>;
  private readonly queryOverrides: QueryParams;

  constructor(
    baseUrl: string,
    timeoutMs = 10_000,
    headerOverrides: Record<string, string> = {},
    queryOverrides: QueryParams = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.description = this.baseUrl;
    this.timeoutMs = timeoutMs;
    this.headerOverrides = headerOverrides;
    this.queryOverrides = queryOverrides;
  }

  async request(interaction: GoldenInteraction): Promise<LiveResponse> {
    const query = replayQuery(interaction.query, this.queryOverrides);
    const url = `${this.baseUrl}${interaction.path}${query ? `?${query}` : ''}`;
    const requestHeaders = mergeHeaders(interaction.requestHeaders, this.headerOverrides);
    return fetchLive(url, { ...interaction, requestHeaders }, this.timeoutMs);
  }
}

/**
 * Rebuilds the request query from the recording.
 *
 * The recorder replaces credentials with "<redacted>". Sending that literal
 * upstream guarantees a 401, so a redacted value is dropped unless the caller
 * supplies a replacement (--query), exactly like mergeHeaders() for headers.
 * Repeated keys ("?tag=a&tag=b") are appended in order instead of being
 * collapsed into one value.
 */
export function replayQuery(query: QueryParams, overrides: QueryParams = {}): string {
  const params = new URLSearchParams();
  const append = (name: string, value: QueryParams[string], skipRedacted: boolean): void => {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (skipRedacted && item === '<redacted>') continue;
      params.append(name, item);
    }
  };

  for (const [name, value] of Object.entries(query)) {
    if (overrides[name] !== undefined) continue;
    append(name, value, true);
  }
  // Overrides win over the recorded value and may also add a parameter the
  // recorder never saw.
  for (const [name, value] of Object.entries(overrides)) append(name, value, false);

  return params.toString();
}

/**
 * The recorder replaces credentials with "<redacted>" so that a golden file
 * can be committed. Sending that placeholder upstream guarantees a 401, and
 * hard-coding a real token in the file would defeat the point of redaction.
 * Headers supplied with --header replace the recorded (or redacted) value;
 * everything else that is redacted is dropped instead of forwarded.
 */
export function mergeHeaders(
  recorded: Record<string, string>,
  overrides: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(recorded)) {
    if (value === '<redacted>') continue;
    out[name] = value;
  }
  for (const [name, value] of Object.entries(overrides)) {
    const lower = name.toLowerCase();
    for (const existing of Object.keys(out)) {
      if (existing.toLowerCase() === lower) delete out[existing];
    }
    out[name] = value;
  }
  return out;
}


export class MockLiveSource implements LiveSource {
  readonly description: string;
  readonly derivedFromSpec = true;
  private readonly url: string;

  constructor(url: string, description?: string) {
    this.url = url.replace(/\/+$/, '');
    this.description = description ?? `mock(${this.url})`;
  }

  async request(interaction: GoldenInteraction): Promise<LiveResponse> {
    const query = replayQuery(interaction.query);
    const url = `${this.url}${interaction.path}${query ? `?${query}` : ''}`;
    return fetchLive(url, interaction);
  }
}

async function fetchLive(url: string, interaction: GoldenInteraction, timeoutMs?: number): Promise<LiveResponse> {
  const attempts = SAFE_METHODS.has(interaction.method.toUpperCase()) ? 2 : 1;
  let failure: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await performFetch(url, interaction, timeoutMs);
    } catch (error) {
      failure = error;
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  }
  throw failure;
}

async function performFetch(
  url: string,
  interaction: GoldenInteraction,
  timeoutMs?: number,
): Promise<LiveResponse> {
  const controller = new AbortController();
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  try {
    const response = await fetch(url, {
      method: interaction.method,
      headers: forwardHeaders(interaction.requestHeaders),
      body: interaction.method === 'GET' || interaction.method === 'HEAD' ? undefined : interaction.body,
      signal: controller.signal,
      redirect: 'manual',
    });

    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });

    const body = await response.text();
    return { status: response.status, headers, body };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface HeaderDifference {
  name: string;
  before?: string;
  after?: string;
  changed: boolean;
}

export interface InteractionDiff {
  key: string;
  method: string;
  path: string;
  status: {
    before: number;
    after: number;
    changed: boolean;
  };
  headers: HeaderDifference[];
  body: {
    changed: boolean;
    differences: BodyDifference[];
  };

  schemaViolations: SchemaViolation[];

  mockViolations: SchemaViolation[];

  error?: string;

  skipped?: boolean;
}

export interface DiffSummary {
  total: number;
  changed: number;
  unchanged: number;
  failed: number;
  skipped: number;
}

export interface DiffReport {
  source: string;
  golden: string;
  interactions: InteractionDiff[];
  summary: DiffSummary;
}

export interface DiffOptions {

  compareHeaders?: string[];

  replayAll?: boolean;

  spec?: ApiSpec;
}

const DEFAULT_COMPARE_HEADERS = ['content-type', 'location', 'etag', 'cache-control'];

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Headers that fetch() must manage itself: a user-supplied content-length
// (or transfer-encoding, host, connection) alongside a body makes undici
// throw "invalid content-length header" (UND_ERR_INVALID_ARG).
const STRIP_FORWARD = new Set([
  'host',
  'connection',
  'keep-alive',
  'content-length',
  'transfer-encoding',
  'proxy-connection',
  'te',
  'trailer',
  'upgrade',
]);

function forwardHeaders(headers: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (STRIP_FORWARD.has(name.toLowerCase())) continue;
    out[name] = value;
  }
  return out;
}

function matchOperation(spec: ApiSpec, method: string, pathname: string): Operation | undefined {
  const upper = method.toUpperCase();
  // Same specificity order as the mock router: a static path must not be
  // shadowed by a parameterised one declared before it.
  const paths = [...spec.paths].sort((a, b) => comparePathSpecificity(a.path, b.path));
  for (const pathItem of paths) {
    const { regex } = compilePath(pathItem.path);
    if (!regex.test(pathname)) continue;
    for (const operation of pathItem.operations) {
      if (operation.method.toUpperCase() === upper) return operation;
    }
  }
  return undefined;
}

export function validateAgainstSpec(spec: ApiSpec, operation: Operation | undefined, response: LiveResponse): SchemaViolation[] {
  if (!operation) return [];

  // "2XX" and "default" are documented responses too; converting the key with
  // Number() turned them into NaN, so those specs were never validated and
  // drift was silently missed.
  const responses = [...operation.responses.values()];
  const documented =
    responses.find((entry) => numericStatus(entry.status) === response.status) ??
    responses.find((entry) => matchesStatusClass(entry.status, response.status)) ??
    responses.find((entry) => entry.status.toLowerCase() === 'default');
  if (!documented) return [];

  const mediaType =
    documented.content.get('application/json') ??
    [...documented.content.values()].find((entry) => entry.contentType.includes('json'));
  if (!mediaType?.schema) return [];

  const body = parseBody(response.body, response.headers['content-type']?.includes('json') ? 'json' : 'text');
  if (body === undefined) return [];

  const schema = followRef(spec.raw, mediaType.schema);
  const expanded = deref(spec.raw, schema);
  return validateSchema(body, expanded);
}

export async function compareGolden(
  golden: GoldenFile,
  source: LiveSource,
  options: DiffOptions = {},
): Promise<DiffReport> {
  const compareHeaders = options.compareHeaders ?? DEFAULT_COMPARE_HEADERS;
  const interactions: InteractionDiff[] = [];

  for (const interaction of golden.interactions) {
    // The key includes the query string so two interactions that differ only
    // by query parameters stay distinguishable in the report.
    const key = interactionKey(interaction);

    if (!options.replayAll && !SAFE_METHODS.has(interaction.method.toUpperCase())) {
      interactions.push({
        key,
        method: interaction.method,
        path: interaction.path,
        status: { before: interaction.status, after: interaction.status, changed: false },
        headers: [],
        body: { changed: false, differences: [] },
        schemaViolations: [],
        mockViolations: [],
        skipped: true,
      });
      continue;
    }

    let live: LiveResponse;
    try {
      live = await source.request(interaction);
    } catch (error) {
      interactions.push({
        key,
        method: interaction.method,
        path: interaction.path,
        status: { before: interaction.status, after: 0, changed: true },
        headers: [],
        body: { changed: false, differences: [] },
        schemaViolations: [],
        mockViolations: [],
        error: (error as Error).message,
      });
      continue;
    }

    const headerDiffs: HeaderDifference[] = [];
    for (const name of compareHeaders) {
      const before = interaction.responseHeaders[name] ?? interaction.responseHeaders[name.toLowerCase()];
      const after = live.headers[name];
      if (before === undefined && after === undefined) continue;
      headerDiffs.push({
        name,
        before,
        after,
        changed: before !== after,
      });
    }

    const beforeBody = parseBody(interaction.body, interaction.bodyType);
    const afterBody = parseBody(live.body, live.headers['content-type']?.includes('json') ? 'json' : 'text');
    const differences = diffJson(beforeBody, afterBody);

    const operation = options.spec
      ? matchOperation(options.spec, interaction.method, interaction.path)
      : undefined;
    const detected = validateAgainstSpec(options.spec as ApiSpec, operation, live);
    const schemaViolations = source.derivedFromSpec ? [] : detected;
    const mockViolations = source.derivedFromSpec ? detected : [];

    interactions.push({
      key,
      method: interaction.method,
      path: interaction.path,
      status: {
        before: interaction.status,
        after: live.status,
        changed: live.status !== interaction.status,
      },
      headers: headerDiffs,
      body: { changed: differences.length > 0, differences },
      schemaViolations,
      mockViolations,
    });
  }

  const summary: DiffSummary = { total: interactions.length, changed: 0, unchanged: 0, failed: 0, skipped: 0 };
  for (const interaction of interactions) {
    if (interaction.skipped) {
      summary.skipped += 1;
      continue;
    }
    if (interaction.error) {
      summary.failed += 1;
      continue;
    }
    const changed =
      interaction.status.changed ||
      interaction.body.changed ||
      interaction.headers.some((header) => header.changed) ||
      interaction.schemaViolations.length > 0;
    if (changed) summary.changed += 1;
    else summary.unchanged += 1;
  }

  return {
    source: source.description,
    golden: golden.target,
    interactions,
    summary,
  };
}

export function summariseDifferences(interaction: InteractionDiff): string[] {
  const out: string[] = [];
  if (interaction.error) out.push(`request failed: ${interaction.error}`);
  if (interaction.status.changed) {
    out.push(`status changed ${interaction.status.before} → ${interaction.status.after}`);
  }
  for (const header of interaction.headers) {
    if (!header.changed) continue;
    out.push(`header "${header.name}" changed ${header.before ?? '(absent)'} → ${header.after ?? '(absent)'}`);
  }
  if (interaction.body.changed) {
    const first = interaction.body.differences[0];
    const extra = interaction.body.differences.length - 1;
    out.push(
      `body changed in ${interaction.body.differences.length} place${interaction.body.differences.length === 1 ? '' : 's'}` +
        (first ? ` (first: ${first.kind} ${first.path})` : '') +
        (extra > 0 ? ` and ${extra} more` : ''),
    );
  }
  for (const violation of interaction.schemaViolations) {
    out.push(`schema violation at ${violation.path || '/'}: ${violation.message}`);
  }
  return out;
}

export function summariseMockViolations(interaction: InteractionDiff): string[] {
  return interaction.mockViolations.map(
    (violation) => `mock does not satisfy the spec at ${violation.path || '/'}: ${violation.message}`,
  );
}

export function describeReport(report: DiffReport): string {
  const parts: string[] = [];
  if (report.summary.changed) parts.push(`${report.summary.changed} changed`);
  if (report.summary.unchanged) parts.push(`${report.summary.unchanged} unchanged`);
  if (report.summary.failed) parts.push(`${report.summary.failed} failed`);
  if (report.summary.skipped) parts.push(`${report.summary.skipped} skipped`);
  return parts.join(', ');
}
