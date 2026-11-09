import http from 'node:http';
import { watch, type FSWatcher } from 'node:fs';
import type { AddressInfo } from 'node:net';

import type { ApiSpec, Operation } from '../spec/model.ts';
import { generatePayload } from './generator.ts';
import { validateMockRequest } from './strict.ts';

export interface RouteMatch {
  operation: Operation;
  pathParams: Record<string, string>;
}

export interface MockServerOptions {
  host?: string;
  port?: number;

  latency?: number;

  errorLatency?: number;

  /** Validate parameters, cookies and the request body. */
  strict?: boolean;

  /** Reject query, header and cookie parameters that are not documented. */
  strictUnknown?: boolean;

  /** Enable CORS. true means every origin; an array is an exact allow-list. */
  cors?: boolean | string[];

  /** Watch the document and hot-reload the route table. */
  watch?: boolean;

  /** The document path, required by watch. */
  specPath?: string;

  /** Request body limit in bytes (default 10 MB). */
  maxBody?: number;
}

export interface MockServerHandle {
  server: http.Server;
  port: number;
  url: string;
  close(): Promise<void>;
}

interface CompiledRoute {
  operation: Operation;
  regex: RegExp;
  paramNames: string[];
}

const DEFAULT_MAX_BODY = 10 * 1024 * 1024;

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]' ||
    normalized === '0:0:0:0:0:0:0:1'
  );
}

/**
 * decodeURIComponent throws on malformed escapes such as "%ZZ". A single
 * hostile request must not take the whole mock server down, so fall back to
 * the raw segment.
 */
function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Parses "?x-mock-status=". Returns undefined when the parameter is absent,
 * null when the value cannot be used as an HTTP status, and the number
 * otherwise. Returning null (instead of NaN) keeps the value out of
 * response.writeHead(), which throws on anything outside 100-599.
 */
function parseStatusOverride(raw: string | null): number | undefined | null {
  if (raw === null || raw.trim() === '') return undefined;
  if (!/^\d{3}$/.test(raw.trim())) return null;
  const status = Number(raw.trim());
  return status >= 100 && status <= 599 ? status : null;
}

export function compilePath(template: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const pattern = template
    .split('/')
    .map((segment) => {
      // Split on "{param}" so a segment may mix parameters and literal text
      // ("/files/{name}.json", "/a/{x}-{y}/b", "/v{ver}/x"): capture groups
      // are emitted for parameters, everything else is escaped verbatim.
      const parts = segment.split(/\{([^}]+)\}/);
      let out = '';
      for (let i = 0; i < parts.length; i += 1) {
        if (i % 2 === 1) {
          paramNames.push(parts[i] as string);
          out += '([^/]+)';
        } else {
          out += (parts[i] as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }
      }
      return out;
    })
    .join('/');

  return { regex: new RegExp(`^${pattern}/?$`), paramNames };
}

export function comparePathSpecificity(a: string, b: string): number {
  const specificity = (template: string): { segments: number; literals: number } => {
    const segments = template.split('/').filter((segment) => segment !== '');
    return {
      segments: segments.length,
      literals: segments.filter((segment) => !segment.includes('{')).length,
    };
  };
  const left = specificity(a);
  const right = specificity(b);
  return right.segments - left.segments || right.literals - left.literals;
}

export function matchRoute(routes: CompiledRoute[], method: string, pathname: string): RouteMatch | undefined {
  const upper = method.toUpperCase();
  let pathMatched = false;
  const ordered = [...routes].sort((a, b) =>
    comparePathSpecificity(a.operation.path, b.operation.path),
  );

  for (const route of ordered) {
    const match = route.regex.exec(pathname);
    if (!match) continue;
    pathMatched = true;
    if (route.operation.method.toUpperCase() !== upper) continue;

    const pathParams: Record<string, string> = {};
    route.paramNames.forEach((name, index) => {
      pathParams[name] = decodePathSegment(match[index + 1] ?? '');
    });
    return { operation: route.operation, pathParams };
  }

  if (pathMatched) {

    for (const route of ordered) {
      if (!route.regex.test(pathname)) continue;
      return {
        operation: {
          ...route.operation,
          method: route.operation.method,
          raw: { ...route.operation.raw, 'x-method-not-allowed': true },
        },
        pathParams: {},
      };
    }
  }

  return undefined;
}

