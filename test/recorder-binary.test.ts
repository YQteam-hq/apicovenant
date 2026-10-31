import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { startRecorder } from '../src/record/recorder.ts';
import { compareGolden, HttpLiveSource } from '../src/diff/compare.ts';
import { encodeBody, decodeBody } from '../src/record/golden.ts';

// A 16 byte PNG signature plus bytes that are not valid UTF-8.
const BINARY = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x01, 0x80, 0x81, 0xc3, 0x28]);

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test('a binary response reaches the client byte for byte and is stored losslessly', async () => {
  const upstream = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'image/png' });
    response.end(BINARY);
  });
  const target = await listen(upstream);
  const recorder = await startRecorder({ target, port: 0 });

  try {
    const response = await fetch(`${recorder.url}/logo.png`);
    const received = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(received, BINARY);

    const golden = recorder.stop();
    const interaction = golden.interactions[0]!;
    assert.equal(interaction.bodyType, 'binary');
    assert.equal(interaction.bodyEncoding, 'base64');
    assert.deepEqual(decodeBody(interaction.body, interaction.bodyEncoding), BINARY);
  } finally {
    recorder.stop();
    upstream.close();
  }
});

test('a binary upload reaches the upstream byte for byte', async () => {
  const seen: Buffer[] = [];
  const upstream = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      seen.push(Buffer.concat(chunks));
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"ok":true}');
    });
  });
  const target = await listen(upstream);
  const recorder = await startRecorder({ target, port: 0 });

  try {
    const response = await fetch(`${recorder.url}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: BINARY,
    });
    assert.equal(response.status, 200);
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0], BINARY);

    const golden = recorder.stop();
    const interaction = golden.interactions[0]!;
    assert.equal(interaction.requestBodyEncoding, 'base64');
    assert.deepEqual(decodeBody(interaction.requestBody ?? '', interaction.requestBodyEncoding), BINARY);
  } finally {
    recorder.stop();
    upstream.close();
  }
});

test('diff replays the recorded request body, not the response body', async () => {
  const received: Buffer[] = [];
  const upstream = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push(Buffer.concat(chunks));
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"accepted":true}');
    });
  });
  const target = await listen(upstream);
  const recorder = await startRecorder({ target, port: 0 });

  try {
    await fetch(`${recorder.url}/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: BINARY,
    });
    const golden = recorder.stop();

    received.length = 0;
    const report = await compareGolden(golden, new HttpLiveSource(target), { replayAll: true });
    assert.equal(report.summary.changed, 0, JSON.stringify(report.interactions[0]));
    assert.deepEqual(received[0], BINARY);
  } finally {
    recorder.stop();
    upstream.close();
  }
});

test('encodeBody round-trips text and binary payloads', () => {
  const text = encodeBody(Buffer.from('{"ok":true}', 'utf8'));
  assert.equal(text.encoding, 'utf8');
  assert.equal(text.body, '{"ok":true}');

  const binary = encodeBody(BINARY);
  assert.equal(binary.encoding, 'base64');
  assert.deepEqual(decodeBody(binary.body, binary.encoding), BINARY);
});
