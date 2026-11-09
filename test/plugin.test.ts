import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const bin = join(root, 'bin', 'apicovenant.mjs');
const fixture = (name: string) => join(here, 'fixtures', name);

const SPEC = {
  openapi: '3.0.3',
  info: { title: 'Plugin', version: '1.0.0' },
  paths: {
    '/todo': {
      get: {
        operationId: 'todo',
        summary: 'TO' + 'DO finish this operation',
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
  },
};

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd });
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

async function setup(plugin: string, only: string[]): Promise<{
  directory: string;
  spec: string;
  config: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'apicovenant-plugin-'));
  const spec = join(directory, 'openapi.json');
  const config = join(directory, 'apicovenant.config.json');
  await writeFile(spec, JSON.stringify(SPEC));
  await writeFile(
    config,
    JSON.stringify({
      version: 2,
      plugins: [fixture(plugin)],
      lint: { rules: { only } },
    }),
  );
  return { directory, spec, config };
}

test('a plugin rule is visible in the catalogue and triggers in lint', async () => {
  const { directory, spec, config } = await setup('team-plugin.mjs', ['team-no-todo-summary']);
  try {
    const catalogue = await runCli(['rules', '--config', config], directory);
    assert.equal(catalogue.code, 0, catalogue.stderr);
    assert.match(catalogue.stdout, /team-no-todo-summary/);
    assert.match(catalogue.stdout, /plugin: .*team-plugin\.mjs/);

    const lint = await runCli(['lint', spec, '--config', config, '--fail-on', 'warn'], directory);
    assert.equal(lint.code, 1, lint.stderr);
    assert.match(lint.stdout, /team-no-todo-summary/);
    assert.match(lint.stdout, /contains TO/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a plugin reporter registers a new --format', async () => {
  const { directory, spec, config } = await setup('team-plugin.mjs', ['team-no-todo-summary']);
  try {
    const result = await runCli(
      ['lint', spec, '--config', config, '--format', 'team', '--fail-on', 'never'],
      directory,
    );
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /team report: 1 findings/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a throwing plugin names its file and exits with code 3', async () => {
  const { directory, spec, config } = await setup('throw-plugin.mjs', ['team-exploding']);
  try {
    const result = await runCli(['lint', spec, '--config', config], directory);
    assert.equal(result.code, 3, result.stderr);
    assert.match(result.stderr, /team-exploding/);
    assert.match(result.stderr, /throw-plugin\.mjs/);
    assert.match(result.stderr, /boom from the plugin/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a plugin cannot shadow a built-in rule id', async () => {
  const { directory, spec, config } = await setup('conflict-plugin.mjs', ['path-no-trailing-slash']);
  try {
    const result = await runCli(['lint', spec, '--config', config], directory);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /conflict with built-in rules/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('--no-plugins ignores configured plugins', async () => {
  const { directory, spec, config } = await setup('team-plugin.mjs', ['team-no-todo-summary']);
  try {
    const result = await runCli(['lint', spec, '--config', config, '--no-plugins'], directory);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /unknown rule/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a plugin preset can be used through extends', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'apicovenant-plugin-preset-'));
  const spec = join(directory, 'openapi.json');
  const config = join(directory, 'apicovenant.config.json');
  await writeFile(spec, JSON.stringify(SPEC));
  await writeFile(
    config,
    JSON.stringify({ version: 2, plugins: [fixture('team-plugin.mjs')], extends: ['team'] }),
  );
  try {
    const result = await runCli(['lint', spec, '--config', config, '--fail-on', 'warn'], directory);
    assert.equal(result.code, 1, result.stderr);
    assert.match(result.stdout, /team-no-todo-summary/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
