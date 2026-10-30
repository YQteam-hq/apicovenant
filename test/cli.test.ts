import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const bin = path.join(root, 'bin', 'apicovenant.mjs');
const shopSpec = path.join(root, 'examples', 'shop.openapi.yaml');
const legacySpec = path.join(root, 'examples', 'legacy.openapi.yaml');

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd: root });
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

test('the CLI prints help without arguments', async () => {
  const result = await runCli([]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /apicovenant/);
  assert.match(result.stdout, /lint/);
});

test('the CLI prints the version', async () => {
  const result = await runCli(['--version']);
  assert.equal(result.code, 0);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('lint on a clean spec exits with 0', async () => {
  const result = await runCli(['lint', shopSpec]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /no findings/);
});

test('lint on a flawed spec exits with 1', async () => {
  const result = await runCli(['lint', legacySpec]);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /error/);
});

test('lint --format json emits a machine readable report', async () => {
  const result = await runCli(['lint', legacySpec, '--format', 'json']);
  assert.equal(result.code, 1);
  const report = JSON.parse(result.stdout) as {
    tool: string;
    summary: { total: number; error: number };
    findings: Array<{ ruleId: string; severity: string; path: string }>;
  };
  assert.equal(report.tool, 'apicovenant');
  assert.ok(report.summary.total > 0);
  assert.ok(report.summary.error > 0);
  assert.ok(report.findings.every((finding) => typeof finding.path === 'string'));
});

test('lint --format html emits a standalone document', async () => {
  const result = await runCli(['lint', legacySpec, '--format', 'html']);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /<!doctype html>/i);
  assert.match(result.stdout, /<style>/);
  assert.equal(/<script[^>]+src=/.test(result.stdout), false, 'the HTML report must not load external scripts');
});

test('lint --fail-on never always exits with 0', async () => {
  const result = await runCli(['lint', legacySpec, '--fail-on', 'never']);
  assert.equal(result.code, 0);
});

test('lint --severity error hides warnings', async () => {
  const result = await runCli(['lint', legacySpec, '--severity', 'error', '--format', 'json']);
  const report = JSON.parse(result.stdout) as { findings: Array<{ severity: string }> };
  assert.ok(report.findings.every((finding) => finding.severity === 'error'));
});

test('lint rejects an unknown rule with a usage error', async () => {
  const result = await runCli(['lint', shopSpec, '--rules', 'not-a-rule']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /unknown rule/);
});

test('lint reports a missing document', async () => {
  const result = await runCli(['lint', path.join(root, 'does-not-exist.yaml')]);
  assert.equal(result.code, 3);
  assert.match(result.stderr, /ENOENT|no such file/i);
});

test('lint rejects an invalid --fail-on value with a usage error', async () => {
  const result = await runCli(['lint', legacySpec, '--fail-on', 'typo']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /invalid fail-on "typo"/);
});

test('diff rejects a --fail-on value that belongs to lint', async () => {
  const result = await runCli([
    'diff',
    '--golden',
    path.join(root, 'examples', 'traffic.golden.json'),
    '--fail-on',
    'error',
  ]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /invalid fail-on "error" \(expected changed or never\)/);
});

test('an option that belongs to another command is rejected', async () => {
  const result = await runCli(['lint', shopSpec, '--port', '3000']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /option --port is not valid for the "lint" command/);
});

test('the rules command lists the catalogue', async () => {
  const result = await runCli(['rules']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /operation-id-required/);
  assert.match(result.stdout, /rules in/);
});

test('the rules command supports json output', async () => {
  const result = await runCli(['rules', '--format', 'json']);
  assert.equal(result.code, 0);
  const rules = JSON.parse(result.stdout) as Array<{ id: string; severity: string }>;
  assert.ok(rules.length > 20);
  assert.ok(rules.every((rule) => typeof rule.id === 'string'));
});

test('an unknown command exits with a usage error', async () => {
  const result = await runCli(['nonsense']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /unknown command/);
});

test('the shipped golden file still matches the reference contract', async () => {
  const result = await runCli([
    'diff',
    '--golden',
    path.join(root, 'examples', 'traffic.golden.json'),
    '--spec',
    shopSpec,
  ]);
  assert.equal(result.code, 0, result.stdout);
  assert.match(result.stdout, /the contract held/);
});
