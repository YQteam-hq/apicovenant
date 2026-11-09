import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const bin = join(root, 'bin', 'apicovenant.mjs');

function run(args: string[], cwd = root): Promise<{ code: number | null; stdout: string; stderr: string }> {
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
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

const FIXTURE = `${JSON.stringify(
  {
    openapi: '3.1.0',
    info: { title: 'P1', version: '1.0.0' },
    paths: {
      '/items/': {
        get: {
          operationId: 'list_items',
          responses: {
            '200': {
              description: 'ok',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { name: { type: 'string', nullable: true } } },
                },
              },
            },
          },
        },
      },
    },
  },
  null,
  2,
)}\n`;

test('init --config-version writes a v1 or v2 configuration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'apicovenant-init-p1-'));
  try {
    const v2 = await run(['init', '--config-version', '2'], directory);
    assert.equal(v2.code, 0, v2.stderr);
    const v2Config = JSON.parse(await readFile(join(directory, 'apicovenant.config.json'), 'utf8')) as {
      version?: number;
    };
    assert.equal(v2Config.version, 2);

    const v1 = await run(['init', '--config-version', '1', '--force'], directory);
    assert.equal(v1.code, 0, v1.stderr);
    const v1Config = JSON.parse(await readFile(join(directory, 'apicovenant.config.json'), 'utf8')) as {
      version?: number;
      rules?: unknown;
    };
    assert.equal(v1Config.version, undefined);
    assert.ok(v1Config.rules);

    const invalid = await run(['init', '--config-version', '3'], directory);
    assert.equal(invalid.code, 2);
    assert.match(invalid.stderr, /config-version/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('lint --fix previews a diff and --write applies it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'apicovenant-fix-cli-'));
  const document = join(directory, 'openapi.json');
  try {
    await writeFile(document, FIXTURE);

    const preview = await run(['lint', document, '--fix', '--dry-run']);
    assert.equal(preview.code, 0, preview.stderr);
    assert.match(preview.stdout, /^--- /m);
    assert.match(preview.stdout, /\+ .*\/items"/);
    assert.equal(await readFile(document, 'utf8'), FIXTURE);

    const applied = await run(['lint', document, '--fix', '--write']);
    assert.equal(applied.code, 0, applied.stderr);
    const fixed = await readFile(document, 'utf8');
    assert.match(fixed, /"\/items"/);
    assert.doesNotMatch(fixed, /nullable/);
    const rewritten = JSON.parse(fixed) as {
      paths: Record<
        string,
        {
          get: {
            responses: Record<
              string,
              { content: Record<string, { schema: { properties: Record<string, { type: unknown }> } }> }
            >;
          };
        }
      >;
    };
    assert.deepEqual(
      rewritten.paths['/items']?.get.responses['200']?.content['application/json']?.schema.properties['name']?.type,
      ['string', 'null'],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('benchmark script covers all 1.1.0 scenarios', async () => {
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, 'scripts', 'bench.mjs'), '--operations', '5'], { cwd: root });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /parse /);
  assert.match(result.stdout, /lint /);
  assert.match(result.stdout, /breaking self-compare/);
  assert.match(result.stdout, /coverage/);
  assert.match(result.stdout, /mock cold start/);
  assert.match(result.stdout, /all targets met/);
});

test('the GitHub Actions example uses SARIF, JUnit and breaking checks', async () => {
  const workflow = await readFile(join(root, 'examples', 'github-actions.yml'), 'utf8');
  assert.match(workflow, /upload-sarif@v3/);
  assert.match(workflow, /--format junit/);
  assert.match(workflow, /apicovenant breaking/);
});
