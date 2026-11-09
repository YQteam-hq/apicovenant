import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadSpecFromText } from '../src/spec/loader.ts';
import { createGoldenFile, parseGoldenFile, type GoldenInteraction } from '../src/record/golden.ts';
import { coverageShouldFail, measureCoverage } from '../src/coverage/coverage.ts';

const spec = loadSpecFromText(
  JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'Coverage', version: '1' },
    paths: {
      '/users': {
        get: { responses: { '200': { description: 'ok' }, '400': { description: 'bad' } } },
        post: { responses: { '201': { description: 'created' } } },
      },
      '/users/{id}': {
        get: { responses: { '200': { description: 'ok' } } },
      },
      '/users/me': {
        get: { responses: { '200': { description: 'ok' } } },
      },
      '/files/{name}.json': {
        get: { responses: { '200': { description: 'ok' } } },
      },
    },
  }),
  { document: 'coverage.yaml' },
);

function interaction(method: string, path: string, status = 200): GoldenInteraction {
  return {
    method,
    path,
    query: {},
    requestHeaders: {},
    status,
    responseHeaders: {},
    body: '{}',
    bodyType: 'json',
    durationMs: 1,
  };
}

function golden(interactions: GoldenInteraction[]) {
  const file = createGoldenFile('http://example.test');
  file.interactions.push(...interactions);
  return file;
}

test('a full fixture reaches 100% and leaves no gaps', () => {
  const report = measureCoverage(
    golden([
      interaction('GET', '/users'),
      interaction('POST', '/users', 201),
      interaction('GET', '/users/42'),
      interaction('GET', '/users/me'),
      interaction('GET', '/files/report.json'),
    ]),
    spec,
    'full.json',
  );
  assert.equal(report.summary.percent, 100);
  assert.equal(report.unexercised.length, 0);
  assert.equal(report.undocumented.length, 0);
  assert.equal(report.statusGaps.length, 0);
  assert.equal(coverageShouldFail(report, 'gap'), false);
});

test('a partial fixture lists unexercised operations and undocumented traffic', () => {
  const report = measureCoverage(
    golden([
      interaction('GET', '/users'),
      interaction('GET', '/users/me'),
      interaction('GET', '/admin/reset'),
      interaction('PUT', '/users'),
    ]),
    spec,
    'partial.json',
  );
  assert.equal(report.summary.operations, 5);
  assert.equal(report.summary.exercised, 2);
  assert.equal(report.summary.percent, 40);
  assert.deepEqual(
    report.unexercised.map((entry) => entry.operation),
    ['GET /files/{name}.json', 'GET /users/{id}', 'POST /users'],
  );
  assert.deepEqual(report.undocumented, [
    { method: 'GET', path: '/admin/reset', reason: 'path-not-documented' },
    { method: 'PUT', path: '/users', reason: 'method-not-documented' },
  ]);
});

test('a literal path wins over a template', () => {
  const report = measureCoverage(golden([interaction('GET', '/users/me')]), spec, 'literal.json');
  assert.equal(report.summary.exercised, 1);
  assert.ok(report.unexercised.some((entry) => entry.operation === 'GET /users/{id}'));
});

test('a mixed template matches', () => {
  const report = measureCoverage(golden([interaction('GET', '/files/report.json')]), spec, 'mixed.json');
  assert.equal(report.summary.exercised, 1);
  assert.equal(report.undocumented.length, 0);
});

test('an undocumented status becomes a status gap but does not fail by default', () => {
  const report = measureCoverage(golden([interaction('GET', '/users', 500)]), spec, 'status.json');
  assert.deepEqual(report.statusGaps, [
    { method: 'GET', path: '/users', documented: ['200', '400'], observed: [500] },
  ]);
  assert.equal(coverageShouldFail(report, 'never'), false);
});

test('the coverage gate respects --min and --fail-on undocumented', () => {
  const partial = measureCoverage(golden([interaction('GET', '/users')]), spec, 'gate.json');
  assert.equal(coverageShouldFail(partial, 'gap', 90), true);
  assert.equal(coverageShouldFail(partial, 'gap', 10), false);

  const undocumented = measureCoverage(
    golden([interaction('GET', '/users'), interaction('GET', '/nope')]),
    spec,
    'undoc.json',
  );
  assert.equal(coverageShouldFail(undocumented, 'undocumented'), true);
});

test('a v1 golden file is accepted by the coverage engine', () => {
  const v1 = {
    apicovenant: 1,
    recordedAt: '2026-01-01T00:00:00.000Z',
    target: 'http://x',
    interactions: [{ method: 'GET', path: '/users', query: {}, status: 200, body: '{}', bodyType: 'json' }],
  };
  const report = measureCoverage(parseGoldenFile(JSON.stringify(v1)), spec, 'v1.json');
  assert.equal(report.summary.exercised, 1);
});
