import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const bin = path.join(root, 'bin', 'apicovenant.mjs');
const legacySpec = path.join(root, 'examples', 'legacy.openapi.yaml');

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd = root): Promise<CliResult> {
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

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'apicovenant-cli-'));
}

test('init writes a configuration file', async () => {
  const dir = tempDir();
  const result = await runCli(['init'], dir);
  assert.equal(result.code, 0);

  const configPath = path.join(dir, 'apicovenant.config.json');
  assert.ok(fs.existsSync(configPath));
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  assert.equal(config['failOn'], 'error');
  assert.equal(config['format'], 'text');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('init refuses to overwrite an existing file', async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'apicovenant.config.json'), '{}');
  const result = await runCli(['init'], dir);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /already exists/);

  const forced = await runCli(['init', '--force'], dir);
  assert.equal(forced.code, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lint --update-baseline records the findings', async () => {
  const dir = tempDir();
  const baseline = path.join(dir, 'baseline.json');
  const result = await runCli(['lint', legacySpec, '--update-baseline', baseline], dir);
  assert.equal(result.code, 0);

  const saved = JSON.parse(fs.readFileSync(baseline, 'utf8')) as { findings: unknown[] };
  assert.ok(saved.findings.length > 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a baseline suppresses known findings and lets the build pass', async () => {
  const dir = tempDir();
  const baseline = path.join(dir, 'baseline.json');

  const recorded = await runCli(['lint', legacySpec, '--update-baseline', baseline], dir);
  assert.equal(recorded.code, 0);

  const withBaseline = await runCli(['lint', legacySpec, '--baseline', baseline], dir);
  assert.equal(withBaseline.code, 0, withBaseline.stdout);
  assert.match(withBaseline.stdout, /no findings/);
  assert.match(withBaseline.stdout, /suppressed by the baseline/);

  const withoutBaseline = await runCli(['lint', legacySpec], dir);
  assert.equal(withoutBaseline.code, 1);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a configuration file in the working directory is picked up', async () => {
  const dir = tempDir();
  fs.writeFileSync(
    path.join(dir, 'apicovenant.config.json'),
    JSON.stringify({ failOn: 'never' }),
  );

  const result = await runCli(['lint', legacySpec], dir);
  assert.equal(result.code, 0, 'failOn=never in the config should keep the exit code at 0');
  assert.match(result.stdout, /error/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a command line flag overrides the configuration file', async () => {
  const dir = tempDir();
  fs.writeFileSync(
    path.join(dir, 'apicovenant.config.json'),
    JSON.stringify({ failOn: 'never' }),
  );

  const result = await runCli(['lint', legacySpec, '--fail-on', 'error'], dir);
  assert.equal(result.code, 1, 'the flag should win over the config file');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('an invalid configuration file is reported', async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'apicovenant.config.json'), JSON.stringify({ nonsense: true }));

  const result = await runCli(['lint', legacySpec], dir);
  assert.equal(result.code, 3);
  assert.match(result.stderr, /unknown setting "nonsense"/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('the diff report can be written as HTML', async () => {
  const dir = tempDir();
  const output = path.join(dir, 'drift.html');
  const result = await runCli(
    ['diff', '--golden', path.join(root, 'examples', 'traffic.golden.json'), '--spec', path.join(root, 'examples', 'shop.openapi.yaml'), '--format', 'html', '--output', output],
    dir,
  );
  assert.equal(result.code, 0, result.stdout);

  const html = fs.readFileSync(output, 'utf8');
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Contract drift report/);
  assert.equal(/<script[^>]+src=/.test(html), false, 'the report must not load external scripts');

  fs.rmSync(dir, { recursive: true, force: true });
});
