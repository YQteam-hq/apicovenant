import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deref } from '../src/spec/ref.ts';
import { validateSchema } from '../src/spec/schema.ts';
import { lint } from '../src/lint/engine.ts';
import { loadSpecFromText } from '../src/spec/loader.ts';

const base = (schema: unknown): Record<string, unknown> => ({
  openapi: '3.1.0',
  info: { title: 'Schema 3.1', version: '1.0.0' },
  paths: {},
  components: { schemas: { Test: schema } },
});

test('unevaluatedProperties rejects properties no branch evaluated', () => {
  const schema = {
    type: 'object',
    properties: { a: { type: 'integer' } },
    allOf: [{ properties: { b: { type: 'string' } } }],
    unevaluatedProperties: false,
  };
  assert.equal(validateSchema({ a: 1, b: 'ok' }, schema).length, 0);
  const violations = validateSchema({ a: 1, extra: true }, schema);
  assert.equal(violations.length, 1);
  assert.match(violations[0]?.message ?? '', /unevaluated property "extra"/);
});

test('dependentRequired enforces conditional fields', () => {
  const schema = {
    type: 'object',
    dependentRequired: { credit_card: ['billing_address'] },
  };
  assert.equal(validateSchema({ billing_address: 'x' }, schema).length, 0);
  assert.equal(validateSchema({ credit_card: '4111', billing_address: 'x' }, schema).length, 0);
  const violations = validateSchema({ credit_card: '4111' }, schema);
  assert.equal(violations.length, 1);
  assert.match(violations[0]?.message ?? '', /property "billing_address" is required/);
});

test('dependentSchemas validates the whole object when the trigger exists', () => {
  const schema = {
    type: 'object',
    dependentSchemas: {
      credit_card: { required: ['billing_address'] },
    },
  };
  assert.equal(validateSchema({ credit_card: '4111' }, schema).length, 1);
  assert.equal(validateSchema({ credit_card: '4111', billing_address: 'x' }, schema).length, 0);
  assert.equal(validateSchema({}, schema).length, 0);
});

test('if/then/else selects exactly one branch', () => {
  const schema = {
    type: 'object',
    if: { properties: { kind: { const: 'person' } }, required: ['kind'] },
    then: { required: ['name'] },
    else: { required: ['company'] },
  };
  assert.equal(validateSchema({ kind: 'person', name: 'Ada' }, schema).length, 0);
  assert.equal(validateSchema({ kind: 'person' }, schema).length, 1);
  assert.equal(validateSchema({ kind: 'org', company: 'ACME' }, schema).length, 0);
  assert.equal(validateSchema({ kind: 'org' }, schema).length, 1);
});

test('$dynamicRef resolves a local pointer in deref', () => {
  const document = {
    $defs: { positive: { type: 'integer', minimum: 1 } },
  };
  const schema = deref(document, { $dynamicRef: '#/$defs/positive' });
  assert.deepEqual(schema, { type: 'integer', minimum: 1 });
  assert.equal(validateSchema(2, schema).length, 0);
  assert.equal(validateSchema(0, schema).length, 1);
});

test('strict-schema warns about unsupported keywords instead of ignoring them', () => {
  const spec = loadSpecFromText(
    JSON.stringify(
      base({
        type: 'object',
        patternProperties: { '^x-': { type: 'string' } },
        properties: { name: { type: 'string' } },
      }),
    ),
  );
  const quiet = lint(spec);
  assert.equal(quiet.findings.some((finding) => finding.ruleId === 'schema-unsupported-keyword'), false);
  const strict = lint(spec, { strictSchema: true });
  const finding = strict.findings.find((entry) => entry.ruleId === 'schema-unsupported-keyword');
  assert.ok(finding);
  assert.equal(finding.severity, 'warn');
  assert.match(finding.message, /patternProperties/);
});

test('prefixItems remains supported and produces no strict warning', () => {
  const spec = loadSpecFromText(
    JSON.stringify(base({ type: 'array', prefixItems: [{ type: 'string' }], items: { type: 'integer' } })),
  );
  const result = lint(spec, { strictSchema: true });
  assert.equal(result.findings.some((finding) => finding.ruleId === 'schema-unsupported-keyword'), false);
});
