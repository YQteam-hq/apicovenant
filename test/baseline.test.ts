import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  applyBaseline,
  BASELINE_FORMAT_VERSION,
  buildBaseline,
  findingFingerprint,
  loadBaseline,
  parseBaseline,
  saveBaseline,
} from '../src/baseline.ts';
import type { Finding } from '../src/lint/types.ts';

const finding = (ruleId: string, pointer: string, message: string): Finding => ({
  ruleId,
  severity: 'error',
  message,
  path: pointer,
});

test('a fingerprint identifies a finding across runs', () => {
  const a = finding('rule-a', '/paths/~1a', 'message');
  const b = finding('rule-a', '/paths/~1a', 'message');
  assert.equal(findingFingerprint(a), findingFingerprint(b));
});

test('different findings get different fingerprints', () => {
  const base = finding('rule-a', '/paths/~1a', 'message');
  assert.notEqual(findingFingerprint(base), findingFingerprint(finding('rule-b', '/paths/~1a', 'message')));
  assert.notEqual(findingFingerprint(base), findingFingerprint(finding('rule-a', '/paths/~1b', 'message')));
});

test('a baseline records every finding once', () => {
  const baseline = buildBaseline([
    finding('rule-a', '/a', 'one'),
    finding('rule-a', '/a', 'one'),
    finding('rule-b', '/b', 'two'),
  ]);
  assert.equal(baseline.findings.length, 2);
  assert.equal(baseline.apicovenant, BASELINE_FORMAT_VERSION);
  assert.ok(baseline.createdAt.length > 0);
});

test('the baseline splits findings into known and fresh', () => {
  const baseline = buildBaseline([finding('rule-a', '/a', 'one')]);
  const result = applyBaseline(
    [finding('rule-a', '/a', 'one'), finding('rule-c', '/c', 'three')],
    baseline,
  );
  assert.equal(result.fresh.length, 1);
  assert.equal(result.fresh[0]?.ruleId, 'rule-c');
  assert.equal(result.suppressed.length, 1);
  assert.equal(result.suppressed[0]?.ruleId, 'rule-a');
});

test('a changed message is a fresh finding', () => {
  const baseline = buildBaseline([finding('rule-a', '/a', 'old message')]);
  const result = applyBaseline([finding('rule-a', '/a', 'new message')], baseline);
  assert.equal(result.fresh.length, 1);
  assert.equal(result.suppressed.length, 0);
});

test('a baseline round trips through disk', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apicovenant-baseline-'));
  const file = path.join(dir, 'baseline.json');
  const baseline = buildBaseline([finding('rule-a', '/a', 'one')]);
  await saveBaseline(file, baseline);

  const loaded = await loadBaseline(file);
  assert.equal(loaded.findings.length, 1);
  assert.equal(loaded.findings[0]?.ruleId, 'rule-a');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a missing baseline file means an empty baseline', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apicovenant-baseline-'));
  const baseline = await loadBaseline(path.join(dir, 'nothing.json'));
  assert.deepEqual(baseline.findings, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a baseline with a byte order mark is accepted', () => {
  const baseline = buildBaseline([finding('rule-a', '/a', 'one')]);
  const withBom = `\uFEFF${JSON.stringify(baseline)}`;
  const parsed = parseBaseline(withBom, 'b.json');
  assert.equal(parsed.findings.length, 1);
});

test('a malformed baseline file is rejected', () => {
  assert.throws(() => parseBaseline('{oops', 'b.json'), /invalid JSON/);
  assert.throws(() => parseBaseline('[]', 'b.json'), /must be a JSON object/);
  assert.throws(() => parseBaseline(JSON.stringify({ apicovenant: 99, findings: [] }), 'b.json'), /unsupported baseline format/);
  assert.throws(() => parseBaseline(JSON.stringify({ apicovenant: 1 }), 'b.json'), /"findings" array/);
});

test('a baseline reports which finding entry is malformed', () => {
  const text = JSON.stringify({ apicovenant: BASELINE_FORMAT_VERSION, findings: [null] });
  assert.throws(() => parseBaseline(text, 'b.json'), /findings\[0\] must be an object/);
});
