import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { diffJson, parseBody } from '../src/diff/json-diff.ts';
import { compareGolden, HttpLiveSource, type LiveSource } from '../src/diff/compare.ts';
import { loadSpecFromText } from '../src/spec/loader.ts';
import {
  parseGoldenFile,
  serializeGoldenFile,
  createGoldenFile,
  interactionKey,
  GOLDEN_FORMAT_VERSION,
} from '../src/record/golden.ts';

test('detects changed primitives', () => {
  const differences = diffJson({ total: 1 }, { total: 2 });
  assert.equal(differences.length, 1);
  assert.equal(differences[0]?.path, '/total');
  assert.equal(differences[0]?.kind, 'changed');
  assert.equal(differences[0]?.before, 1);
  assert.equal(differences[0]?.after, 2);
});

test('detects added and removed properties', () => {
  const differences = diffJson({ a: 1, b: 2 }, { a: 1, c: 3 });
  const added = differences.find((difference) => difference.kind === 'added');
  const removed = differences.find((difference) => difference.kind === 'removed');
  assert.equal(added?.path, '/c');
  assert.equal(removed?.path, '/b');
});

test('reports the path of nested differences', () => {
  const differences = diffJson({ items: [{ id: 'a', price: 10 }] }, { items: [{ id: 'a', price: 12 }] });
  assert.equal(differences.length, 1);
  assert.equal(differences[0]?.path, '/items/0/price');
});

test('detects array growth', () => {
  const differences = diffJson([1, 2], [1, 2, 3]);
  assert.equal(differences.length, 1);
  assert.equal(differences[0]?.kind, 'added');
  assert.equal(differences[0]?.path, '/2');
});

test('detects array shrinkage', () => {
  const differences = diffJson([1, 2, 3], [1, 2]);
  assert.equal(differences.length, 1);
  assert.equal(differences[0]?.kind, 'removed');
});

test('reports no differences for equal documents', () => {
  assert.deepEqual(diffJson({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), []);
});

test('parseBody understands json, text and empty bodies', () => {
  assert.deepEqual(parseBody('{"a":1}', 'json'), { a: 1 });
  assert.equal(parseBody('hello', 'text'), 'hello');
  assert.equal(parseBody('', 'empty'), undefined);
  assert.equal(parseBody('not json', 'json'), 'not json');
});

test('golden files round trip', () => {
  const file = createGoldenFile('http://example.com', 'openapi.yaml');
  file.interactions.push({
    method: 'GET',
    path: '/users',
    query: { page: '2' },
    requestHeaders: {},
    status: 200,
    responseHeaders: { 'content-type': 'application/json' },
    body: '{"ok":true}',
    bodyType: 'json',
    durationMs: 12,
  });

  const parsed = parseGoldenFile(serializeGoldenFile(file));
  assert.equal(parsed.apicovenant, GOLDEN_FORMAT_VERSION);
  assert.equal(parsed.target, 'http://example.com');
  assert.equal(parsed.spec, 'openapi.yaml');
  assert.equal(parsed.interactions.length, 1);
  assert.equal(parsed.interactions[0]?.path, '/users');
  assert.equal(parsed.interactions[0]?.status, 200);
});

test('parseGoldenFile rejects malformed input', () => {
  assert.throws(() => parseGoldenFile('not json'), /not valid JSON/);
  assert.throws(() => parseGoldenFile('{}'), /interactions/);
  assert.throws(() => parseGoldenFile('{"apicovenant":99,"interactions":[]}'), /format version/);
});

test('parseGoldenFile accepts a byte order mark', () => {
  const file = widgetGolden();
  const withBom = `\uFEFF${serializeGoldenFile(file)}`;
  const parsed = parseGoldenFile(withBom);
  assert.equal(parsed.interactions.length, 1);
  assert.equal(parsed.interactions[0]?.path, '/widgets');
});

test('parseGoldenFile reports which interaction is malformed', () => {
  const file = widgetGolden();
  file.interactions.push(null as unknown as (typeof file.interactions)[number]);
  const text = serializeGoldenFile(file);
  assert.throws(() => parseGoldenFile(text), /interactions\[1\] must be an object/);
});

test('interactionKey is stable and includes the query', () => {
  assert.equal(interactionKey({ method: 'GET', path: '/a', query: { b: '2', a: '1' } }), 'GET /a?a=1&b=2');
  assert.equal(interactionKey({ method: 'GET', path: '/a' }), 'GET /a');
});

const WIDGET_SPEC = {
  openapi: '3.0.3',
  info: { title: 'Widgets', version: '1.0.0' },
  paths: {
    '/widgets': {
      get: {
        operationId: 'listWidgets',
        responses: {
          200: {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: { name: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
  },
};

function widgetGolden(): ReturnType<typeof createGoldenFile> {
  const file = createGoldenFile('http://example.com', 'openapi.yaml');
  file.interactions.push({
    method: 'GET',
    path: '/widgets',
    query: {},
    requestHeaders: {},
    status: 200,
    responseHeaders: { 'content-type': 'application/json' },
    body: '{"name":123}',
    bodyType: 'json',
    durationMs: 1,
  });
  return file;
}

function widgetSource(derivedFromSpec: boolean): LiveSource {
  return {
    description: 'test',
    derivedFromSpec,
    async request() {
      return { status: 200, headers: { 'content-type': 'application/json' }, body: '{"name":123}' };
    },
  };
}

test('a schema violation counts as drift against a live API', async () => {
  const spec = loadSpecFromText(JSON.stringify(WIDGET_SPEC));
  const report = await compareGolden(widgetGolden(), widgetSource(false), { spec });
  assert.equal(report.summary.changed, 1);
  assert.equal(report.interactions[0]?.schemaViolations.length, 1);
  assert.equal(report.interactions[0]?.mockViolations.length, 0);
});

test('a mock that breaks its own spec is kept out of the drift verdict', async () => {
  const spec = loadSpecFromText(JSON.stringify(WIDGET_SPEC));
  const report = await compareGolden(widgetGolden(), widgetSource(true), { spec });
  assert.equal(report.summary.changed, 0);
  assert.equal(report.interactions[0]?.schemaViolations.length, 0);
  assert.equal(report.interactions[0]?.mockViolations.length, 1);
});

test('the report addresses an interaction by method, path and query', async () => {
  // BUG-12: the report key used to drop the query string, so two
  // interactions that differed only by query collided.
  const file = createGoldenFile('http://example.com', 'openapi.yaml');
  file.interactions.push({
    method: 'GET',
    path: '/widgets',
    query: { page: '2' },
    requestHeaders: {},
    status: 200,
    responseHeaders: { 'content-type': 'application/json' },
    body: '{"name":123}',
    bodyType: 'json',
    durationMs: 1,
  });

  const report = await compareGolden(file, widgetSource(false));
  assert.equal(report.interactions.length, 1);
  assert.equal(report.interactions[0]?.key, 'GET /widgets?page=2');
  assert.equal(report.summary.changed, 0);
});

test('a dropped connection is retried for a safe request', async () => {
  let attempts = 0;
  const server = http.createServer((request, response) => {
    attempts += 1;
    if (attempts === 1) {
      request.socket.destroy();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"name":123}');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as { port: number };

  try {
    const source = new HttpLiveSource(`http://127.0.0.1:${address.port}`);
    const report = await compareGolden(widgetGolden(), source);
    assert.equal(attempts, 2);
    assert.equal(report.summary.failed, 0);
    assert.equal(report.interactions[0]?.error, undefined);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
