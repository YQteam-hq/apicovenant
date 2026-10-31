import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { startRecorder } from '../src/record/recorder.ts';

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test('the recorder forwards a streaming response chunk by chunk', async () => {
  const upstream = http.createServer((request, response) => {
    if (request.url === '/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write('data: one\n\n');
      setTimeout(() => {
        response.write('data: two\n\n');
        response.end();
      }, 600);
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"ok":true}');
  });
  const target = await listen(upstream);
  const recorder = await startRecorder({ target, port: 0 });

  try {
    const started = Date.now();
    const response = await fetch(`${recorder.url}/events`);
    assert.equal(response.status, 200);

    const reader = response.body!.getReader();
    const first = await reader.read();
    const firstChunkAt = Date.now() - started;
    const firstText = Buffer.from(first.value ?? new Uint8Array()).toString('utf8');

    // The first event must arrive while the upstream is still open. With
    // buffering it would only be delivered after the 600 ms delay.
    assert.match(firstText, /data: one/);
    assert.ok(firstChunkAt < 400, `first chunk arrived after ${firstChunkAt} ms`);

    const rest: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest.push(Buffer.from(value).toString('utf8'));
    }
    assert.match(rest.join(''), /data: two/);

    const golden = recorder.stop();
    assert.equal(golden.interactions.length, 1);
    assert.match(golden.interactions[0]!.body, /data: one[\s\S]*data: two/);
  } finally {
    recorder.stop();
    upstream.close();
  }
});

test('an upstream that aborts mid-stream does not kill the recorder', async () => {
  let requests = 0;
  const upstream = http.createServer((request, response) => {
    requests += 1;
    if (request.url === '/boom') {
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.write('partial');
      setTimeout(() => response.destroy(), 20);
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"ok":true}');
  });
  const target = await listen(upstream);
  const recorder = await startRecorder({ target, port: 0 });

  try {
    const broken = await fetch(`${recorder.url}/boom`);
    await broken.text();

    const alive = await fetch(`${recorder.url}/health`);
    assert.equal(alive.status, 200);
    assert.deepEqual(await alive.json(), { ok: true });
    assert.equal(requests, 2);
  } finally {
    recorder.stop();
    upstream.close();
  }
});

test('a client that disconnects from an endless stream still records the interaction', async () => {
  const upstream = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write('data: hello\n\n');
    const timer = setInterval(() => response.write('data: tick\n\n'), 50);
    request.on('close', () => clearInterval(timer));
  });
  const target = await listen(upstream);
  const recorder = await startRecorder({ target, port: 0 });

  try {
    const controller = new AbortController();
    const response = await fetch(`${recorder.url}/events`, { signal: controller.signal });
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();

    for (let i = 0; i < 40 && recorder.count() === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    assert.equal(recorder.count(), 1);
    const golden = recorder.stop();
    assert.equal(golden.interactions[0]!.status, 200);
    assert.match(golden.interactions[0]!.body, /data: hello/);
  } finally {
    recorder.stop();
    upstream.close();
  }
});
