import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSpecFile, loadSpecFromText } from '../src/spec/loader.ts';
import { startMockServer } from '../src/mock/server.ts';
import { startRecorder } from '../src/record/recorder.ts';
import { compareGolden, HttpLiveSource } from '../src/diff/compare.ts';
import { serializeGoldenFile, parseGoldenFile } from '../src/record/golden.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const shopSpecPath = path.resolve(here, '..', 'examples', 'shop.openapi.yaml');

async function withMock<T>(fn: (url: string) => Promise<T>): Promise<T> {
  const spec = await loadSpecFile(shopSpecPath);
  const handle = await startMockServer(spec);
  try {
    return await fn(handle.url);
  } finally {
    await handle.close();
  }
}

test('the mock server answers documented routes', async () => {
  await withMock(async (url) => {
    const response = await fetch(`${url}/users`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);

    const body = (await response.json()) as { items: unknown[]; total: number };
    assert.ok(Array.isArray(body.items));
    assert.equal(typeof body.total, 'number');
  });
});

test('the mock server substitutes path parameters', async () => {
  await withMock(async (url) => {
    const response = await fetch(`${url}/users/usr_1001`);
    assert.equal(response.status, 200);
  });
});

test('the mock server returns 404 for unknown routes', async () => {
  await withMock(async (url) => {
    const response = await fetch(`${url}/nope`);
    assert.equal(response.status, 404);
    const body = (await response.json()) as { error: string };
    assert.equal(body.error, 'not_found');
  });
});

test('the mock server exposes a route table', async () => {
  await withMock(async (url) => {
    const response = await fetch(`${url}/_apicovenant/routes`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { routes: Array<{ method: string; path: string }> };
    assert.ok(body.routes.length > 0);
    assert.ok(body.routes.some((route) => route.path === '/users'));
  });
});

async function withSpec<T>(specText: string, fn: (url: string) => Promise<T>): Promise<T> {
  const spec = loadSpecFromText(specText);
  const handle = await startMockServer(spec);
  try {
    return await fn(handle.url);
  } finally {
    await handle.close();
  }
}

test('the mock server routes a path with a parameter suffix', async () => {
  // BUG-19: "/files/{name}.json" used to be treated as a literal segment.
  await withSpec(
    JSON.stringify({
      openapi: '3.0.3',
      info: { title: 'Files', version: '1.0.0' },
      paths: {
        '/files/{name}.json': {
          get: {
            operationId: 'getFile',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { type: 'object', properties: { name: { type: 'string' } } },
                  },
                },
              },
            },
          },
        },
      },
    }),
    async (url) => {
      const response = await fetch(`${url}/files/report.json`);
      assert.equal(response.status, 200);
      const body = (await response.json()) as { name: string };
      assert.equal(typeof body.name, 'string');
    },
  );
});

test('a 405 response lists the methods the route really supports', async () => {
  // BUG-6: the Allow header came from the first matching route only.
  await withMock(async (url) => {
    const response = await fetch(`${url}/users`, { method: 'DELETE' });
    assert.equal(response.status, 405);
    const allow = response.headers.get('allow') ?? '';
    assert.ok(allow.includes('GET'), `Allow was "${allow}"`);
    assert.ok(allow.includes('POST'), `Allow was "${allow}"`);
  });
});

test('the mock server falls back to the documented default response', async () => {
  // BUG-7: an undocumented status code used to be answered with the 200 body.
  await withSpec(
    JSON.stringify({
      openapi: '3.0.3',
      info: { title: 'Widgets', version: '1.0.0' },
      paths: {
        '/widgets': {
          get: {
            operationId: 'listWidgets',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { type: 'object', properties: { name: { type: 'string' } } },
                  },
                },
              },
              default: {
                description: 'error',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['code'],
                      properties: { code: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
    async (url) => {
      const response = await fetch(`${url}/widgets?x-mock-status=503`);
      assert.equal(response.status, 503);
      const body = (await response.json()) as Record<string, unknown>;
      assert.ok('code' in body, `default response body was ${JSON.stringify(body)}`);
    },
  );
});

test('an operation-level x-mock.status wins over the query parameter', async () => {
  // BUG-20: "?x-mock-status=503" used to override "x-mock.status: 500".
  await withSpec(
    JSON.stringify({
      openapi: '3.0.3',
      info: { title: 'Widgets', version: '1.0.0' },
      paths: {
        '/widgets': {
          get: {
            operationId: 'listWidgets',
            'x-mock': { status: 500, body: { code: 'boom' } },
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { type: 'object', properties: { name: { type: 'string' } } },
                  },
                },
              },
            },
          },
        },
      },
    }),
    async (url) => {
      const response = await fetch(`${url}/widgets?x-mock-status=503`);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { code: 'boom' });
    },
  );
});

