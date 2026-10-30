import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadSpecFromText, validateDocument, SpecError } from '../src/spec/loader.ts';
import { lint } from '../src/lint/engine.ts';
import { renderTextReport } from '../src/report/text.ts';
import { buildJsonReport } from '../src/report/json.ts';
import type { Finding } from '../src/lint/types.ts';

function ruleIds(findings: Finding[]): string[] {
  return findings.map((finding) => finding.ruleId);
}

function spec(version: string, paths: string, components = ''): string {
  return [
    `openapi: ${version}`,
    'info:',
    '  title: T',
    '  version: "1"',
    'paths:',
    paths,
    components,
    '',
  ].join('\n');
}

test('nullable is not reported in OpenAPI 3.0', () => {
  const document = spec(
    '3.0.3',
    [
      '  /a:',
      '    get:',
      '      operationId: getA',
      '      responses:',
      '        "200":',
      '          description: ok',
      '          content:',
      '            application/json:',
      '              schema:',
      '                $ref: "#/components/schemas/A"',
    ].join('\n'),
    [
      'components:',
      '  schemas:',
      '    A:',
      '      type: object',
      '      properties:',
      '        name:',
      '          type: string',
      '          nullable: true',
    ].join('\n'),
  );

  const findings = lint(loadSpecFromText(document)).findings;
  assert.equal(
    ruleIds(findings).includes('schema-no-nullable'),
    false,
    'nullable is the standard way to express null in OpenAPI 3.0',
  );
});

test('nullable is reported in OpenAPI 3.1', () => {
  const document = spec(
    '3.1.0',
    [
      '  /a:',
      '    get:',
      '      operationId: getA',
      '      responses:',
      '        "200":',
      '          description: ok',
      '          content:',
      '            application/json:',
      '              schema:',
      '                $ref: "#/components/schemas/A"',
    ].join('\n'),
    [
      'components:',
      '  schemas:',
      '    A:',
      '      type: object',
      '      properties:',
      '        name:',
      '          type: string',
      '          nullable: true',
    ].join('\n'),
  );

  const findings = lint(loadSpecFromText(document)).findings;
  assert.ok(ruleIds(findings).includes('schema-no-nullable'));
});

test('an empty GET body is not reported, a body with fields is', () => {
  const empty = spec(
    '3.0.3',
    [
      '  /a:',
      '    get:',
      '      operationId: getA',
      '      requestBody:',
      '        required: false',
      '        content:',
      '          application/x-www-form-urlencoded:',
      '            schema:',
      '              type: object',
      '              properties: {}',
      '      responses:',
      '        "200":',
      '          description: ok',
    ].join('\n'),
  );
  assert.equal(
    ruleIds(lint(loadSpecFromText(empty)).findings).includes('operation-method-semantics'),
    false,
  );

  const withFields = spec(
    '3.0.3',
    [
      '  /a:',
      '    get:',
      '      operationId: getA',
      '      requestBody:',
      '        required: false',
      '        content:',
      '          application/x-www-form-urlencoded:',
      '            schema:',
      '              type: object',
      '              properties:',
      '                filter:',
      '                  type: string',
      '      responses:',
      '        "200":',
      '          description: ok',
    ].join('\n'),
  );
  assert.ok(ruleIds(lint(loadSpecFromText(withFields)).findings).includes('operation-method-semantics'));
});

test('a cursor paginated collection does not need a total count', () => {
  const document = spec(
    '3.0.3',
    [
      '  /items:',
      '    get:',
      '      operationId: listItems',
      '      parameters:',
      '        - name: starting_after',
      '          in: query',
      '          schema:',
      '            type: string',
      '      responses:',
      '        "200":',
      '          description: ok',
      '          content:',
      '            application/json:',
      '              schema:',
      '                type: object',
      '                properties:',
      '                  data:',
      '                    type: array',
      '                    items:',
      '                      type: string',
      '                  has_more:',
      '                    type: boolean',
    ].join('\n'),
  );

  assert.equal(
    ruleIds(lint(loadSpecFromText(document)).findings).includes('pagination-envelope'),
    false,
    'cursor based collections rarely know the total',
  );
});

test('an offset paginated collection still needs a total count', () => {
  const document = spec(
    '3.0.3',
    [
      '  /items:',
      '    get:',
      '      operationId: listItems',
      '      parameters:',
      '        - name: page',
      '          in: query',
      '          schema:',
      '            type: integer',
      '      responses:',
      '        "200":',
      '          description: ok',
      '          content:',
      '            application/json:',
      '              schema:',
      '                type: object',
      '                properties:',
      '                  data:',
      '                    type: array',
      '                    items:',
      '                      type: string',
    ].join('\n'),
  );

  assert.ok(ruleIds(lint(loadSpecFromText(document)).findings).includes('pagination-envelope'));
});

test('a Swagger 2.0 document is reported as such', () => {
  assert.throws(
    () => validateDocument({ swagger: '2.0', info: { title: 'x' } }),
    (error: unknown) =>
      error instanceof SpecError && /Swagger 2\.0 document/.test((error as Error).message),
  );
});

test('the text report caps how much one rule can print', () => {
  const findings: Finding[] = Array.from({ length: 50 }, (_, index) => ({
    ruleId: 'noisy-rule',
    severity: 'warn',
    message: `finding ${index}`,
    path: `/p/${index}`,
    operation: 'GET /a',
  }));

  const report = renderTextReport({ document: 'openapi.yaml', findings, maxPerRule: 5 });

  assert.equal((report.match(/finding \d+/g) ?? []).length, 5);
  assert.match(report, /and 45 more noisy-rule/);
});

test('the text report caps one rule by default and the JSON report does not', () => {
  const findings: Finding[] = Array.from({ length: 50 }, (_, index) => ({
    ruleId: 'noisy-rule',
    severity: 'warn',
    message: `finding ${index}`,
    path: `/p/${index}`,
  }));

  const text = renderTextReport({ document: 'openapi.yaml', findings });
  assert.equal((text.match(/finding \d+/g) ?? []).length, 20, 'the default cap is 20 per rule');
  assert.match(text, /and 30 more noisy-rule/);

  const json = buildJsonReport({
    tool: 'apicovenant',
    version: '1.0.0',
    document: 'openapi.yaml',
    findings,
  });
  assert.equal(json.findings.length, 50, 'the machine readable report stays complete');
});
