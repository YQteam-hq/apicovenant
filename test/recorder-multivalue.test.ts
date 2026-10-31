import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { startRecorder } from '../src/record/recorder.ts';
import { compareGolden, HttpLiveSource } from '../src/diff/compare.ts';
import { interactionKey, parseGoldenFile, queryPairs, serializeGoldenFile } from '../src/record/golden.ts';

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test('a repeated query parameter keeps every value in the golden file', async () => {
  const upstream = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"ok":true}');
  });
  const target = await listen(upstream);
  const recorder = await startRecorder({ target, port: 0 });

  try {
    await fetch(`${recorder.url}/users?tag=a&tag=b&page=1`);
    const golden = recorder.stop();
    const query = golden.interactions[0]!.query;
    assert.deepEqual(query.tag, ['a', 'b']);
    assert.equal(query.page, '1');

    // The key must not collapse the two interactions into one.
    assert.equal(interactionKey({ method: 'GET', path: '/users', query: { tag: ['a', 'b'] } }), 'GET /users?tag=a&tag=b');
  } finally {
    recorder.stop();
    upstream.close();
  }
});

test('replay sends repeated query parameters as repeated pairs', async () => {
  const received: string[] = [];
  const upstream = http.createServer((request, response) => {
    received.push(request.url ?? '');
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"ok":true}');
  });
  const target = await listen(upstream);
  const recorder = await startRecorder({ target, port: 0 });

  try {
    await fetch(`${recorder.url}/users?tag=a&tag=b`);
    const golden = recorder.stop();

    const report = await compareGolden(golden, new HttpLiveSource(target));
    assert.equal(report.summary.changed, 0);
    assert.equal(received.at(-1), '/users?tag=a&tag=b');
  } finally {
    recorder.stop();
    upstream.close();
  }
});

test('every Set-Cookie header survives the proxy and the golden file', async () => {
  const upstream = http.createServer((request, response) => {
    response.setHeader('Set-Cookie', ['session=abc; Path=/; HttpOnly', 'theme=dark; Path=/']);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"ok":true}');
  });
  const target = await listen(upstream);
  const recorder = await startRecorder({ target, port: 0 });

  try {
    const response = await fetch(`${recorder.url}/login`);
    await response.text();
    const cookies = response.headers.getSetCookie();
    assert.equal(cookies.length, 2, JSON.stringify(cookies));
    assert.match(cookies[0]!, /session=abc/);
    assert.match(cookies[1]!, /theme=dark/);

    const golden = recorder.stop();
    const recorded = golden.interactions[0]!.responseHeaders['set-cookie'];
    // Cookies are credentials, so they are redacted, but the count must not
    // collapse into a single comma-joined value.
    assert.ok(Array.isArray(recorded), JSON.stringify(recorded));
    assert.equal(recorded.length, 2);
  } finally {
    recorder.stop();
    upstream.close();
  }
});

test('golden files written before multi-value support still parse', () => {
  const legacy = JSON.stringify({
    apicovenant: 1,
    recordedAt: '2026-01-01T00:00:00.000Z',
    target: 'http://127.0.0.1:3000',
    interactions: [
      {
        method: 'GET',
        path: '/users',
        query: { page: '1' },
        requestHeaders: {},
        status: 200,
        responseHeaders: { 'content-type': 'application/json' },
        body: '{"ok":true}',
        bodyType: 'json',
        durationMs: 3,
      },
    ],
  });
  const parsed = parseGoldenFile(legacy);
  assert.equal(parsed.interactions[0]!.query.page, '1');
  assert.equal(interactionKey(parsed.interactions[0]!), 'GET /users?page=1');

  const roundTrip = parseGoldenFile(serializeGoldenFile(parsed));
  assert.deepEqual(roundTrip.interactions[0]!.query, { page: '1' });
  assert.deepEqual(queryPairs({ tag: ['a', 'b'], page: '1' }), [
    ['tag', 'a'],
    ['tag', 'b'],
    ['page', '1'],
  ]);
});