test('the recorder forwards a decompressed body without stale framing headers', async () => {
  // BUG-1: content-encoding/content-length/transfer-encoding used to be
  // forwarded verbatim, describing the compressed byte stream.
  const payload = JSON.stringify({ items: [1, 2, 3], note: 'compressed body' });
  const upstream = http.createServer((_request, response) => {
    const compressed = gzipSync(payload);
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      'Content-Length': String(compressed.length),
    });
    response.end(compressed);
  });

  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  const recorder = await startRecorder({ target: `http://127.0.0.1:${port}` });
  const response = await fetch(`${recorder.url}/download`);
  const golden = recorder.stop();

  await new Promise<void>((resolve) => upstream.close(() => resolve()));

  assert.equal(response.status, 200);
  // The forwarded body is decompressed, so none of the compressed-stream
  // framing headers may survive: fetch() would reject a body whose
  // content-length disagrees with the bytes it actually received. Node
  // re-frames the response (chunked) instead of passing the stale length on.
  assert.equal(response.headers.get('content-encoding'), null);
  assert.equal(response.headers.get('content-length'), null);
  assert.deepEqual(await response.json(), { items: [1, 2, 3], note: 'compressed body' });

  const interaction = golden.interactions[0];
  assert.ok(interaction);
  // The recording keeps the upstream headers verbatim but the body it stores
  // is the decompressed text.
  assert.equal(interaction.responseHeaders['content-encoding'], 'gzip');
  assert.equal(interaction.bodyType, 'json');
  assert.deepEqual(JSON.parse(interaction.body), { items: [1, 2, 3], note: 'compressed body' });
});

test('the mock server honours the x-mock-status query parameter', async () => {
  await withMock(async (url) => {
    const response = await fetch(`${url}/users?x-mock-status=404`);
    assert.equal(response.status, 404);
  });
});

test('recording captures traffic and the diff finds no drift', async () => {
  const spec = await loadSpecFile(shopSpecPath);
  const mock = await startMockServer(spec);
  const recorder = await startRecorder({ target: mock.url, maxRequests: 2 });

  await fetch(`${recorder.url}/users`);
  await fetch(`${recorder.url}/users/usr_1001`);

  const golden = recorder.stop();
  await mock.close();

  assert.equal(golden.interactions.length, 2);
  assert.equal(golden.interactions[0]?.method, 'GET');
  assert.equal(golden.interactions[0]?.path, '/users');
  assert.equal(golden.interactions[0]?.status, 200);

  const second = await startMockServer(spec);
  const report = await compareGolden(golden, new HttpLiveSource(second.url), { spec });
  await second.close();

  assert.equal(report.summary.failed, 0);
  assert.equal(report.summary.changed, 0, JSON.stringify(report.interactions, null, 2));
  assert.equal(report.summary.unchanged, 2);
});

test('the diff detects a drifted response', async () => {
  const golden = parseGoldenFile(
    serializeGoldenFile({
      apicovenant: 1,
      recordedAt: new Date().toISOString(),
      target: 'http://legacy.example.com',
      interactions: [
        {
          method: 'GET',
          path: '/items',
          query: {},
          requestHeaders: {},
          status: 200,
          responseHeaders: { 'content-type': 'application/json' },
          body: JSON.stringify({ items: [{ id: 'a', price: 10 }], total: 1 }),
          bodyType: 'json',
          durationMs: 5,
        },
      ],
    }),
  );

  const drifted = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ items: [{ id: 'a', price: 12 }], total: 2 }));
  });

  await new Promise<void>((resolve) => drifted.listen(0, '127.0.0.1', resolve));
  const address = drifted.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  const report = await compareGolden(golden, new HttpLiveSource(`http://127.0.0.1:${port}`));

  await new Promise<void>((resolve) => drifted.close(() => resolve()));

  assert.equal(report.summary.changed, 1);
  const interaction = report.interactions[0];
  assert.ok(interaction);
  const paths = interaction.body.differences.map((difference) => difference.path);
  assert.ok(paths.includes('/items/0/price'), JSON.stringify(paths));
  assert.ok(paths.includes('/total'), JSON.stringify(paths));
});

test('the recorder redacts credentials', async () => {
  const upstream = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'session=abc' });
    response.end('{"ok":true}');
  });

  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  const recorder = await startRecorder({ target: `http://127.0.0.1:${port}` });
  await fetch(`${recorder.url}/secure`, { headers: { Authorization: 'Bearer super-secret' } });
  const golden = recorder.stop();

  await new Promise<void>((resolve) => upstream.close(() => resolve()));

  const interaction = golden.interactions[0];
  assert.ok(interaction);
  assert.equal(interaction.requestHeaders['authorization'], '<redacted>');
  assert.equal(interaction.responseHeaders['set-cookie'], '<redacted>');
});
