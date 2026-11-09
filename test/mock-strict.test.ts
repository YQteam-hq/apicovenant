import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadSpecFromText } from '../src/spec/loader.ts';
import { startMockServer } from '../src/mock/server.ts';

const SPEC = {
  openapi: '3.0.3',
  info: { title: 'Strict', version: '1.0.0' },
  paths: {
    '/items/{id}': {
      get: {
        operationId: 'getItem',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1 } },
          { name: 'x-token', in: 'header', required: true, schema: { type: 'string', minLength: 3 } },
        ],
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'integer' } } } } },
          },
        },
      },
    },
    '/items': {
      post: {
        operationId: 'createItem',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'quantity'],
                properties: { name: { type: 'string' }, quantity: { type: 'integer', minimum: 1 } },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'created',
            content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'integer' } } } } },
          },
        },
      },
    },
  },
};

async function withServer<T>(
  options: Parameters<typeof startMockServer>[1],
  fn: (url: string) => Promise<T>,
): Promise<T> {
  const handle = await startMockServer(loadSpecFromText(JSON.stringify(SPEC)), options);
  try {
    return await fn(handle.url);
  } finally {
    await handle.close();
  }
}

const get = (url: string, headers: Record<string, string> = { 'x-token': 'secret' }) =>
  fetch(`${url}/items/1?limit=2`, { headers });

test('strict mode accepts a valid request', async () => {
  await withServer({ strict: true }, async (url) => {
    const response = await get(url);
    assert.equal(response.status, 200);
  });
});

test('strict-unknown rejects undocumented query, header and cookie parameters', async () => {
  await withServer({ strict: true, strictUnknown: true }, async (url) => {
    const query = await fetch(`${url}/items/1?limit=2&unexpected=1`, { headers: { 'x-token': 'secret' } });
    assert.equal(query.status, 400);
    const queryBody = await query.json() as { violations: Array<{ in: string; name: string }> };
    assert.equal(queryBody.violations[0]?.in, 'query');
    assert.equal(queryBody.violations[0]?.name, 'unexpected');

    const header = await fetch(`${url}/items/1?limit=2`, {
      headers: { 'x-token': 'secret', 'x-extra': '1' },
    });
    assert.equal(header.status, 400);
    const headerBody = await header.json() as { violations: Array<{ in: string; name: string }> };
    assert.equal(headerBody.violations[0]?.in, 'header');
    assert.equal(headerBody.violations[0]?.name, 'x-extra');

    const cookie = await fetch(`${url}/items/1?limit=2`, {
      headers: { 'x-token': 'secret', cookie: 'session=abc' },
    });
    assert.equal(cookie.status, 400);
    const cookieBody = await cookie.json() as { violations: Array<{ in: string; name: string }> };
    assert.equal(cookieBody.violations[0]?.in, 'cookie');
    assert.equal(cookieBody.violations[0]?.name, 'session');
  });
});

test('strict-unknown still accepts documented and transport parameters', async () => {
  await withServer({ strict: true, strictUnknown: true }, async (url) => {
    const response = await get(url);
    assert.equal(response.status, 200);

    const controlled = await fetch(`${url}/items/1?limit=2&x-mock-status=404`, {
      headers: { 'x-token': 'secret' },
    });
    assert.equal(controlled.status, 404);
  });
});

test('strict mode rejects a missing required header', async () => {
  await withServer({ strict: true }, async (url) => {
    const response = await fetch(`${url}/items/1`);
    assert.equal(response.status, 400);
    const body = await response.json() as { error: string; violations: Array<{ in: string; name: string }> };
    assert.equal(body.error, 'invalid_request');
    assert.equal(body.violations[0]?.in, 'header');
    assert.equal(body.violations[0]?.name, 'x-token');
  });
});

test('strict mode rejects a non-integer path parameter', async () => {
  await withServer({ strict: true }, async (url) => {
    const response = await fetch(`${url}/items/abc`, { headers: { 'x-token': 'secret' } });
    assert.equal(response.status, 400);
    const body = await response.json() as { violations: Array<{ in: string; message: string }> };
    assert.equal(body.violations[0]?.in, 'path');
    assert.match(body.violations[0]?.message ?? '', /integer/);
  });
});

