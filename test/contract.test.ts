import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { loadSpecFromText } from '../src/spec/loader.ts';
import { buildContractCases } from '../src/contract/cases.ts';
import { runContractTests } from '../src/contract/run.ts';
import { renderJunit } from '../src/report/junit.ts';

const SPEC = {
  openapi: '3.0.3',
  info: { title: 'Contract', version: '1.0.0' },
  paths: {
    '/ping': {
      get: {
        operationId: 'ping',
        parameters: [
          { name: 'verbose', in: 'query', required: false, schema: { type: 'boolean', example: true } },
        ],
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['ok'],
                  properties: { ok: { type: 'boolean' } },
                },
              },
            },
          },
        },
      },
    },
    '/echo': {
      post: {
        operationId: 'echo',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: { name: { type: 'string' } },
              },
            },
          },
        },
        responses: { '201': { description: 'created' } },
      },
    },
  },
};

test('generates a case per operation and skips unsafe methods by default', () => {
  const spec = loadSpecFromText(JSON.stringify(SPEC));
  const safe = buildContractCases(spec);
  assert.equal(safe.length, 2);
  assert.equal(safe[0]?.requestPath, '/ping?verbose=true');
  assert.equal(safe[0]?.skipped, undefined);
  assert.match(safe[1]?.skipped ?? '', /unsafe/);

  const all = buildContractCases(spec, { includeUnsafe: true });
  assert.equal(all[1]?.skipped, undefined);
  assert.equal(all[1]?.method, 'POST');
  assert.equal(all[1]?.headers['Content-Type'], 'application/json');
  assert.equal(typeof JSON.parse(all[1]?.body ?? '{}').name, 'string');
});

test('an optional header or cookie is sent when its schema has a default', () => {
  const spec = loadSpecFromText(JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'Defaults', version: '1.0.0' },
    paths: {
      '/defaults': {
        get: {
          parameters: [
            { name: 'X-Tenant', in: 'header', schema: { type: 'string', default: 'acme' } },
            { name: 'session', in: 'cookie', schema: { type: 'string', example: 'abc' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  }));
  const [contractCase] = buildContractCases(spec);
  assert.equal(contractCase?.headers['X-Tenant'], 'acme');
  assert.equal(contractCase?.headers.Cookie, 'session=abc');
});

test('runs generated cases against the built-in mock', async () => {
  const spec = loadSpecFromText(JSON.stringify(SPEC));
  const run = await runContractTests(spec, { includeUnsafe: true });
  assert.equal(run.summary.total, 2);
  assert.equal(run.summary.failed, 0);
  assert.equal(run.summary.passed, 2);
});

test('reports undocumented statuses as failures', async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(500, { 'Content-Type': 'application/json' });
    response.end('{"error":"boom"}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;

  try {
    const spec = loadSpecFromText(JSON.stringify(SPEC));
    const run = await runContractTests(spec, { baseUrl: `http://127.0.0.1:${port}` });
    assert.equal(run.summary.failed, 1);
    assert.match(run.results[0]?.message ?? '', /status 500 is not documented/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('JUnit output records passes, failures and skips', () => {
  const xml = renderJunit('apicovenant', [
    { name: 'GET /ping', classname: 'apicovenant.GET', status: 'pass', durationMs: 4 },
    { name: 'POST /echo', classname: 'apicovenant.POST', status: 'fail', durationMs: 8, message: 'bad <json>' },
    { name: 'DELETE /x', classname: 'apicovenant.DELETE', status: 'skip', durationMs: 0, message: 'unsafe' },
  ]);

  assert.match(xml, /tests="3" failures="1" errors="0" skipped="1"/);
  assert.match(xml, /<failure message="bad &lt;json&gt;">/);
  assert.match(xml, /<skipped message="unsafe"\/>/);
  assert.equal((xml.match(/<testcase /g) ?? []).length, 3);
});
