import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

import { startRecorder } from '../src/record/recorder.ts';
import { serializeGoldenFile } from '../src/record/golden.ts';
import { compareGolden, HttpLiveSource, mergeHeaders } from '../src/diff/compare.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, '..', 'bin', 'apicovenant.mjs');
const TOKEN = 'Bearer REALTOKEN';

function authUpstream(): http.Server {
  return http.createServer((request, response) => {
    if (request.headers.authorization !== TOKEN) {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end('{"error":"unauthorized"}');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"users":[]}');
  });
}

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd: path.join(here, '..') });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

test('mergeHeaders drops redacted values and lets overrides win case-insensitively', () => {
  const merged = mergeHeaders(
    { authorization: '<redacted>', 'x-auth-token': '<redacted>', accept: 'application/json' },
    { Authorization: 'Bearer new' },
  );
  assert.deepEqual(merged, { accept: 'application/json', Authorization: 'Bearer new' });
});

test('a redacted credential is not forwarded literally', async () => {
  const upstream = authUpstream();
  const target = await listen(upstream);
  const recorder = await startRecorder({ target, port: 0 });

  try {
    await fetch(`${recorder.url}/users`, { headers: { Authorization: TOKEN } });
    const golden = recorder.stop();
    assert.equal(golden.interactions[0]!.requestHeaders.authorization, '<redacted>');

    // Without --header the redacted placeholder must not be sent, and the
    // 401 that comes back is reported as drift rather than silently ignored.
    const withoutHeader = await compareGolden(golden, new HttpLiveSource(target));
    assert.equal(withoutHeader.summary.changed, 1);
    assert.equal(withoutHeader.interactions[0]!.status.after, 401);

    const withHeader = await compareGolden(
      golden,
      new HttpLiveSource(target, undefined, { Authorization: TOKEN }),
    );
    assert.equal(withHeader.summary.changed, 0, JSON.stringify(withHeader.interactions[0]));
    assert.equal(withHeader.interactions[0]!.status.after, 200);
  } finally {
    recorder.stop();
    upstream.close();
  }
});

test('diff accepts -H and --header on the command line', async () => {
  const upstream = authUpstream();
  const target = await listen(upstream);
  const recorder = await startRecorder({ target, port: 0 });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apicovenant-auth-'));
  const goldenPath = path.join(directory, 'golden.json');

  try {
    await fetch(`${recorder.url}/users`, { headers: { Authorization: TOKEN } });
    await fs.writeFile(goldenPath, serializeGoldenFile(recorder.stop()));

    const withoutHeader = await runCli(['diff', '--golden', goldenPath, '--target', target]);
    assert.equal(withoutHeader.code, 1, withoutHeader.stderr);

    const withHeader = await runCli([
      'diff',
      '--golden',
      goldenPath,
      '--target',
      target,
      '-H',
      `Authorization: ${TOKEN}`,
    ]);
    assert.equal(withHeader.code, 0, withHeader.stderr);
    assert.match(withHeader.stdout, /the contract held|unchanged/);

    const malformed = await runCli([
      'diff',
      '--golden',
      goldenPath,
      '--target',
      target,
      '-H',
      'not-a-header',
    ]);
    assert.equal(malformed.code, 2);
    assert.match(malformed.stderr, /invalid header/);
  } finally {
    recorder.stop();
    upstream.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
