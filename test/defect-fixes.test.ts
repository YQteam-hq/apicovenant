import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { loadSpecFromText } from '../src/spec/loader.ts';
import { buildSpec } from '../src/spec/model.ts';
import { lint } from '../src/lint/engine.ts';
import { parseYaml } from '../src/yaml/parser.ts';
import { collectRefs } from '../src/spec/ref.ts';
import { validateSchema } from '../src/spec/schema.ts';
import { generatePayload } from '../src/mock/generator.ts';
import { compilePath, matchRoute } from '../src/mock/server.ts';
import { replayQuery, validateAgainstSpec } from '../src/diff/compare.ts';
import { interactionKey, parseGoldenFile } from '../src/record/golden.ts';
import { stripAnsi } from '../src/util/ansi.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'bin', 'apicovenant.mjs');

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd: root });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

function specOf(body: Record<string, unknown>) {
  return loadSpecFromText(
    JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'Fixtures', version: '1.0.0' },
      ...body,
    }),
  );
}

function routesOf(spec: ReturnType<typeof buildSpec>) {
  return spec.paths.flatMap((pathItem) =>
    pathItem.operations.map((operation) => {
      const compiled = compilePath(pathItem.path);
      return { operation, regex: compiled.regex, paramNames: compiled.paramNames };
    }),
  );
}

test('the replay does not send the redacted placeholder for a query parameter', () => {
  const query = replayQuery({ api_key: '<redacted>', page: '2' });
  assert.equal(query.includes('redacted'), false);
  assert.equal(query.includes('page=2'), true);
});

test('a query override replaces the recorded value and may add a new one', () => {
  const query = replayQuery({ api_key: '<redacted>', page: '2' }, { api_key: 'secret', limit: '10' });
  assert.equal(query.includes('api_key=secret'), true);
  assert.equal(query.includes('page=2'), true);
  assert.equal(query.includes('limit=10'), true);
  assert.equal(query.includes('redacted'), false);
});

test('a repeated query key keeps both values', () => {
  const file = parseGoldenFile(
    JSON.stringify({
      apicovenant: 1,
      target: 'http://127.0.0.1:4010',
      interactions: [
        {
          method: 'GET',
          path: '/search',
          query: { tag: ['a', 'b'] },
          requestHeaders: {},
          status: 200,
          responseHeaders: {},
        },
      ],
    }),
  );
  assert.equal(interactionKey(file.interactions[0]!), 'GET /search?tag=a&tag=b');
});

