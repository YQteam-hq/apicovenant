#!/usr/bin/env node
/**
 * Release audit for 1.1.0. This is the heavier companion to release-check:
 * it verifies the shipped files, version metadata, changelog and the release
 * gates that are cheap enough to run without a build.
 *
 *   node scripts/release-audit.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const notes = [];

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function requireFile(relative, label = relative) {
  if (!fs.existsSync(path.join(root, relative))) problems.push(`missing ${label}`);
}

const pkg = JSON.parse(read('package.json'));
if (pkg.version !== '1.1.0') problems.push(`package.json version is ${pkg.version}, expected 1.1.0`);
if (!read('CHANGELOG.md').includes('## [1.1.0]')) problems.push('CHANGELOG.md has no [1.1.0] section');

for (const file of [
  'bin/apicovenant.mjs',
  'README.md',
  'README.zh-CN.md',
  'docs/breaking.md',
  'docs/coverage.md',
  'docs/contract-testing.md',
  'docs/test.md',
  'docs/strict-mock.md',
  'docs/plugins.md',
  'docs/migration-1.1.md',
  'docs/configuration-v2.md',
  'docs/fix.md',
  'docs/openapi-3.1.md',
  'docs/release-audit-1.1.md',
  'docs/rfc-1.1.md',
  'corpus/README.md',
  'corpus/manifest.json',
  'scripts/fetch-corpus.mjs',
  'examples/github-actions.yml',
  'examples/plugin/team-plugin.mjs',
  'scripts/bench.mjs',
]) {
  requireFile(file);
}

try {
  const version = execFileSync(process.execPath, [path.join(root, 'bin', 'apicovenant.mjs'), '--version'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  if (version !== pkg.version) problems.push(`CLI reports ${version}, package.json says ${pkg.version}`);
  notes.push(`version: ${version}`);
} catch (error) {
  problems.push(`could not run the CLI: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  execFileSync(process.execPath, [path.join(root, 'scripts', 'release-check.mjs')], { cwd: root, stdio: 'pipe' });
  notes.push('release-check: OK');
} catch (error) {
  const output = error instanceof Error && 'stderr' in error ? String(error.stderr) : '';
  problems.push(`release-check failed${output ? `: ${output.trim()}` : ''}`);
}

// npm is not required for development in this repository. When it is present,
// include the package manifest check; otherwise report that it was skipped.
try {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const packed = JSON.parse(output);
  if (!Array.isArray(packed) || packed.length === 0) problems.push('npm pack --dry-run returned no package');
  else notes.push(`npm pack: ${packed[0].entryCount ?? packed[0].files?.length ?? '?'} files`);
} catch (error) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === 'ENOENT') notes.push('npm pack: skipped (npm not installed)');
  else problems.push(`npm pack --dry-run failed: ${error instanceof Error ? error.message : String(error)}`);
}

if (problems.length > 0) {
  process.stderr.write(`release audit: ${problems.length} problem(s)\n`);
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
  process.exitCode = 1;
} else {
  for (const note of notes) process.stdout.write(`${note}\n`);
  process.stdout.write('release audit: OK\n');
}
