import http from 'node:http';
import type { AddressInfo } from 'node:net';

import type { ApiSpec, Operation } from '../spec/model.ts';
import { generatePayload } from './generator.ts';

export interface RouteMatch {
  operation: Operation;
  pathParams: Record<string, string>;
}

export interface MockServerOptions {
  host?: string;
  port?: number;

  latency?: number;

  errorLatency?: number;
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

export function matchRoute(routes: CompiledRoute[], method: string, pathname: string): RouteMatch | undefined {
  const upper = method.toUpperCase();
  let pathMatched = false;

  for (const route of routes) {
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

    for (const route of routes) {
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

export async function startMockServer(spec: ApiSpec, options: MockServerOptions = {}): Promise<MockServerHandle> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;

  const routes: CompiledRoute[] = [];
  for (const pathItem of spec.paths) {
    const compiled = compilePath(pathItem.path);
    for (const operation of pathItem.operations) {
      routes.push({ operation, regex: compiled.regex, paramNames: compiled.paramNames });
    }
  }

  const server = http.createServer((request, response) => {
    // Every path through the handler must end in a response. Without this
    // catch an exception (malformed URI, invalid header, bad status code)
    // propagates as an unhandled rejection and kills the process.
    handleRequest(spec, routes, request, response, options).catch((error: unknown) => {
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
  server.headersTimeout = 0;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });

  const address = server.address() as AddressInfo;
  const actualPort = address.port;

  return {
    server,
    port: actualPort,
    url: `http://${host}:${actualPort}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function handleRequest(
  spec: ApiSpec,
  routes: CompiledRoute[],
  request: http.IncomingMessage,
  response: http.ServerResponse,
  options: MockServerOptions,
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

  if (pathname === '/_apicovenant/routes') {
    const body = JSON.stringify(
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
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(`${body}\n`);
    return;
  }

  const match = matchRoute(routes, request.method ?? 'GET', pathname);

  if (!match) {
    const body = JSON.stringify(
      {
        error: 'not_found',
        message: `No operation matches ${request.method} ${pathname}`,
        hint: 'Call GET /_apicovenant/routes to list the available routes.',
      },
      null,
      2,
    );
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(`${body}\n`);
    return;
  }

  if (match.operation.raw['x-method-not-allowed'] === true) {
    const allowed = [
      ...new Set(
        routes
          .filter((route) => route.regex.test(pathname))
          .map((route) => route.operation.method.toUpperCase()),
      ),
    ].sort();
    response.writeHead(405, { 'Content-Type': 'application/json', Allow: allowed.join(', ') });
    response.end(`${JSON.stringify({ error: 'method_not_allowed', message: `${request.method} is not allowed on ${pathname}` }, null, 2)}\n`);
    return;
  }

  const requestedStatus = parseStatusOverride(url.searchParams.get('x-mock-status'));
  if (requestedStatus === null) {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(
      `${JSON.stringify(
        {
          error: 'invalid_mock_status',
          message: `"${url.searchParams.get('x-mock-status') ?? ''}" is not a valid status code (expected an integer from 100 to 599)`,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const payload = generatePayload(spec, match.operation, { status: requestedStatus });

  const latency = payload.status >= 400 ? (options.errorLatency ?? options.latency ?? 0) : (options.latency ?? 0);
  if (latency > 0) {
    await new Promise((resolve) => setTimeout(resolve, latency));
  }

  // Belt and braces: a spec can only produce a valid code now, but a bad
  // status here used to throw from writeHead() and kill the process.
  const status =
    Number.isInteger(payload.status) && payload.status >= 100 && payload.status <= 599 ? payload.status : 200;

  response.writeHead(status, payload.headers);
  response.end(payload.body);
}
