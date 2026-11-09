import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseYaml } from '../src/yaml/parser.ts';
import { loadSpecFile, loadSpecFromText } from '../src/spec/loader.ts';
import { startMockServer } from '../src/mock/server.ts';
import { parseConfigFile } from '../src/config.ts';

test('YAML parser rejects documents above the byte, line and alias limits', () => {
  assert.throws(() => parseYaml(`a: ${'x'.repeat(20 * 1024 * 1024 + 1)}`), /20 MB limit/);
  assert.throws(() => parseYaml(Array.from({ length: 500_001 }, () => '').join('\n')), /line limit/);
  assert.throws(() => parseYaml(`a: ${'*x '.repeat(10_001)}`), /alias limit/);
});

test('the spec loader rejects an oversized in-memory or on-disk document', async () => {
  assert.throws(
    () => loadSpecFromText('x'.repeat(20 * 1024 * 1024 + 1), { document: 'big.json' }),
    /20 MB limit/,
  );

  const directory = await mkdtemp(join(tmpdir(), 'apicovenant-hardening-'));
  try {
    const file = join(directory, 'big.yaml');
    await writeFile(file, Buffer.alloc(20 * 1024 * 1024 + 1, 120));
    await assert.rejects(loadSpecFile(file), /20 MB limit/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the v2 mock section accepts strictUnknown', () => {
  const config = parseConfigFile(
    JSON.stringify({ version: 2, mock: { strictUnknown: true } }),
    'apicovenant.config.json',
  );
  assert.equal(config.mock?.strictUnknown, true);
  assert.throws(
    () => parseConfigFile(JSON.stringify({ version: 2, mock: { strictUnknown: 'yes' } }), 'apicovenant.config.json'),
    /strictUnknown/,
  );
});

test('the mock server keeps bounded HTTP timeouts', async () => {  const spec = loadSpecFromText(
    JSON.stringify({
      openapi: '3.0.3',
      info: { title: 'Timeout', version: '1.0.0' },
      paths: { '/health': { get: { responses: { '200': { description: 'ok' } } } } },
    }),
  );
  const handle = await startMockServer(spec, { host: '127.0.0.1', port: 0 });
  try {
    assert.equal(handle.server.headersTimeout, 60_000);
    assert.equal(handle.server.requestTimeout, 300_000);
    assert.equal(handle.server.keepAliveTimeout, 0);
  } finally {
    await handle.close();
  }
});

test('an out-of-range port is rejected', async () => {
  const spec = loadSpecFromText(
    JSON.stringify({
      openapi: '3.0.3',
      info: { title: 'Port', version: '1.0.0' },
      paths: { '/health': { get: { responses: { '200': { description: 'ok' } } } } },
    }),
  );
  await assert.rejects(startMockServer(spec, { host: '127.0.0.1', port: 70000 }));
});

test('the mock server warns when binding to a non-loopback host', async () => {
  const spec = loadSpecFromText(
    JSON.stringify({
      openapi: '3.0.3',
      info: { title: 'Bind', version: '1.0.0' },
      paths: { '/health': { get: { responses: { '200': { description: 'ok' } } } } },
    }),
  );
  const original = process.stderr.write;
  let output = '';
  process.stderr.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  let handle: Awaited<ReturnType<typeof startMockServer>> | undefined;
  try {
    handle = await startMockServer(spec, { host: '0.0.0.0', port: 0 });
  } finally {
    process.stderr.write = original;
    if (handle) await handle.close();
  }
  assert.match(output, /non-loopback host 0\.0\.0\.0/);
});

test('the default 10 MB body limit answers 413', async () => {
  const spec = loadSpecFromText(
    JSON.stringify({
      openapi: '3.0.3',
      info: { title: 'Body', version: '1.0.0' },
      paths: {
        '/items': {
          post: {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: { type: 'object' } } },
            },
            responses: { '201': { description: 'created' } },
          },
        },
      },
    }),
  );
  const handle = await startMockServer(spec, { host: '127.0.0.1', port: 0, strict: true });
  try {
    const response = await fetch(`${handle.url}/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(11 * 1024 * 1024) }),
    });
    assert.equal(response.status, 413);
    const body = await response.json() as { error: string };
    assert.equal(body.error, 'payload_too_large');
  } finally {
    await handle.close();
  }
});
