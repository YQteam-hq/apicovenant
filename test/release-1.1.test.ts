import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ConfigError, loadConfig, parseConfigFile } from '../src/config.ts';
import { createGoldenFile, parseGoldenFile, serializeGoldenFile } from '../src/record/golden.ts';
import { compareGolden, matchesPointerPattern, type LiveSource } from '../src/diff/compare.ts';
import { runMigrate } from '../src/cli/commands/migrate.ts';
import { lint } from '../src/lint/engine.ts';
import { loadSpecFromText } from '../src/spec/loader.ts';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'apicovenant-11-'));
}

test('golden v1 files are normalised into the v2 model', () => {
  const file = parseGoldenFile(
    JSON.stringify({
      apicovenant: 1,
      recordedAt: '2026-01-01T00:00:00.000Z',
      target: 'http://api',
      interactions: [
        {
          method: 'get',
          path: '/users',
          query: { tag: 'a' },
          status: 200,
          responseHeaders: { 'set-cookie': 'a=1' },
          body: '{}',
          bodyType: 'json',
          durationMs: 3,
        },
      ],
    }),
  );
  assert.equal(file.apicovenant, 2);
  assert.equal(file.interactions[0].bodyEncoding, undefined);
  assert.equal(file.interactions[0].requestBody, undefined);
  assert.equal(file.interactions[0].method, 'GET');
});

test('golden v2 keeps repeated values, the request body and base64 bodies', () => {
  const file = createGoldenFile('http://api');
  file.interactions.push({
    method: 'POST',
    path: '/files',
    query: { tag: ['a', 'b'] },
    requestHeaders: { 'content-type': 'application/octet-stream' },
    requestBody: 'AAEC',
    requestBodyEncoding: 'base64',
    status: 201,
    responseHeaders: { 'set-cookie': ['a=1', 'b=2'] },
    body: 'iVBORw0KGgo=',
    bodyType: 'binary',
    bodyEncoding: 'base64',
    durationMs: 5,
  });

  const parsed = parseGoldenFile(serializeGoldenFile(file));
  assert.deepEqual(parsed.interactions[0].query, { tag: ['a', 'b'] });
  assert.deepEqual(parsed.interactions[0].responseHeaders['set-cookie'], ['a=1', 'b=2']);
  assert.equal(parsed.interactions[0].requestBody, 'AAEC');
  assert.equal(parsed.interactions[0].bodyEncoding, 'base64');
  assert.equal(parsed.interactions[0].bodyType, 'binary');
});

test('an unknown golden version is rejected', () => {
  assert.throws(
    () => parseGoldenFile(JSON.stringify({ apicovenant: 3, interactions: [] })),
    /unsupported golden file format version 3/,
  );
});

