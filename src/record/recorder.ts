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

      // If the client goes away (an SSE consumer that closes the tab, a
      // cancelled curl), stop pulling from the upstream as well. Otherwise a
      // never-ending stream keeps this request, and its interaction, alive
      // forever.
      const controller = new AbortController();
      response.on('close', () => {
        if (!response.writableEnded) controller.abort();
      });

      let upstream: Response;
      try {
        upstream = await fetch(targetUrl, {
          method: request.method ?? 'GET',
          headers: forwardHeaders(request.headers),
          body: ['GET', 'HEAD'].includes((request.method ?? 'GET').toUpperCase()) ? undefined : requestBody,
          redirect: 'manual',
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        response.writeHead(502, { 'Content-Type': 'application/json' });
        response.end(
          `${JSON.stringify({ error: 'bad_gateway', message: `could not reach ${target}: ${(error as Error).message}` }, null, 2)}\n`,
        );
        return;
      }

      const responseHeaders: Record<string, string> = {};
      upstream.headers.forEach((value, name) => {
        responseHeaders[name.toLowerCase()] = value;
      });

      const outHeaders: Record<string, string | string[]> = {};
      upstream.headers.forEach((value, name) => {
        const lower = name.toLowerCase();
        // fetch() already decompressed the body, so the upstream framing
        // headers describe a different byte stream than the one we forward.
        // Drop them and let Node re-frame the response.
        if (lower === 'content-encoding' || lower === 'content-length' || lower === 'transfer-encoding') return;
        outHeaders[name] = value;
      });

      // Forward bytes as they arrive instead of buffering the complete
      // response. `await upstream.text()` blocked streaming endpoints
      // (text/event-stream, chunked logs) until the upstream closed the
      // connection, so the client received nothing and the body timeout
      // eventually rejected outside any handler.
      response.writeHead(upstream.status, outHeaders);

      const responseChunks: Buffer[] = [];
      try {
        if (upstream.body) {
          for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
            const buffer = Buffer.from(chunk);
            responseChunks.push(buffer);
            if (!response.destroyed && !response.writableEnded) response.write(buffer);
          }
        }
      } catch (error) {
        // The upstream aborted mid-stream (or the client disconnected).
        // Keep what arrived: a truncated golden is still useful, and the
        // proxy must not turn a broken stream into a dead process.
        if (!controller.signal.aborted) {
          process.stderr.write(`apicovenant record: upstream stream ended early: ${(error as Error).message}\n`);
        }
      }
      if (!response.writableEnded && !response.destroyed) response.end();

      const responseBody = Buffer.concat(responseChunks).toString('utf8');
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

      if (options.maxRequests && captured >= options.maxRequests) {
        server.close();
        options.onComplete?.();
      }
    })().catch((error: unknown) => {
      // Nothing thrown while proxying may escape: an unhandled rejection
      // terminates the process and the recorded interactions are lost.
      process.stderr.write(`apicovenant record: request failed: ${(error as Error).message}\n`);
      if (!response.headersSent) {
        response.writeHead(502, { 'Content-Type': 'application/json' });
        response.end(
          `${JSON.stringify({ error: 'proxy_error', message: (error as Error).message }, null, 2)}\n`,
        );
      } else if (!response.writableEnded) {
        response.destroy();
      }
    });
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
