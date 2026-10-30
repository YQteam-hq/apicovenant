import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as api from '../src/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const shopSpecPath = path.resolve(here, '..', 'examples', 'shop.openapi.yaml');

test('the package entry point exposes the public API', async () => {
  const expected = [
    'lint',
    'allRules',
    'findRule',
    'loadSpecFile',
    'loadSpecFromText',
    'buildSpec',
    'validateSchema',
    'generateExample',
    'startMockServer',
    'startRecorder',
    'parseGoldenFile',
    'serializeGoldenFile',
    'compareGolden',
    'diffJson',
    'renderTextReport',
    'renderJsonReport',
    'renderHtmlReport',
    'renderDiffReport',
    'parseYaml',
    'VERSION',
  ];

  for (const name of expected) {
    assert.ok(name in api, `the entry point must export ${name}`);
  }
  assert.equal(typeof api.VERSION, 'string');
  assert.match(api.VERSION, /^\d+\.\d+\.\d+$/);
});

test('the public API can lint a document end to end', async () => {
  const spec = await api.loadSpecFile(shopSpecPath);
  const result = api.lint(spec);
  assert.equal(result.total, 0);
  assert.equal(api.allRules().length, result.executed.length);
});
