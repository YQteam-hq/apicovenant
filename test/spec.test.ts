import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadSpecFromText, parseDocument, validateDocument, SpecError } from '../src/spec/loader.ts';
import { buildSpec } from '../src/spec/model.ts';
import { deref, followRef, isRefNode, collectRefs, refName, resolveLocalRef } from '../src/spec/ref.ts';
import { isPlainObject } from '../src/util/text.ts';

const MINIMAL = `
openapi: 3.1.0
info:
  title: Test API
  version: 1.0.0
paths:
  /things:
    get:
      operationId: listThings
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Thing'
components:
  schemas:
    Thing:
      type: object
      properties:
        id:
          type: string
        parent:
          $ref: '#/components/schemas/Thing'
`;

test('loads a document and builds the normalized model', () => {
  const spec = loadSpecFromText(MINIMAL, { document: 'test.yaml' });
  assert.equal(spec.version, '3.1.0');
  assert.equal(spec.info.title, 'Test API');
  assert.equal(spec.operations.length, 1);
  assert.equal(spec.operations[0]?.key, 'GET /things');
  assert.equal(spec.operations[0]?.operationId, 'listThings');
  assert.equal(spec.operations[0]?.responses.get('200')?.content.get('application/json')?.schema !== undefined, true);
});

test('rejects a document without an openapi version', () => {
  assert.throws(() => validateDocument({ info: { title: 'x' } }), SpecError);
});

test('rejects an unsupported openapi version', () => {
  assert.throws(() => validateDocument({ openapi: '2.0', info: { title: 'x' } }), SpecError);
});

test('rejects a document without info.title', () => {
  assert.throws(() => validateDocument({ openapi: '3.0.0', info: {} }), SpecError);
});

test('tolerates a UTF-8 byte order mark', () => {
  const doc = parseDocument(`\uFEFF${MINIMAL}`, { document: 'bom.yaml' });
  assert.ok(isPlainObject(doc));
  assert.equal((doc as { openapi: string }).openapi, '3.1.0');
});

test('parses JSON documents', () => {
  const doc = parseDocument('{"openapi":"3.0.3","info":{"title":"J"}}', { document: 'x.json', format: 'json' });
  assert.deepEqual(doc, { openapi: '3.0.3', info: { title: 'J' } });
});

test('resolves local references', () => {
  const spec = loadSpecFromText(MINIMAL, { document: 'test.yaml' });
  const schema = spec.operations[0]?.responses.get('200')?.content.get('application/json')?.schema;
  assert.ok(schema);
  assert.equal(isRefNode(schema), true);

  const resolved = followRef(spec.raw, schema) as { properties?: Record<string, unknown> };
  assert.ok(resolved.properties?.['id']);
});

test('deref expands nested references but keeps recursive ones', () => {
  const spec = loadSpecFromText(MINIMAL, { document: 'test.yaml' });
  const expanded = deref(spec.raw, { $ref: '#/components/schemas/Thing' }) as {
    properties: Record<string, unknown>;
  };
  assert.equal(expanded.properties['id'] !== undefined, true);

  assert.equal(isRefNode(expanded.properties['parent']), true);
});

test('collectRefs finds every reference', () => {
  const refs = collectRefs({ a: { $ref: '#/x' }, b: [{ $ref: '#/y' }] });
  assert.deepEqual([...refs].sort(), ['#/x', '#/y']);
});

test('refName extracts the component name', () => {
  assert.equal(refName('#/components/schemas/User'), 'User');
});

test('merges path level and operation level parameters', () => {
  const spec = loadSpecFromText(
    [
      'openapi: 3.1.0',
      'info:',
      '  title: T',
      '  version: "1"',
      'paths:',
      '  /a/{id}:',
      '    parameters:',
      '      - name: id',
      '        in: path',
      '        required: true',
      '    get:',
      '      parameters:',
      '        - name: q',
      '          in: query',
      '      responses:',
      '        "200":',
      '          description: ok',
      '',
    ].join('\n'),
  );
  const operation = spec.operations[0];
  assert.equal(operation?.parameters.length, 2);
  assert.deepEqual(operation?.parameters.map((p) => p.name), ['id', 'q']);
});

test('buildSpec tolerates an empty document', () => {
  const spec = buildSpec({}, 'empty');
  assert.equal(spec.operations.length, 0);
  assert.equal(spec.info.title, 'Untitled API');
});

test('an external $ref degrades to the node itself instead of throwing', () => {
  const doc = { paths: {} };
  const node = { $ref: 'common.yaml#/components/schemas/Thing' };
  assert.equal(resolveLocalRef(doc, node.$ref), undefined);
  assert.deepEqual(followRef(doc, node), node);
  assert.deepEqual(deref(doc, node), node);
});

test('a malformed local pointer still throws', () => {
  assert.throws(() => resolveLocalRef({}, '#not-a-pointer'), /Invalid local reference/);
});
