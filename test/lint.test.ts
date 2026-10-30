import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSpecFromText, loadSpecFile } from '../src/spec/loader.ts';
import { lint, allRules, findRule } from '../src/lint/engine.ts';
import type { Finding } from '../src/lint/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const shopSpecPath = path.resolve(here, '..', 'examples', 'shop.openapi.yaml');
const legacySpecPath = path.resolve(here, '..', 'examples', 'legacy.openapi.yaml');

function ruleIds(findings: Finding[]): string[] {
  return [...new Set(findings.map((finding) => finding.ruleId))].sort();
}

test('every rule has a unique id and a description', () => {
  const rules = allRules();
  const ids = rules.map((rule) => rule.id);
  assert.equal(new Set(ids).size, ids.length, 'rule ids must be unique');
  for (const rule of rules) {
    assert.ok(rule.id.length > 0);
    assert.ok(rule.title.length > 0, `${rule.id} needs a title`);
    assert.ok(rule.description.length > 20, `${rule.id} needs a real description`);
    assert.ok(['error', 'warn', 'info'].includes(rule.severity));
  }
});

test('the exemplary spec produces no findings', async () => {
  const spec = await loadSpecFile(shopSpecPath);
  const result = lint(spec);
  assert.equal(result.total, 0, JSON.stringify(result.findings, null, 2));
});

test('the legacy spec triggers the expected rules', async () => {
  const spec = await loadSpecFile(legacySpecPath);
  const result = lint(spec);
  const ids = ruleIds(result.findings);

  assert.ok(ids.includes('operation-id-required'));
  assert.ok(ids.includes('path-kebab-case'));
  assert.ok(ids.includes('path-no-verbs'));
  assert.ok(ids.includes('response-status-valid'));
  assert.ok(ids.includes('parameter-required-path'));
  assert.ok(ids.includes('schema-required-property-defined'));
  assert.ok(ids.includes('component-naming-pascal'));
  assert.ok(ids.includes('security-in-query'));
  assert.ok(ids.includes('server-https'));
  assert.ok(result.counts.error > 0);
});

test('lint can run a single rule', async () => {
  const spec = await loadSpecFile(legacySpecPath);
  const result = lint(spec, { rules: ['operation-id-required'] });
  assert.equal(result.executed.length, 1);
  assert.ok(result.findings.every((finding) => finding.ruleId === 'operation-id-required'));
});

test('lint can ignore rules', async () => {
  const spec = await loadSpecFile(legacySpecPath);
  const all = lint(spec);
  const without = lint(spec, { ignore: ['operation-id-required'] });
  assert.ok(all.total > without.total);
  assert.ok(without.findings.every((finding) => finding.ruleId !== 'operation-id-required'));
});

test('lint filters by minimum severity', async () => {
  const spec = await loadSpecFile(legacySpecPath);
  const errorsOnly = lint(spec, { minSeverity: 'error' });
  assert.ok(errorsOnly.findings.every((finding) => finding.severity === 'error'));
  assert.ok(errorsOnly.total < lint(spec).total);
});

test('operation id rules fire as expected', () => {
  const spec = loadSpecFromText(
    [
      'openapi: 3.1.0',
      'info:',
      '  title: T',
      '  version: "1"',
      'paths:',
      '  /a:',
      '    get:',
      '      operationId: getA',
      '      responses:',
      '        "200":',
      '          description: ok',
      '  /b:',
      '    get:',
      '      operationId: getA',
      '      responses:',
      '        "200":',
      '          description: ok',
      '  /c:',
      '    get:',
      '      operationId: Get_C',
      '      responses:',
      '        "200":',
      '          description: ok',
      '',
    ].join('\n'),
  );

  const ids = ruleIds(lint(spec).findings);
  assert.ok(ids.includes('operation-id-unique'));
  assert.ok(ids.includes('operation-id-naming'));
});