test('an operation level parameter overrides the path level one', () => {
  const spec = specOf({
    paths: {
      '/widgets': {
        parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' } }],
        get: {
          operationId: 'listWidgets',
          parameters: [{ name: 'page', in: 'query', schema: { type: 'string' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  });
  const findings = lint(spec).findings.filter((finding) => finding.ruleId === 'parameter-duplicate');
  assert.deepEqual(findings, []);
});

test('a plain scalar inside a sequence item folds the following lines', () => {
  const parsed = parseYaml('items:\n  - first line\n    second line\n') as { items: string[] };
  assert.equal(parsed.items[0], 'first line second line');
});

test('a static path is matched before a parameterised one', () => {
  const spec = buildSpec({
    openapi: '3.1.0',
    info: { title: 'Routes', version: '1.0.0' },
    paths: {
      '/users/{id}': {
        get: { operationId: 'getUser', responses: { '200': { description: 'ok' } } },
      },
      '/users/me': {
        get: { operationId: 'getMe', responses: { '200': { description: 'ok' } } },
      },
    },
  });
  const match = matchRoute(routesOf(spec), 'GET', '/users/me');
  assert.equal(match?.operation.operationId, 'getMe');
});

test('a HEAD request is answered by the GET operation', () => {
  const spec = buildSpec({
    openapi: '3.1.0',
    info: { title: 'Routes', version: '1.0.0' },
    paths: {
      '/users': {
        get: { operationId: 'listUsers', responses: { '200': { description: 'ok' } } },
      },
    },
  });
  const match = matchRoute(routesOf(spec), 'HEAD', '/users');
  assert.equal(match?.operation.operationId, 'listUsers');
});

test('a $ref inside an example payload is not a reference', () => {
  const refs = collectRefs({
    components: { schemas: { Widget: { type: 'object' } } },
    example: { $ref: '#/components/schemas/Widget' },
  });
  assert.equal(refs.has('#/components/schemas/Widget'), false);
});

test('a $ref inside a default value is not a reference', () => {
  const refs = collectRefs({
    components: { schemas: { Widget: { type: 'object' } } },
    properties: { fallback: { default: { $ref: '#/components/schemas/Widget' } } },
  });
  assert.equal(refs.has('#/components/schemas/Widget'), false);
});

test('a schema named default is still a reference', () => {
  const refs = collectRefs({
    components: { schemas: { default: { $ref: '#/components/schemas/Widget' } } },
  });
  assert.equal(refs.has('#/components/schemas/Widget'), true);
});

test('a recursive schema generates a payload that validates against itself', () => {
  const raw = {
    openapi: '3.1.0',
    info: { title: 'Tree', version: '1.0.0' },
    paths: {
      '/nodes': {
        get: {
          operationId: 'getNode',
          responses: {
            '200': {
              description: 'ok',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Node' } },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Node: {
          type: 'object',
          properties: { name: { type: 'string' }, child: { $ref: '#/components/schemas/Node' } },
        },
      },
    },
  };
  const spec = buildSpec(raw);
  const operation = spec.operations[0]!;
  const payload = generatePayload(spec, operation);
  const violations = validateSchema(JSON.parse(payload.body), raw.components.schemas.Node);
  assert.deepEqual(violations, []);
});

test('a recursive schema expands to the depth limit instead of collapsing early', () => {
  const raw = {
    openapi: '3.1.0',
    info: { title: 'Tree', version: '1.0.0' },
    paths: {
      '/nodes': {
        get: {
          operationId: 'getNode',
          responses: {
            '200': {
              description: 'ok',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Node' } },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Node: {
          type: 'object',
          properties: { name: { type: 'string' }, child: { $ref: '#/components/schemas/Node' } },
        },
      },
    },
  };
  const spec = buildSpec(raw);
  const operation = spec.operations[0]!;
  const payload = generatePayload(spec, operation);
  const parsed = JSON.parse(payload.body) as { child?: unknown };
  let depth = 0;
  let node: { child?: unknown } | undefined = parsed;
  while (node && node.child && typeof node.child === 'object') {
    depth += 1;
    node = node.child as { child?: unknown };
  }
  assert.equal(depth >= 4, true);
});

test('a schema that only allows null generates null', () => {
  const raw = {
    openapi: '3.1.0',
    info: { title: 'Null', version: '1.0.0' },
    paths: {
      '/nothing': {
        get: {
          operationId: 'getNothing',
          responses: {
            '200': {
              description: 'ok',
              content: { 'application/json': { schema: { type: 'null' } } },
            },
          },
        },
      },
    },
  };
  const spec = buildSpec(raw);
  const operation = spec.operations[0]!;
  const payload = generatePayload(spec, operation);
  assert.equal(JSON.parse(payload.body), null);
});

test('patternProperties claim a name before additionalProperties does', () => {
  const schema = {
    type: 'object',
    patternProperties: { '^x-': { type: 'string' } },
    additionalProperties: false,
  };
  assert.deepEqual(validateSchema({ 'x-trace': 'abc' }, schema), []);
  assert.equal(validateSchema({ 'x-trace': 1 }, schema).length, 1);
});

test('a text report written to a file carries no terminal escapes', () => {
  assert.equal(stripAnsi('\u001b[31merror\u001b[0m'), 'error');
});

test('a percent YAML directive does not become a document of its own', () => {
  const parsed = parseYaml('%YAML 1.2\n---\nvalue: 1\n') as { value: number };
  assert.equal(parsed.value, 1);
});

test('a 2XX response is schema checked during a replay', () => {
  const spec = buildSpec({
    openapi: '3.1.0',
    info: { title: 'Classes', version: '1.0.0' },
    paths: {
      '/widgets': {
        get: {
          operationId: 'listWidgets',
          responses: {
            '2XX': {
              description: 'ok',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
                },
              },
            },
          },
        },
      },
    },
  });
  const operation = spec.operations[0]!;
  const violations = validateAgainstSpec(spec, operation, {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: '{"nope": 1}',
  });
  assert.equal(violations.length > 0, true);
});

test('a default response is schema checked during a replay', () => {
  const spec = buildSpec({
    openapi: '3.1.0',
    info: { title: 'Defaults', version: '1.0.0' },
    paths: {
      '/widgets': {
        get: {
          operationId: 'listWidgets',
          responses: {
            default: {
              description: 'fallback',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
                },
              },
            },
          },
        },
      },
    },
  });
  const operation = spec.operations[0]!;
  const violations = validateAgainstSpec(spec, operation, {
    status: 500,
    headers: { 'content-type': 'application/json' },
    body: '{"nope": 1}',
  });
  assert.equal(violations.length > 0, true);
});

test('a quoted scalar with trailing content is rejected', () => {
  assert.throws(() => parseYaml('value: "text" trailing\n'), /Unexpected content after quoted scalar/);
});

test('an unterminated quoted scalar is rejected', () => {
  assert.throws(() => parseYaml('value: "text\nother: 1\n'), /Unterminated quoted string/);
});

test('an explicit block scalar indentation indicator is applied', () => {
  const parsed = parseYaml('value: |2\n   kept\n  trimmed\n') as { value: string };
  assert.equal(parsed.value, ' kept\ntrimmed\n');
});

test('a singular resource is not reported as a collection', () => {
  const spec = specOf({
    paths: {
      '/status': { get: { operationId: 'getStatus', responses: { '200': { description: 'ok' } } } },
      '/analysis': { get: { operationId: 'getAnalysis', responses: { '200': { description: 'ok' } } } },
    },
  });
  const findings = lint(spec).findings.filter((finding) => finding.ruleId === 'path-collection-plural');
  assert.deepEqual(findings, []);
});

test('the plural hint suggests a real plural', () => {
  const spec = specOf({
    paths: {
      '/category': { get: { operationId: 'listCategory', responses: { '200': { description: 'ok' } } } },
    },
  });
  const finding = lint(spec).findings.find((entry) => entry.ruleId === 'path-collection-plural');
  assert.equal(finding?.hint?.includes('/categories'), true);
});

test('a camel case pageSize is recognised as an offset style', () => {
  const spec = specOf({
    paths: {
      '/widgets': {
        get: {
          operationId: 'listWidgets',
          parameters: [{ name: 'pageSize', in: 'query', schema: { type: 'integer' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
      '/gadgets': {
        get: {
          operationId: 'listGadgets',
          parameters: [{ name: 'cursor', in: 'query', schema: { type: 'string' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  });
  const findings = lint(spec).findings.filter((finding) => finding.ruleId === 'pagination-consistency');
  assert.equal(findings.length, 1);
});

test('the error envelope rule says that most error responses are inline', () => {
  const spec = specOf({
    paths: {
      '/widgets': {
        get: {
          operationId: 'listWidgets',
          responses: {
            '200': { description: 'ok' },
            '400': { description: 'bad', content: { 'application/json': { schema: { type: 'object' } } } },
            '404': { description: 'gone', content: { 'application/json': { schema: { type: 'object' } } } },
            '500': {
              description: 'boom',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Error: { type: 'object', properties: { code: { type: 'string' } } },
      },
    },
  });
  const findings = lint(spec).findings.filter((entry) => entry.ruleId === 'response-error-envelope');
  assert.equal(
    findings.some((entry) => /defined inline/.test(entry.message)),
    true,
  );
});

test('a component referenced only from an example is still unused', () => {
  const spec = specOf({
    paths: {
      '/widgets': {
        get: {
          operationId: 'listWidgets',
          responses: {
            '200': {
              description: 'ok',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                  example: { $ref: '#/components/schemas/Widget' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Widget: { type: 'object', properties: { id: { type: 'string' } } },
      },
    },
  });
  const findings = lint(spec).findings.filter((finding) => finding.ruleId === 'component-unused');
  assert.equal(findings.length, 1);
});

test('the CLI rejects a query parameter without a value', async () => {
  const result = await runCli([
    'diff',
    '--golden',
    path.join(root, 'examples', 'traffic.golden.json'),
    '--spec',
    path.join(root, 'examples', 'shop.openapi.yaml'),
    '--query',
    'novalue',
  ]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /invalid query parameter "novalue"/);
});
