import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

import { loadSpecFromText } from '../src/spec/loader.ts';
import { startMockServer } from '../src/mock/server.ts';

const BASE_SPEC = {
  openapi: '3.0.3',
  info: { title: 'Robustness', version: '1.0.0' },
  paths: {
    '/users/{id}': {
      get: {
        operationId: 'getUser',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { id: { type: 'string' } } },
              },
            },
          },
        },
      },
    },
  },
};

async function withJsonSpec<T>(spec: unknown, fn: (url: string) => Promise<T>): Promise<T> {
  const handle = await startMockServer(loadSpecFromText(JSON.stringify(spec)));
  try {
    return await fn(handle.url);
  } finally {
    await handle.close();
  }
}

function sendRaw(port: number, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(payload));
    let received = '';
    socket.setTimeout(2000);
    socket.on('data', (chunk) => {
      received += chunk.toString('latin1');
    });
    socket.on('end', () => resolve(received));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(received);
    });
    socket.on('error', reject);
  });
}

test('an invalid x-mock-status answers 400 instead of killing the server', async () => {
  await withJsonSpec(BASE_SPEC, async (url) => {
    for (const value of ['-1', '0', '99', '1000', '999999', '1e3', '12.5', 'abc']) {
      const response = await fetch(`${url}/users/1?x-mock-status=${encodeURIComponent(value)}`);
      assert.equal(response.status, 400, `x-mock-status=${value} produced ${response.status}`);
      const body = (await response.json()) as { error: string };
      assert.equal(body.error, 'invalid_mock_status');
    }

    const alive = await fetch(`${url}/users/1`);
    assert.equal(alive.status, 200);
  });
});

test('a valid x-mock-status still overrides the documented response', async () => {
  await withJsonSpec(BASE_SPEC, async (url) => {
    const response = await fetch(`${url}/users/1?x-mock-status=404`);
    assert.equal(response.status, 404);
  });
});

test('a malformed percent escape in a path parameter does not crash the server', async () => {
  await withJsonSpec(BASE_SPEC, async (url) => {
    const port = Number(new URL(url).port);
    const response = await sendRaw(
      port,
      'GET /users/%ZZ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n',
    );
    assert.match(response, /^HTTP\/1\.1 200/);

    const alive = await fetch(`${url}/users/1`);
    assert.equal(alive.status, 200);
  });
});

test('a Host header that is not a valid URL authority does not crash the server', async () => {
  await withJsonSpec(BASE_SPEC, async (url) => {
    const port = Number(new URL(url).port);
    const response = await sendRaw(port, 'GET /users/1 HTTP/1.1\r\nHost: a b\r\nConnection: close\r\n\r\n');
    assert.match(response, /^HTTP\/1\.1 200/);

    const alive = await fetch(`${url}/users/1`);
    assert.equal(alive.status, 200);
  });
});

test('an operation that only documents "default" is answered with a real status code', async () => {
  await withJsonSpec(
    {
      openapi: '3.0.3',
      info: { title: 'Default only', version: '1.0.0' },
      paths: {
        '/hook': {
          post: {
            operationId: 'hook',
            responses: {
              default: {
                description: 'anything',
                content: {
                  'application/json': {
                    schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (url) => {
      const response = await fetch(`${url}/hook`, { method: 'POST' });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { ok: boolean };
      assert.equal(typeof body.ok, 'boolean');
    },
  );
});

test('a "2XX" response class is treated as the documented success response', async () => {
  await withJsonSpec(
    {
      openapi: '3.1.0',
      info: { title: 'Wildcard', version: '1.0.0' },
      paths: {
        '/widgets': {
          get: {
            operationId: 'listWidgets',
            responses: {
              '2XX': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
                  },
                },
              },
              '4XX': {
                description: 'error',
                content: {
                  'application/json': {
                    schema: { type: 'object', required: ['code'], properties: { code: { type: 'string' } } },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (url) => {
      const ok = await fetch(`${url}/widgets`);
      assert.equal(ok.status, 200);
      assert.ok('name' in ((await ok.json()) as Record<string, unknown>));

      const notFound = await fetch(`${url}/widgets?x-mock-status=404`);
      assert.equal(notFound.status, 404);
      assert.ok('code' in ((await notFound.json()) as Record<string, unknown>));
    },
  );
});
