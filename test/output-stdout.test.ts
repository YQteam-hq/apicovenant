import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const bin = path.join(root, 'bin', 'apicovenant.mjs');
const shopSpec = path.join(root, 'examples', 'shop.openapi.yaml');
const golden = path.join(root, 'examples', 'traffic.golden.json');

function runCli(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
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

test('lint --output - writes the report to stdout instead of a file named "-"', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'apicovenant-stdout-'));
  try {
    const result = await runCli(['lint', shopSpec, '--output', '-'], cwd);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /apicovenant|lint/i);

    const entries = await fs.readdir(cwd);
    assert.deepEqual(entries, [], `unexpected files: ${entries.join(', ')}`);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('diff --output - reports the golden path and the target separately', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'apicovenant-stdout-'));
  try {
    const result = await runCli(
      ['diff', '--golden', golden, '--spec', shopSpec, '--format', 'json', '--output', '-'],
      cwd,
    );
    assert.equal(result.code, 0, result.stderr);

    const report = JSON.parse(result.stdout) as { golden: string; target: string };
    assert.equal(report.golden, golden);
    assert.match(report.target, /^https?:\/\//);

    const entries = await fs.readdir(cwd);
    assert.deepEqual(entries, []);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
