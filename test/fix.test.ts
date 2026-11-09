import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyFixes } from '../src/fix/fix.ts';
import { lint } from '../src/lint/engine.ts';
import { loadSpecFromText } from '../src/spec/loader.ts';

function jsonSpec(): string {
  return `${JSON.stringify(
    {
      openapi: '3.1.0',
      info: { title: 'Fix', version: '1.0.0' },
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
}

const YAML_SPEC = `openapi: 3.1.0
info:
  title: Fix
  version: 1.0.0
paths:
  /items/:
    get:
      operationId: list_items
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: object
                properties:
                  name:
                    type: string
                    nullable: true
`;

test('JSON fixes remove trailing slashes and 3.1 nullable', () => {
  const source = jsonSpec();
  const spec = loadSpecFromText(source);
  const result = applyFixes(source, spec);

  assert.equal(result.changes.filter((change) => change.ruleId === 'path-no-trailing-slash').length, 1);
  assert.equal(result.changes.filter((change) => change.ruleId === 'schema-no-nullable').length, 1);
  const fixed = JSON.parse(result.text) as {
    paths: Record<string, { get: { operationId: string } }>;
  };
  assert.ok(fixed.paths['/items']);
  assert.equal(fixed.paths['/items/'], undefined);
  assert.equal(fixed.paths['/items']?.get.operationId, 'list_items');

  const after = lint(loadSpecFromText(result.text));
  assert.equal(after.findings.some((finding) => finding.ruleId === 'path-no-trailing-slash'), false);
  assert.equal(after.findings.some((finding) => finding.ruleId === 'schema-no-nullable'), false);
});

test('YAML fixes keep the document parseable', () => {
  const spec = loadSpecFromText(YAML_SPEC);
  const result = applyFixes(YAML_SPEC, spec);

  assert.equal(result.changes.length, 2);
  assert.match(result.text, /^ {2}\/items:$/m);
  assert.doesNotMatch(result.text, /nullable: true/);
  assert.match(result.text, /type: \[string, "null"\]/);
  const after = lint(loadSpecFromText(result.text));
  assert.equal(after.findings.some((finding) => finding.ruleId === 'path-no-trailing-slash'), false);
  assert.equal(after.findings.some((finding) => finding.ruleId === 'schema-no-nullable'), false);
});

test('operationId camelCase only runs with the aggressive option', () => {
  const source = jsonSpec();
  const spec = loadSpecFromText(source);

  const safe = applyFixes(source, spec);
  assert.equal(safe.changes.some((change) => change.ruleId === 'operation-id-naming'), false);

  const aggressive = applyFixes(source, spec, { aggressive: true });
  assert.equal(aggressive.changes.some((change) => change.ruleId === 'operation-id-naming'), true);
  const fixed = JSON.parse(aggressive.text) as { paths: Record<string, { get: { operationId: string } }> };
  assert.equal(fixed.paths['/items']?.get.operationId, 'listItems');
});

test('fixing is idempotent', () => {
  const source = jsonSpec();
  const spec = loadSpecFromText(source);
  const once = applyFixes(source, spec);
  const twice = applyFixes(once.text, loadSpecFromText(once.text));
  assert.equal(twice.changes.length, 0);
  assert.equal(twice.text, once.text);
});
