import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

import { loadSpecFile } from '../src/spec/loader.ts';
import { lint } from '../src/lint/engine.ts';
import { deref } from '../src/spec/ref.ts';

async function withSpecFiles<T>(files: Record<string, string>, fn: (entry: string, dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apicovenant-refs-'));
  try {
    for (const [name, contents] of Object.entries(files)) {
      const target = path.join(dir, name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, contents);
    }
    return await fn(path.join(dir, 'openapi.yaml'), dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const MAIN = `openapi: 3.0.3
info: { title: Split, version: 1.0.0 }
paths:
  /users:
    get:
      operationId: listUsers
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: './common/schemas.yaml#/User'
`;

const SCHEMAS = `User:
  type: object
  required: [id, name]
  properties:
    id: { type: string }
    name: { type: string }
    manager:
      $ref: '#/User'
`;

test('a $ref into another file is bundled and resolves downstream', async () => {
  await withSpecFiles({ 'openapi.yaml': MAIN, 'common/schemas.yaml': SCHEMAS }, async (entry) => {
    const spec = await loadSpecFile(entry);

    const external = spec.components['x-external'];
    assert.ok(external, 'expected components.x-external to be populated');
    assert.equal(Object.keys(external as object).length, 1);

    const schema = spec.operations[0]!.responses.get('200')!.content.get('application/json')!.schema;
    const expanded = deref(spec.raw, schema) as {
      type: string;
      items: { properties: Record<string, unknown> };
    };
    assert.equal(expanded.type, 'array');
    assert.ok(expanded.items.properties['id'], JSON.stringify(expanded.items));
  });
});

test('a bundled document lints without false findings', async () => {
  await withSpecFiles({ 'openapi.yaml': MAIN, 'common/schemas.yaml': SCHEMAS }, async (entry) => {
    const spec = await loadSpecFile(entry);
    const findings = lint(spec).findings;

    // Before bundling, the unresolved external $ref looked like "no schema"
    // and triggered these rules for a perfectly valid document.
    const ids = findings.map((finding) => finding.ruleId);
    assert.ok(!ids.includes('response-schema-required'), JSON.stringify(findings));
    assert.ok(!ids.includes('schema-array-items-required'), JSON.stringify(findings));
  });
});

test('external references may chain across files', async () => {
  await withSpecFiles(
    {
      'openapi.yaml': MAIN,
      'common/schemas.yaml': `User:
  allOf:
    - $ref: './base.yaml#/Entity'
    - type: object
      properties:
        name: { type: string }
`,
      'common/base.yaml': `Entity:
  type: object
  required: [id]
  properties:
    id: { type: string }
`,
    },
    async (entry) => {
      const spec = await loadSpecFile(entry);
      const schema = spec.operations[0]!.responses.get('200')!.content.get('application/json')!.schema;
      const expanded = deref(spec.raw, schema) as { items: { allOf: Array<{ properties: Record<string, unknown> }> } };
      assert.ok(expanded.items.allOf[0]!.properties['id'], JSON.stringify(expanded));
    },
  );
});

test('a missing referenced file is reported, not silently ignored', async () => {
  await withSpecFiles({ 'openapi.yaml': MAIN }, async (entry) => {
    await assert.rejects(loadSpecFile(entry), /does not exist/);
  });
});

test('a remote $ref is reported with an actionable message', async () => {
  await withSpecFiles(
    {
      'openapi.yaml': `openapi: 3.0.3
info: { title: Remote, version: 1.0.0 }
paths:
  /users:
    get:
      operationId: listUsers
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: 'https://example.com/schemas.yaml#/User'
`,
    },
    async (entry) => {
      await assert.rejects(loadSpecFile(entry), /points at a URL/);
    },
  );
});

test('an operation defined in another file keeps its operationId', async () => {
  await withSpecFiles(
    {
      'openapi.yaml': `openapi: 3.0.3
info: { title: Operations, version: 1.0.0 }
paths:
  /widgets:
    get:
      $ref: './operations/list.yml'
`,
      'operations/list.yml': `operationId: listWidgets
summary: List widgets
responses:
  '200':
    description: ok
    content:
      application/json:
        schema:
          type: array
          items:
            $ref: '../schemas/widget.yml#/Widget'
`,
      'schemas/widget.yml': `Widget:
  type: object
  required: [id]
  properties:
    id: { type: string }
`,
    },
    async (entry) => {
      const spec = await loadSpecFile(entry);
      assert.equal(spec.operations.length, 1);
      assert.equal(spec.operations[0]!.operationId, 'listWidgets');
      assert.equal(spec.operations[0]!.summary, 'List widgets');
      assert.ok(spec.operations[0]!.responses.get('200'));
    },
  );
});