test('strict mode rejects a query value below its minimum', async () => {
  await withServer({ strict: true }, async (url) => {
    const response = await fetch(`${url}/items/1?limit=0`, { headers: { 'x-token': 'secret' } });
    assert.equal(response.status, 400);
    const body = await response.json() as { violations: Array<{ in: string; name: string }> };
    assert.equal(body.violations[0]?.in, 'query');
    assert.equal(body.violations[0]?.name, 'limit');
  });
});

test('strict mode validates the request body and answers 201 when valid', async () => {
  await withServer({ strict: true }, async (url) => {
    const created = await fetch(`${url}/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'pen', quantity: 2 }),
    });
    assert.equal(created.status, 201);

    const invalid = await fetch(`${url}/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'pen', quantity: 0 }),
    });
    assert.equal(invalid.status, 400);
    const body = await invalid.json() as { violations: Array<{ in: string; path: string }> };
    assert.equal(body.violations[0]?.in, 'body');
    assert.equal(body.violations[0]?.path, '/quantity');
  });
});

test('strict mode answers 400 for a missing or malformed JSON body', async () => {
  await withServer({ strict: true }, async (url) => {
    const missing = await fetch(`${url}/items`, { method: 'POST' });
    assert.equal(missing.status, 400);

    const malformed = await fetch(`${url}/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    assert.equal(malformed.status, 400);
    const body = await malformed.json() as { violations: Array<{ message: string }> };
    assert.match(body.violations[0]?.message ?? '', /JSON/);
  });
});

test('strict mode answers 415 for an undocumented media type', async () => {
  await withServer({ strict: true }, async (url) => {
    const response = await fetch(`${url}/items`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'pen',
    });
    assert.equal(response.status, 415);
    const body = await response.json() as { error: string };
    assert.equal(body.error, 'unsupported_media_type');
  });
});

test('strict mode answers 413 above --max-body', async () => {
  await withServer({ strict: true, maxBody: 32 }, async (url) => {
    const response = await fetch(`${url}/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'pen', quantity: 2, padding: 'x'.repeat(100) }),
    });
    assert.equal(response.status, 413);
    const body = await response.json() as { error: string };
    assert.equal(body.error, 'payload_too_large');
  });
});

test('CORS answers a preflight and actual responses', async () => {
  await withServer({ cors: true }, async (url) => {
    const preflight = await fetch(`${url}/items`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://app.example.com',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
    assert.match(preflight.headers.get('access-control-allow-methods') ?? '', /POST/);
    assert.equal(preflight.headers.get('access-control-allow-headers'), 'content-type');

    const actual = await get(url);
    assert.equal(actual.headers.get('access-control-allow-origin'), '*');
  });
});

test('CORS allow-lists echo a permitted origin only', async () => {
  await withServer({ cors: ['https://app.example.com'] }, async (url) => {
    const allowed = await fetch(`${url}/items/1?limit=2`, {
      headers: { origin: 'https://app.example.com', 'x-token': 'secret' },
    });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://app.example.com');

    const denied = await fetch(`${url}/items/1?limit=2`, {
      headers: { origin: 'https://evil.example.com', 'x-token': 'secret' },
    });
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
  });
});

test('watch reloads the document after a change', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'apicovenant-watch-'));
  const path = join(directory, 'openapi.json');
  await writeFile(path, JSON.stringify(SPEC));

  const handle = await startMockServer(loadSpecFromText(JSON.stringify(SPEC)), {
    watch: true,
    specPath: path,
  });

  try {
    const changed = JSON.parse(JSON.stringify(SPEC)) as { paths: Record<string, unknown> };
    changed.paths['/health'] = {
      get: {
        operationId: 'health',
        parameters: [],
        responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object' } } } } },
      },
    };
    await writeFile(path, JSON.stringify(changed));

    let status = 0;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      status = (await fetch(`${handle.url}/health`)).status;
      if (status === 200) break;
    }
    assert.equal(status, 200);
  } finally {
    await handle.close();
    await rm(directory, { recursive: true, force: true });
  }
});
