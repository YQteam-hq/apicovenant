import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createGoldenFile, type GoldenFile, type GoldenInteraction } from './golden.ts';

export interface RecorderOptions {

  target: string;

  spec?: string;
  host?: string;
  port?: number;

  maxRequests?: number;

  durationMs?: number;

  onInteraction?: (interaction: GoldenInteraction) => void;

  onComplete?: () => void;

  redactHeaders?: string[];
}

export interface RecorderHandle {

  url: string;
  port: number;

  count(): number;

  stop(): GoldenFile;
}

const DEFAULT_REDACT = ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'proxy-authorization'];

// Query parameter names that usually carry credentials. Unlike headers, query
// keys have no canonical casing, so we match on the word itself.
const SENSITIVE_QUERY_KEY = /(api[-_]?key|apikey|access[-_]?token|token|secret|password|passwd|credential|authorization)/i;

const redactQuery = (query: Record<string, string>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(query)) {
    out[name] = SENSITIVE_QUERY_KEY.test(name) ? '<redacted>' : value;
  }
  return out;
};

export async function startRecorder(options: RecorderOptions): Promise<RecorderHandle> {
  const target = options.target.replace(/\/+$/, '');
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;
  const redact = new Set((options.redactHeaders ?? DEFAULT_REDACT).map((name) => name.toLowerCase()));

  const file = createGoldenFile(target, options.spec);
  let captured = 0;

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

  const forwardHeaders = (headers: Record<string, string | string[] | undefined>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
      if (value === undefined) continue;
      const lower = name.toLowerCase();
      if (STRIP_FORWARD.has(lower)) continue;
      out[name] = Array.isArray(value) ? value.join(', ') : String(value);
    }
    return out;
  };

  const redactHeaders = (headers: Record<string, string | string[] | undefined>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
      if (value === undefined) continue;
      const text = Array.isArray(value) ? value.join(', ') : String(value);
      out[name.toLowerCase()] = redact.has(name.toLowerCase()) ? '<redacted>' : text;
    }
    return out;
  };

  const server = http.createServer((request, response) => {
    void (async () => {
      const started = Date.now();
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const requestBody = Buffer.concat(chunks).toString('utf8');

      const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      const targetUrl = `${target}${request.url ?? '/'}`;

      let upstream: Response;
      try {
        upstream = await fetch(targetUrl, {
          method: request.method ?? 'GET',
          headers: forwardHeaders(request.headers),
          body: ['GET', 'HEAD'].includes((request.method ?? 'GET').toUpperCase()) ? undefined : requestBody,
          redirect: 'manual',
        });
      } catch (error) {
        response.writeHead(502, { 'Content-Type': 'application/json' });
        response.end(
          `${JSON.stringify({ error: 'bad_gateway', message: `could not reach ${target}: ${(error as Error).message}` }, null, 2)}\n`,
        );
        return;
      }

      const responseBody = await upstream.text();
      const responseHeaders: Record<string, string> = {};
      upstream.headers.forEach((value, name) => {
        responseHeaders[name.toLowerCase()] = value;
      });

      const contentType = responseHeaders['content-type'] ?? '';
      const bodyType: GoldenInteraction['bodyType'] =
        responseBody.trim() === '' ? 'empty' : contentType.includes('json') ? 'json' : 'text';

      const interaction: GoldenInteraction = {
        method: (request.method ?? 'GET').toUpperCase(),
        path: requestUrl.pathname,
        query: redactQuery(Object.fromEntries(requestUrl.searchParams.entries())),
        requestHeaders: redactHeaders(request.headers),
        status: upstream.status,
        responseHeaders: redactHeaders(responseHeaders),
        body: responseBody,
        bodyType,
        durationMs: Date.now() - started,
      };

      file.interactions.push(interaction);
      captured += 1;
      options.onInteraction?.(interaction);

      const outHeaders: Record<string, string | string[]> = {};
      upstream.headers.forEach((value, name) => {
        if (name.toLowerCase() === 'content-encoding') return;
        outHeaders[name] = value;
      });

      response.writeHead(upstream.status, outHeaders);
      response.end(responseBody);

      if (options.maxRequests && captured >= options.maxRequests) {
        server.close();
        options.onComplete?.();
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });

  const address = server.address() as AddressInfo;

  let timer: NodeJS.Timeout | undefined;
  if (options.durationMs) {
    timer = setTimeout(() => {
      server.close();
      options.onComplete?.();
    }, options.durationMs);
  }

  return {
    url: `http://${host}:${address.port}`,
    port: address.port,
    count: () => captured,
    stop: () => {
      if (timer) clearTimeout(timer);
      server.close();
      return file;
    },
  };
}
