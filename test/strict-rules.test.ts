import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { lint } from '../src/lint/engine.ts';
import { ALL_RULES } from '../src/lint/rules/index.ts';
import { STRICT_RULES } from '../src/lint/rules/strict.ts';
import { loadSpecFromText } from '../src/spec/loader.ts';
import { loadConfig } from '../src/config.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const bin = join(root, 'bin', 'apicovenant.mjs');

const FIXTURE = {
  openapi: '3.1.0',
  info: { title: 'Strict', version: '1.0.0' },
  paths: {
    '/things': {
      post: {
        operationId: 'createThing',
        parameters: [
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer' },
            example: 'many',
          },
        ],
        requestBody: {
          required: true,
          content: { 'text/json': { schema: { type: 'object' } } },
        },
        responses: {
          '201': {
            description: 'created',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
    '/things/{id}': {
      delete: {
        operationId: 'deleteThing',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '204': {
            description: 'deleted',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Thing: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'integer' } },
        example: { id: 'not-an-integer' },
      },
    },
    securitySchemes: {
      oauth: {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: 'http://auth.example.com/authorize',
            tokenUrl: 'https://auth.example.com/token',
            scopes: {},
          },
        },
      },
    },
  },
};

const STRICT_IDS = STRICT_RULES.map((rule) => rule.id);

test('the default catalogue stays at 43 rules and strict adds six', () => {
  assert.equal(ALL_RULES.length, 43);
  assert.equal(STRICT_RULES.length, 6);
  assert.equal(new Set([...ALL_RULES, ...STRICT_RULES].map((rule) => rule.id)).size, 49);
});

test('each strict rule reports on the fixture', () => {
  const spec = loadSpecFromText(JSON.stringify(FIXTURE));
  const result = lint(spec, { extraRules: STRICT_RULES, rules: STRICT_IDS });
  const fired = new Set(result.findings.map((finding) => finding.ruleId));
  for (const id of STRICT_IDS) assert.ok(fired.has(id), `expected ${id} to fire`);
  assert.equal(result.findings.length, 6);
});

test('extends apicovenant:strict enables the pack and keeps recommended at 43', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'apicovenant-strict-'));
  try {
    const configPath = join(directory, 'apicovenant.config.json');
    const specPath = join(directory, 'openapi.json');
    await writeFile(configPath, JSON.stringify({ version: 2, extends: ['apicovenant:strict'] }));
    await writeFile(specPath, JSON.stringify(FIXTURE));

    const loaded = await loadConfig({ explicitPath: configPath });
    assert.equal(loaded.config.strictRules, true);

    const child = spawn(process.execPath, [bin, 'lint', specPath, '--config', configPath, '--format', 'json'], {
      cwd: root,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', resolve);
    });
    assert.equal(code, 1, stderr);
    const report = JSON.parse(stdout) as { findings: Array<{ ruleId: string }> };
    const fired = new Set(report.findings.map((finding) => finding.ruleId));
    for (const id of STRICT_IDS) assert.ok(fired.has(id), `expected ${id} in ${[...fired].join(', ')}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rules --strict lists 49 and plain rules lists 43', async () => {
  const runRules = (args: string[]): Promise<string> =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [bin, 'rules', ...args], { cwd: root });
      let stdout = '';
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.on('error', reject);
      child.on('exit', () => resolve(stdout));
    });

  const recommended = JSON.parse(await runRules(['--format', 'json'])) as unknown[];
  const strict = JSON.parse(await runRules(['--format', 'json', '--strict'])) as unknown[];
  assert.equal(recommended.length, 43);
  assert.equal(strict.length, 49);
});