function buildRoutes(spec: ApiSpec): CompiledRoute[] {
  const routes: CompiledRoute[] = [];
  for (const pathItem of spec.paths) {
    const compiled = compilePath(pathItem.path);
    for (const operation of pathItem.operations) {
      routes.push({ operation, regex: compiled.regex, paramNames: compiled.paramNames });
    }
  }
  return routes.sort((a, b) => comparePathSpecificity(a.operation.path, b.operation.path));
}

function corsHeaders(cors: boolean | string[] | undefined, origin: string | undefined): Record<string, string> {
  if (!cors) return {};
  const allowed = Array.isArray(cors) ? cors : ['*'];
  if (allowed.includes('*')) {
    return {
      'Access-Control-Allow-Origin': '*',
      Vary: 'Origin',
    };
  }
  if (origin && allowed.includes(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      Vary: 'Origin',
    };
  }
  return {};
}

async function readBody(
  request: http.IncomingMessage,
  maxBody: number,
): Promise<{ text: string; tooLarge: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > maxBody) return { text: '', tooLarge: true };
    chunks.push(buffer);
  }
  return { text: Buffer.concat(chunks).toString('utf8'), tooLarge: false };
}

function documentedMethods(spec: ApiSpec, pathname: string): string[] {
  const methods = new Set<string>();
  for (const pathItem of spec.paths) {
    if (!compilePath(pathItem.path).regex.test(pathname)) continue;
    for (const operation of pathItem.operations) methods.add(operation.method.toUpperCase());
  }
  methods.add('OPTIONS');
  return [...methods].sort();
}