test('the error envelope rule detects inconsistent error schemas', () => {
  const spec = loadSpecFromText(
    [
      'openapi: 3.1.0',
      'info:',
      '  title: T',
      '  version: "1"',
      'paths:',
      '  /a:',
      '    get:',
      '      operationId: getA',
      '      responses:',
      '        "200":',
      '          description: ok',
      '          content:',
      '            application/json:',
      '              schema:',
      '                $ref: "#/components/schemas/ErrA"',
      '        "400":',
      '          description: bad',
      '          content:',
      '            application/json:',
      '              schema:',
      '                $ref: "#/components/schemas/ErrA"',
      '  /b:',
      '    get:',
      '      operationId: getB',
      '      responses:',
      '        "200":',
      '          description: ok',
      '          content:',
      '            application/json:',
      '              schema:',
      '                $ref: "#/components/schemas/ErrB"',
      '        "400":',
      '          description: bad',
      '          content:',
      '            application/json:',
      '              schema:',
      '                $ref: "#/components/schemas/ErrB"',
      'components:',
      '  schemas:',
      '    ErrA:',
      '      type: object',
      '    ErrB:',
      '      type: object',
      '',
    ].join('\n'),
  );

  const findings = lint(spec, { rules: ['response-error-envelope'] }).findings;
  assert.ok(findings.length > 0);
  assert.ok(findings.some((finding) => finding.message.includes('ErrB') || finding.message.includes('ErrA')));
});

test('pagination rules detect mixed pagination styles', () => {
  const spec = loadSpecFromText(
    [
      'openapi: 3.1.0',
      'info:',
      '  title: T',
      '  version: "1"',
      'paths:',
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
      '  /things:',
      '    get:',
      '      operationId: listThings',
      '      parameters:',
      '        - name: cursor',
      '          in: query',
      '          schema:',
      '            type: string',
      '      responses:',
      '        "200":',
      '          description: ok',
      '',
    ].join('\n'),
  );

  const findings = lint(spec, { rules: ['pagination-consistency'] }).findings;
  assert.equal(findings.length, 1);
  assert.ok(findings[0]?.message.includes('cursor'));
});

test('findRule returns undefined for unknown ids', () => {
  assert.equal(findRule('does-not-exist'), undefined);
  assert.ok(findRule('operation-id-required'));
});

test('pagination-envelope keeps checking after an empty-properties schema', () => {
  // A collection endpoint whose response schema has no properties must not
  // abort the rule: every later collection endpoint is still checked.
  const spec = loadSpecFromText(
    [
      'openapi: 3.1.0',
      'info:',
      '  title: T',
      '  version: "1"',
      'paths:',
      '  /widgets:',
      '    get:',
      '      operationId: listWidgets',
      '      responses:',
      '        "200":',
      '          description: ok',
      '          content:',
      '            application/json:',
      '              schema:',
      '                type: object',
      '  /gadgets:',
      '    get:',
      '      operationId: listGadgets',
      '      responses:',
      '        "200":',
      '          description: ok',
      '          content:',
      '            application/json:',
      '              schema:',
      '                type: object',
      '                properties:',
      '                  items:',
      '                    type: array',
      '                    items:',
      '                      type: string',
      '',
    ].join('\n'),
  );

  const findings = lint(spec, { rules: ['pagination-envelope'] }).findings;
  assert.equal(findings.length, 1);
  assert.match(findings[0]?.message ?? '', /gadgets/);
});

test('component-unused does not confuse a component with its longer-named sibling', () => {
  const spec = loadSpecFromText(
    [
      'openapi: 3.1.0',
      'info:',
      '  title: T',
      '  version: "1"',
      'paths:',
      '  /users:',
      '    get:',
      '      operationId: listUsers',
      '      responses:',
      '        "200":',
      '          description: ok',
      '          content:',
      '            application/json:',
      '              schema:',
      '                $ref: "#/components/schemas/UserProfile"',
      'components:',
      '  schemas:',
      '    User:',
      '      type: object',
      '      properties:',
      '        id:',
      '          type: string',
      '    UserProfile:',
      '      type: object',
      '      properties:',
      '        user:',
      '          $ref: "#/components/schemas/User"',
      '',
    ].join('\n'),
  );

  const findings = lint(spec, { rules: ['component-unused'] }).findings;
  assert.deepEqual(findings, []);
});

