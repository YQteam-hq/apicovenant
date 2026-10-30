import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ConfigError,
  DEFAULT_CONFIG,
  findConfigFile,
  loadConfig,
  parseConfigFile,
} from '../src/config.ts';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'apicovenant-config-'));
}

test('parses a JSON configuration', () => {
  const config = parseConfigFile(
    JSON.stringify({
      rules: { ignore: ['a', 'b'], only: ['c'] },
      severity: 'warn',
      failOn: 'warn',
      format: 'json',
      output: 'report.json',
      baseline: 'base.json',
    }),
    'apicovenant.config.json',
  );

  assert.deepEqual(config.rules?.ignore, ['a', 'b']);
  assert.deepEqual(config.rules?.only, ['c']);
  assert.equal(config.severity, 'warn');
  assert.equal(config.failOn, 'warn');
  assert.equal(config.format, 'json');
  assert.equal(config.output, 'report.json');
  assert.equal(config.baseline, 'base.json');
});

test('parses a YAML configuration', () => {
  const config = parseConfigFile(
    ['rules:', '  ignore:', '    - first-rule', '    - second-rule', 'severity: error', 'failOn: never', ''].join('\n'),
    'apicovenant.config.yaml',
  );
  assert.deepEqual(config.rules?.ignore, ['first-rule', 'second-rule']);
  assert.equal(config.severity, 'error');
  assert.equal(config.failOn, 'never');
});

test('rejects unknown settings instead of ignoring them', () => {
  assert.throws(
    () => parseConfigFile(JSON.stringify({ severty: 'error' }), 'apicovenant.config.json'),
    (error: unknown) => error instanceof ConfigError && /unknown setting "severty"/.test((error as Error).message),
  );
  assert.throws(
    () => parseConfigFile(JSON.stringify({ rules: { except: [] } }), 'apicovenant.config.json'),
    /unknown setting "rules.except"/,
  );
});

test('rejects invalid values', () => {
  assert.throws(() => parseConfigFile(JSON.stringify({ severity: 'loud' }), 'x.json'), /"severity" must be one of/);
  assert.throws(() => parseConfigFile(JSON.stringify({ format: 'xml' }), 'x.json'), /"format" must be one of/);
  assert.throws(() => parseConfigFile(JSON.stringify({ failOn: 'maybe' }), 'x.json'), /"failOn" must be one of/);
  assert.throws(() => parseConfigFile(JSON.stringify({ rules: { ignore: 'x' } }), 'x.json'), /must be a list of strings/);
});

test('rejects a configuration that is not a mapping', () => {
  assert.throws(() => parseConfigFile('[]', 'x.json'), /must be a mapping/);
  assert.throws(() => parseConfigFile('{oops', 'x.json'), /invalid JSON/);
});

test('discovers a configuration file in the working directory', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'apicovenant.config.json'), '{}');
  assert.equal(findConfigFile(dir), path.join(dir, 'apicovenant.config.json'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('prefers apicovenant.config.json over the dot variants', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'apicovenant.config.json'), '{}');
  fs.writeFileSync(path.join(dir, '.apicovenantrc.json'), '{}');
  assert.equal(findConfigFile(dir), path.join(dir, 'apicovenant.config.json'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('reads the configuration from package.json', async () => {
  const dir = tempDir();
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'x', apicovenant: { failOn: 'never' } }),
  );
  const loaded = await loadConfig({ cwd: dir });
  assert.equal(loaded.config.failOn, 'never');
  assert.equal(loaded.path, 'package.json');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('loads an explicitly named configuration file', async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'custom.json'), JSON.stringify({ severity: 'error' }));
  const loaded = await loadConfig({ explicitPath: 'custom.json', cwd: dir });
  assert.equal(loaded.config.severity, 'error');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('reports a missing configuration file', async () => {
  await assert.rejects(() => loadConfig({ explicitPath: 'nope.json', cwd: tempDir() }), /not found/);
});

test('returns an empty configuration when there is none', async () => {
  const dir = tempDir();
  const loaded = await loadConfig({ cwd: dir });
  assert.deepEqual(loaded.config, {});
  assert.equal(loaded.path, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a configuration with a byte order mark is accepted', () => {
  const config = parseConfigFile(`\uFEFF${JSON.stringify({ severity: 'warn' })}`, 'x.json');
  assert.equal(config.severity, 'warn');
});

test('the default configuration is valid', () => {
  assert.deepEqual(parseConfigFile(JSON.stringify(DEFAULT_CONFIG), 'x.json'), DEFAULT_CONFIG);
});
