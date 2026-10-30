import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSpecFile } from '../src/spec/loader.ts';
import { lint, allRules } from '../src/lint/engine.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const examples = path.resolve(here, '..', 'examples');

const FIXTURES = [
  { name: 'shop.openapi.yaml', expectClean: true },
  { name: 'legacy.openapi.yaml', expectClean: false },
  { name: 'violations.openapi.yaml', expectClean: false },
];

async function firedRuleIds(): Promise<Set<string>> {
  const fired = new Set<string>();
  for (const fixture of FIXTURES) {
    const spec = await loadSpecFile(path.join(examples, fixture.name));
    for (const finding of lint(spec).findings) fired.add(finding.ruleId);
  }
  return fired;
}

test('every rule fires on at least one fixture', async () => {
  const fired = await firedRuleIds();
  const missing = allRules().map((rule) => rule.id).filter((id) => !fired.has(id));
  assert.deepEqual(missing, [], `rules that never fired: ${missing.join(', ')}`);
});

test('the reference contract stays clean', async () => {
  const spec = await loadSpecFile(path.join(examples, 'shop.openapi.yaml'));
  const result = lint(spec);
  assert.equal(result.total, 0, JSON.stringify(result.findings, null, 2));
});

test('the broken fixtures produce errors as well as warnings', async () => {
  for (const name of ['legacy.openapi.yaml', 'violations.openapi.yaml']) {
    const spec = await loadSpecFile(path.join(examples, name));
    const result = lint(spec);
    assert.ok(result.counts.error > 0, `${name} should produce errors`);
    assert.ok(result.counts.warn > 0, `${name} should produce warnings`);
  }
});

test('the legacy fixture still fires the rules it was written for', async () => {
  const spec = await loadSpecFile(path.join(examples, 'legacy.openapi.yaml'));
  const fired = new Set(lint(spec).findings.map((finding) => finding.ruleId));
  for (const id of [
    'operation-id-required',
    'path-kebab-case',
    'path-no-verbs',
    'response-status-valid',
    'parameter-required-path',
    'schema-required-property-defined',
    'component-naming-pascal',
    'security-in-query',
    'server-https',
  ]) {
    assert.ok(fired.has(id), `expected ${id} to fire on the legacy fixture`);
  }
});
