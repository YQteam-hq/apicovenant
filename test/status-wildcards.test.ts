import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadSpecFromText } from '../src/spec/loader.ts';
import { lint } from '../src/lint/engine.ts';

interface SpecOptions {
  version?: string;
  responses: Record<string, unknown>;
  schemas?: Record<string, unknown>;
}

function lintResponse(options: SpecOptions) {
  const spec = loadSpecFromText(
    JSON.stringify({
      openapi: options.version ?? '3.1.0',
      info: { title: 'Statuses', version: '1.0.0' },
      paths: {
        '/widgets': {
          get: {
            operationId: 'listWidgets',
            responses: options.responses,
          },
        },
      },
      components: { schemas: options.schemas ?? {} },
    }),
  );
  return lint(spec).findings;
}

const jsonBody = {
  description: 'ok',
  content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' } } } } },
};

test('"2XX" is a valid response key', () => {
  const findings = lintResponse({ responses: { '2XX': jsonBody } });
  assert.deepEqual(
    findings.filter((finding) => finding.ruleId === 'response-status-valid'),
    [],
  );
});

test('"2XX" satisfies the success response requirement', () => {
  const findings = lintResponse({ responses: { '2XX': jsonBody, '4XX': { description: 'error' } } });
  assert.deepEqual(
    findings.filter((finding) => finding.ruleId === 'response-success-required'),
    [],
  );
});

test('" 2XX" is accepted by 3.0 documents as well', () => {
  const findings = lintResponse({ version: '3.0.3', responses: { '2XX': jsonBody } });
  assert.deepEqual(
    findings.filter((finding) => finding.ruleId === 'response-status-valid'),
    [],
  );
});

test('a malformed wildcard is still rejected', () => {
  for (const key of ['2xx', '6XX', 'XX', '20O', '2X']) {
    const findings = lintResponse({ responses: { [key]: jsonBody } });
    assert.equal(
      findings.filter((finding) => finding.ruleId === 'response-status-valid').length,
      1,
      `"${key}" should be invalid`,
    );
  }
});

test('a 3.1 tuple with prefixItems does not need items', () => {
  const findings = lintResponse({
    responses: {
      '200': {
        description: 'ok',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Point' } } },
      },
    },
    schemas: {
      Point: {
        type: 'array',
        prefixItems: [{ type: 'number' }, { type: 'number' }],
        minItems: 2,
        maxItems: 2,
      },
    },
  });
  assert.deepEqual(
    findings.filter((finding) => finding.ruleId === 'schema-array-items-required'),
    [],
  );
});

test('an array without items or prefixItems is still reported', () => {
  const findings = lintResponse({
    responses: {
      '200': {
        description: 'ok',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Bare' } } },
      },
    },
    schemas: { Bare: { type: 'array' } },
  });
  assert.equal(
    findings.filter((finding) => finding.ruleId === 'schema-array-items-required').length,
    1,
  );
});