export async function startMockServer(spec: ApiSpec, options: MockServerOptions = {}): Promise<MockServerHandle> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;
  const maxBody = options.maxBody ?? DEFAULT_MAX_BODY;

  if (!isLoopbackHost(host)) {
    process.stderr.write(`apicovenant mock: warning: listening on non-loopback host ${host}\n`);
  }

  let currentSpec = spec;
  let routes = buildRoutes(currentSpec);

  const server = http.createServer((request, response) => {
    // Every path through the handler must end in a response. Without this
    // catch an exception (malformed URI, invalid header, bad status code)
    // propagates as an unhandled rejection and kills the process.
    handleRequest(() => currentSpec, () => routes, request, response, options, maxBody).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`apicovenant mock: request failed: ${message}\n`);
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(`${JSON.stringify({ error: 'internal_error', message }, null, 2)}\n`);
    });
  });

  // Requests that Node's HTTP parser rejects never reach the handler above.
  // Answer them with 400 instead of leaving the socket half open.
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });

  server.keepAliveTimeout = 0;
  // Keep a bounded header/request timeout: a client must not be able to pin a
  // connection forever. keepAliveTimeout stays 0 to preserve the old behaviour
  // that avoids ECONNRESET on reused test connections.
  server.headersTimeout = 60_000;
  server.requestTimeout = 300_000;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });

  const address = server.address() as AddressInfo;
  const actualPort = address.port;

  let watcher: FSWatcher | undefined;
  if (options.watch) {
    if (!options.specPath) {
      throw new Error('--watch requires a document path');
    }
    const specPath = options.specPath;
    let timer: ReturnType<typeof setTimeout> | undefined;
    watcher = watch(specPath, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void import('../spec/loader.ts')
          .then((loader) => loader.loadSpecFile(specPath))
          .then((next) => {
            currentSpec = next;
            routes = buildRoutes(next);
          })
          .catch((error: unknown) => {
            // A broken document must not kill a running mock: keep the old
            // routes and report why the reload was rejected.
            process.stderr.write(`apicovenant mock: reload failed: ${(error as Error).message}\n`);
          });
      }, 300);
    });
    watcher.on('error', (error) => {
      process.stderr.write(`apicovenant mock: watcher error: ${error.message}\n`);
    });
  }

  return {
    server,
    port: actualPort,
    url: `http://${host}:${actualPort}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        watcher?.close();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function handleRequest(
  getSpec: () => ApiSpec,
  getRoutes: () => CompiledRoute[],
  request: http.IncomingMessage,
  response: http.ServerResponse,
  options: MockServerOptions,
  maxBody: number,
): Promise<void> {
  // Never build the base from the Host header: Node's URL parser throws on
  // values such as "a b", and the header is fully attacker controlled.
  let url: URL;
  try {
    url = new URL(request.url ?? '/', 'http://localhost');
  } catch {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(`${JSON.stringify({ error: 'bad_request', message: 'malformed request target' }, null, 2)}\n`);
    return;
  }
  const pathname = url.pathname;

  const send = (status: number, headers: Record<string, string | string[]>, body: string): void => {
    const origin = Array.isArray(request.headers.origin) ? request.headers.origin[0] : request.headers.origin;
    response.writeHead(status, { ...corsHeaders(options.cors, origin), ...headers });
    response.end(body);
  };

  // Answer a CORS preflight before route matching: the OPTIONS operation is
  // usually not documented, and a browser needs the headers either way.
  if (
    options.cors &&
    request.method === 'OPTIONS' &&
    request.headers['access-control-request-method'] !== undefined
  ) {
    const origin = Array.isArray(request.headers.origin) ? request.headers.origin[0] : request.headers.origin;
    const requestedHeaders = request.headers['access-control-request-headers'];
    send(204, {
      ...corsHeaders(options.cors, origin),
      'Access-Control-Allow-Methods': documentedMethods(getSpec(), pathname).join(', '),
      'Access-Control-Allow-Headers':
        typeof requestedHeaders === 'string' && requestedHeaders.length > 0 ? requestedHeaders : '*',
      'Access-Control-Max-Age': '600',
    }, '');
    return;
  }

  const body = await readBody(request, maxBody);
  if (body.tooLarge) {
    send(413, { 'Content-Type': 'application/json', Connection: 'close' },
      `${JSON.stringify(
        {
          error: 'payload_too_large',
          violations: [{ in: 'body', path: '/', message: `request body exceeds ${maxBody} bytes` }],
        },
        null,
        2,
      )}\n`,
    );
    request.destroy();
    return;
  }

  if (pathname === '/_apicovenant/routes') {
    const routes = getRoutes();
    const payload = JSON.stringify(
      {
        routes: routes.map((route) => ({
          method: route.operation.method.toUpperCase(),
          path: route.operation.path,
          operationId: route.operation.operationId,
          statusCodes: [...route.operation.responses.keys()],
        })),
      },
      null,
      2,
    );
    send(200, { 'Content-Type': 'application/json' }, `${payload}\n`);
    return;
  }

  const match = matchRoute(getRoutes(), request.method ?? 'GET', pathname);

  if (!match) {
    const payload = JSON.stringify(
      {
        error: 'not_found',
        message: `No operation matches ${request.method} ${pathname}`,
        hint: 'Call GET /_apicovenant/routes to list the available routes.',
      },
      null,
      2,
    );
    send(404, { 'Content-Type': 'application/json' }, `${payload}\n`);
    return;
  }

  if (match.operation.raw['x-method-not-allowed'] === true) {
    const allowed = [
      ...new Set(
        getRoutes()
          .filter((route) => route.regex.test(pathname))
          .map((route) => route.operation.method.toUpperCase()),
      ),
    ].sort();
    send(405, { 'Content-Type': 'application/json', Allow: allowed.join(', ') },
      `${JSON.stringify({ error: 'method_not_allowed', message: `${request.method} is not allowed on ${pathname}` }, null, 2)}\n`);
    return;
  }

  if (options.strict || options.strictUnknown) {
    const validation = validateMockRequest(
      getSpec(),
      match.operation,
      match.pathParams,
      url,
      request.headers,
      body.text,
      maxBody,
      options.strictUnknown === true,
    );
    if (validation) {
      send(validation.status, {
        'Content-Type': 'application/json',
        ...(validation.status === 413 ? { Connection: 'close' } : {}),
      }, `${JSON.stringify({ error: validation.error, violations: validation.violations }, null, 2)}\n`);
      return;
    }
  }

  const requestedStatus = parseStatusOverride(url.searchParams.get('x-mock-status'));
  if (requestedStatus === null) {
    send(400, { 'Content-Type': 'application/json' },
      `${JSON.stringify(
        {
          error: 'invalid_mock_status',
          message: `"${url.searchParams.get('x-mock-status') ?? ''}" is not a valid status code (expected an integer from 100 to 599)`,
        },
        null,
        2,
      )}\n`);
    return;
  }

  const payload = generatePayload(getSpec(), match.operation, { status: requestedStatus });

  const latency = payload.status >= 400 ? (options.errorLatency ?? options.latency ?? 0) : (options.latency ?? 0);
  if (latency > 0) {
    await new Promise((resolve) => setTimeout(resolve, latency));
  }

  // Belt and braces: a spec can only produce a valid code now, but a bad
  // status here used to throw from writeHead() and kill the process.
  const status =
    Number.isInteger(payload.status) && payload.status >= 100 && payload.status <= 599 ? payload.status : 200;

  send(status, payload.headers, payload.body);
}