test('response-schema-required ignores 1xx and 3xx responses', () => {
  const spec = loadSpecFromText(
    [
      'openapi: 3.1.0',
      'info:',
      '  title: T',
      '  version: "1"',
      'paths:',
      '  /old:',
      '    get:',
      '      operationId: getOld',
      '      responses:',
      '        "301":',
      '          description: moved',
      '        "100":',
      '          description: continue',
      '        "200":',
      '          description: ok',
      '          content:',
      '            application/json:',
      '              schema:',
      '                type: object',
      '',
    ].join('\n'),
  );

  const findings = lint(spec, { rules: ['response-schema-required'] }).findings;
  assert.deepEqual(findings, []);
});

test('path-collection-plural ignores filtered views', () => {
  const spec = loadSpecFromText(
    [
      'openapi: 3.1.0',
      'info:',
      '  title: T',
      '  version: "1"',
      'paths:',
      '  /users/active:',
      '    get:',
      '      operationId: listActiveUsers',
      '      responses:',
      '        "200":',
      '          description: ok',
      '          content:',
      '            application/json:',
      '              schema:',
      '                type: array',
      '                items:',
      '                  type: string',
      '  /order:',
      '    get:',
      '      operationId: listOrder',
      '      responses:',
      '        "200":',
      '          description: ok',
      '          content:',
      '            application/json:',
      '              schema:',
      '                type: array',
      '                items:',
      '                  type: string',
      '',
    ].join('\n'),
  );

  const findings = lint(spec, { rules: ['path-collection-plural'] }).findings;
  assert.equal(findings.length, 1);
  assert.match(findings[0]?.message ?? '', /\/order/);
});

test('parameter-name-required reports a nameless parameter', () => {
  const spec = loadSpecFromText(
    [
      'openapi: 3.1.0',
      'info:',
      '  title: T',
      '  version: "1"',
      'paths:',
      '  /things:',
      '    get:',
      '      operationId: listThings',
      '      parameters:',
      '        - in: query',
      '          schema:',
      '            type: string',
      '      responses:',
      '        "200":',
      '          description: ok',
      '',
    ].join('\n'),
  );

  const findings = lint(spec, { rules: ['parameter-name-required'] }).findings;
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, 'error');
  assert.match(findings[0]?.message ?? '', /has no "name"/);
});

test('an invalid minSeverity does not suppress every finding', () => {
  const spec = loadSpecFromText(
    [
      'openapi: 3.1.0',
      'info:',
      '  title: T',
      '  version: "1"',
      'paths:',
      '  /a:',
      '    get:',
      '      responses:',
      '        "200":',
      '          description: ok',
      '',
    ].join('\n'),
  );

  const all = lint(spec);
  const bogus = lint(spec, { minSeverity: 'bogus' as never });
  assert.equal(bogus.total, all.total);
});

test('server-https matches the hostname, not a substring of the URL', () => {
  // BUG-23: "http://localhost.example.com" and "http://api.127.0.0.1.x"
  // used to be exempted because the old test searched the whole URL.
  const spec = loadSpecFromText(
    [
      'openapi: 3.1.0',
      'info:',
      '  title: T',
      '  version: "1"',
      'servers:',
      '  - url: http://localhost.example.com/v1',
      '  - url: http://api.127.0.0.1.attacker.net',
      '  - url: http://localhost:3000',
      '  - url: http://127.0.0.1:8080',
      '  - url: http://api.local',
      'paths: {}',
      '',
    ].join('\n'),
  );

  const findings = lint(spec, { rules: ['server-https'] }).findings;
  assert.equal(findings.length, 2);
  assert.match(findings[0]?.message ?? '', /localhost\.example\.com/);
  assert.match(findings[1]?.message ?? '', /attacker\.net/);
});

test('security-requirement-defined exempts whole path segments only', () => {
  // BUG-24: "/users/login-history" used to be exempt because the path
  // contained the substring "/login".
  const spec = loadSpecFromText(
    [
      'openapi: 3.1.0',
      'info:',
      '  title: T',
      '  version: "1"',
      'paths:',
      '  /users/login-history:',
      '    get:',
      '      operationId: listLoginHistory',
      '      responses:',
      '        "200":',
      '          description: ok',
      '  /login:',
      '    post:',
      '      operationId: login',
      '      responses:',
      '        "200":',
      '          description: ok',
      '',
    ].join('\n'),
  );

  const findings = lint(spec, { rules: ['security-requirement-defined'] }).findings;
  assert.equal(findings.length, 1);
  assert.match(findings[0]?.operation ?? '', /GET \/users\/login-history/);
});