test('migrate writes a v2 golden file', async () => {
  const dir = tempDir();
  const source = path.join(dir, 'traffic.json');
  const target = path.join(dir, 'traffic.v2.json');
  fs.writeFileSync(
    source,
    JSON.stringify({
      apicovenant: 1,
      recordedAt: '2026-01-01T00:00:00.000Z',
      target: 'http://api',
      interactions: [{ method: 'GET', path: '/x', query: {}, status: 200, body: 'ok', bodyType: 'text' }],
    }),
  );

  const originalWrite = process.stdout.write;
  process.stdout.write = (() => true) as unknown as typeof process.stdout.write;
  try {
    await runMigrate({ golden: source, output: target });
  } finally {
    process.stdout.write = originalWrite;
  }
  const migrated = JSON.parse(fs.readFileSync(target, 'utf8')) as { apicovenant: number; interactions: unknown[] };
  assert.equal(migrated.apicovenant, 2);
  assert.equal(migrated.interactions.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a v2 configuration accepts per-command sections and rule levels', () => {
  const config = parseConfigFile(
    JSON.stringify({
      version: 2,
      extends: ['apicovenant:recommended'],
      lint: { rules: { 'operation-id-required': 'off', 'tag-description-required': 'warn' }, failOn: 'never' },
      diff: { ignoreHeaders: ['etag'], ignorePaths: ['/meta/**'] },
      breaking: { failOn: 'risky', ignoreChanges: ['deprecated-added'] },
      coverage: { min: 80, failOn: 'gap' },
    }),
    'x.json',
  );
  assert.equal(config.version, 2);
  assert.equal(config.lint?.rules?.levels?.['operation-id-required'], 'off');
  assert.deepEqual(config.diff?.ignoreHeaders, ['etag']);
  assert.equal(config.breaking?.failOn, 'risky');
  assert.equal(config.coverage?.min, 80);
});

test('unknown v2 sections and keys are rejected', () => {
  assert.throws(
    () => parseConfigFile(JSON.stringify({ version: 2, lint: { nope: true } }), 'x.json'),
    (error: unknown) => error instanceof ConfigError && /unknown setting "nope"/.test((error as Error).message),
  );
  assert.throws(
    () => parseConfigFile(JSON.stringify({ version: 2, reporter: {} }), 'x.json'),
    /unknown setting "reporter"/,
  );
  assert.throws(
    () => parseConfigFile(JSON.stringify({ version: 2, coverage: { min: 120 } }), 'x.json'),
    /min must be an integer from 0 to 100/,
  );
});

test('a local preset is merged before the document settings', async () => {
  const dir = tempDir();
  fs.writeFileSync(
    path.join(dir, 'team-preset.json'),
    JSON.stringify({ version: 2, lint: { severity: 'warn', failOn: 'never' } }),
  );
  fs.writeFileSync(
    path.join(dir, 'apicovenant.config.json'),
    JSON.stringify({ version: 2, extends: ['./team-preset.json'], lint: { severity: 'error' } }),
  );

  const loaded = await loadConfig({ cwd: dir });
  assert.equal(loaded.config.lint?.severity, 'error');
  assert.equal(loaded.config.lint?.failOn, 'never');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rule-level severity disables a rule', () => {
  const spec = loadSpecFromText(
    JSON.stringify({
      openapi: '3.0.3',
      info: { title: 'No operation ids', version: '1' },
      paths: { '/x': { get: { responses: { '200': { description: 'ok' } } } } },
    }),
  );
  const withRule = lint(spec);
  assert.ok(withRule.findings.some((finding) => finding.ruleId === 'operation-id-required'));

  const withoutRule = lint(spec, { ruleLevels: { 'operation-id-required': 'off' } });
  assert.ok(!withoutRule.findings.some((finding) => finding.ruleId === 'operation-id-required'));
});

test('diff noise control filters headers and body pointers', async () => {
  const file = createGoldenFile('http://api');
  file.interactions.push({
    method: 'GET',
    path: '/items/1',
    query: {},
    requestHeaders: {},
    status: 200,
    responseHeaders: { etag: 'old', 'content-type': 'application/json' },
    body: JSON.stringify({ updatedAt: 'old', stable: 1 }),
    bodyType: 'json',
    durationMs: 1,
  });

  const source: LiveSource = {
    description: 'fake',
    request: async () => ({
      status: 200,
      headers: { etag: 'new', 'content-type': 'application/json' },
      body: JSON.stringify({ updatedAt: 'new', stable: 1 }),
    }),
  };

  const noisy = await compareGolden(file, source);
  assert.equal(noisy.summary.changed, 1);

  const quiet = await compareGolden(file, source, {
    ignoreHeaders: ['etag'],
    ignorePaths: ['/updatedAt'],
  });
  assert.equal(quiet.summary.changed, 0);
  assert.equal(quiet.interactions[0].body.changed, false);
});

test('pointer patterns understand single and double stars', () => {
  assert.equal(matchesPointerPattern('/items/1/updatedAt', '/items/*/updatedAt'), true);
  assert.equal(matchesPointerPattern('/items/1/meta/x', '/items/**'), true);
  assert.equal(matchesPointerPattern('/meta/a/b/c', '/meta/**'), true);
  assert.equal(matchesPointerPattern('/meta', '/meta/**'), true);
  assert.equal(matchesPointerPattern('/other', '/meta/**'), false);
});
