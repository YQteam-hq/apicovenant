import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderHtmlReport, escapeHtml } from '../src/report/html.ts';
import { buildJsonReport, renderJsonReport } from '../src/report/json.ts';
import { renderTextReport, renderSummaryLine } from '../src/report/text.ts';
import type { Finding } from '../src/lint/types.ts';

const findings: Finding[] = [
  {
    ruleId: 'operation-id-required',
    severity: 'error',
    message: 'GET /users has no operationId',
    path: '/paths/~1users/get',
    operation: 'GET /users',
    hint: 'Add a camelCase operationId.',
  },
  {
    ruleId: 'parameter-description',
    severity: 'info',
    message: 'Parameter "limit" has no description',
    path: '/paths/~1users/get/parameters/0',
    operation: 'GET /users',
  },
];

test('the HTML report is a self contained document', () => {
  const html = renderHtmlReport({
    tool: 'apicovenant',
    version: '0.1.0',
    document: 'openapi.yaml',
    findings,
  });

  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<style>/);
  assert.equal(/<link[^>]+href=/.test(html), false, 'no external stylesheets');
  assert.equal(/<script[^>]+src=/.test(html), false, 'no external scripts');
  assert.match(html, /operation-id-required/);
  assert.match(html, /openapi\.yaml/);
});

test('every HTML row carries its severity in a data attribute', () => {
  const html = renderHtmlReport({
    tool: 'apicovenant',
    version: '0.1.0',
    document: 'openapi.yaml',
    findings,
  });

  assert.match(html, /data-severity="error"/);
  assert.match(html, /data-severity="info"/);

  assert.match(html, /getAttribute\('data-severity'\)/);
  assert.equal(/replace\('severity-'/.test(html), false);
});

test('the HTML report escapes user supplied text', () => {
  const html = renderHtmlReport({
    tool: 'apicovenant',
    version: '0.1.0',
    document: 'openapi.yaml',
    findings: [
      {
        ruleId: 'x',
        severity: 'error',
        message: '<script>alert("x")</script>',
        path: '/a',
      },
    ],
  });
  assert.equal(html.includes('<script>alert'), false);
  assert.match(html, /&lt;script&gt;/);
});

test('escapeHtml escapes the dangerous characters', () => {
  assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});

test('the JSON report has a stable shape', () => {
  const report = buildJsonReport({
    tool: 'apicovenant',
    version: '0.1.0',
    document: 'openapi.yaml',
    findings,
    generatedAt: '2026-01-01T00:00:00.000Z',
  });

  assert.equal(report.summary.total, 2);
  assert.equal(report.summary.error, 1);
  assert.equal(report.summary.info, 1);
  assert.equal(report.summary.warn, 0);
  assert.equal(report.generatedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(report.findings[0]?.ruleId, 'operation-id-required');

  const parsed = JSON.parse(renderJsonReport({
    tool: 'apicovenant',
    version: '0.1.0',
    document: 'openapi.yaml',
    findings,
  })) as typeof report;
  assert.equal(parsed.findings.length, 2);
});

test('the text report lists every finding', () => {
  const output = renderTextReport({ document: 'openapi.yaml', findings });
  assert.match(output, /operation-id-required/);
  assert.match(output, /GET \/users/);
  assert.match(output, /paths\.\/users\.get/);
  assert.match(output, /Add a camelCase operationId/);
});

test('the text report celebrates a clean contract', () => {
  const output = renderTextReport({ document: 'openapi.yaml', findings: [] });
  assert.match(output, /no findings/);
});

test('the summary line is compact', () => {
  assert.match(renderSummaryLine({ error: 0, warn: 0, info: 0 }, 'x.yaml'), /0 findings/);
  assert.match(renderSummaryLine({ error: 2, warn: 1, info: 0 }, 'x.yaml'), /2 errors/);
});
