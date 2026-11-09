import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadSpecFromText } from '../src/spec/loader.ts';
import { compareSpecs, shouldFail } from '../src/breaking/compare.ts';

type Doc = Record<string, unknown>;

function baseDocument(): Doc {
  return {
    openapi: '3.0.3',
    info: { title: 'Users', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com' }],
    paths: {
      '/users': {
        get: {
          operationId: 'listUsers',
          parameters: [
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 20 } },
            { name: 'role', in: 'query', schema: { type: 'string', enum: ['admin', 'member'] } },
          ],
          responses: {
            '200': {
              description: 'ok',
              headers: { 'x-total': { schema: { type: 'integer' } } },
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items'],
                    properties: {
                      items: { type: 'array', items: { type: 'string' } },
                      total: { type: 'integer' },
                    },
                  },
                },
              },
            },
            '400': { description: 'bad request' },
          },
        },
        post: {
          operationId: 'createUser',
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { name: { type: 'string' }, age: { type: 'integer' } },
                },
              },
            },
          },
          responses: { '201': { description: 'created' } },
        },
      },
      '/users/{id}': {
        get: {
          operationId: 'getUser',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'ok',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['id'],
                    properties: { id: { type: 'string' }, email: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
      '/legacy': { get: { operationId: 'legacy', responses: { '200': { description: 'ok' } } } },
    },
  };
}

function compare(base: Doc, head: Doc) {
  return compareSpecs(
    loadSpecFromText(JSON.stringify(base), { document: 'base.yaml' }),
    loadSpecFromText(JSON.stringify(head), { document: 'head.yaml' }),
  );
}

function ids(report: ReturnType<typeof compare>): Set<string> {
  return new Set(report.changes.map((change) => change.id));
}

test('a document compared with itself has no changes', () => {
  const report = compare(baseDocument(), baseDocument());
  assert.equal(report.summary.total, 0);
  assert.deepEqual(report.summary, { breaking: 0, risky: 0, compatible: 0, info: 0, total: 0 });
});

test('the taxonomy covers the breaking-change classes of the release plan', () => {
  const base = baseDocument();
  const head = baseDocument() as any;

  delete head.paths['/legacy'];
  head.paths['/users'].get.operationId = 'getUsers';
  head.paths['/users'].get.parameters = [
    { name: 'limit', in: 'query', required: true, schema: { type: 'string' } },
    { name: 'role', in: 'header', schema: { type: 'string', enum: ['admin'] } },
    { name: 'cursor', in: 'query', required: true, schema: { type: 'string' } },
  ];
  head.paths['/users'].get.responses['200'].headers = {};
  head.paths['/users'].get.responses['200'].content['application/json'].schema.properties.total = {
    type: 'string',
  };
  delete head.paths['/users'].get.responses['400'];
  head.paths['/users'].post.requestBody.required = true;
  head.paths['/users'].post.requestBody.content['application/json'].schema.required = ['name'];
  head.paths['/users'].post.requestBody.content['application/json'].schema.properties.age = { type: 'string' };
  head.paths['/users'].post.requestBody.content['application/json'].schema.additionalProperties = false;
  delete head.paths['/users/{id}'].get.responses['200'].content['application/json'].schema.properties.email;

  const report = compare(base, head);
  const found = ids(report);

  for (const expected of [
    'operation-removed',
    'operation-id-changed',
    'parameter-required-added',
    'parameter-location-changed',
    'parameter-type-changed',
    'request-body-required-added',
    'request-property-required-added',
    'request-property-type-changed',
    'schema-additional-properties-forbidden',
    'response-status-removed',
    'response-header-removed',
    'response-property-removed',
    'response-property-type-changed',
    'schema-enum-narrowed',
  ]) {
    assert.ok(found.has(expected), `expected ${expected}, got ${[...found].join(', ')}`);
  }
});

test('required parameter removal and request bod-removal are reported', () => {
  const base = baseDocument();
  const head = baseDocument() as any;
  head.paths['/users'].get.parameters = head.paths['/users'].get.parameters.slice(1);
  delete head.paths['/users'].post.requestBody;

  const found = ids(compare(base, head));
  assert.ok(found.has('parameter-required-removed') || found.has('parameter-optional-removed'));
  assert.ok(found.has('request-body-removed'));
});

test('security, servers and deprecation are classified', () => {
  const base = baseDocument() as any;
  base.components = {
    securitySchemes: {
      oauth: { type: 'oauth2', flows: { clientCredentials: { tokenUrl: 'https://x/token', scopes: { read: 'r' } } } },
    },
  };
  const head = JSON.parse(JSON.stringify(base));
  head.paths['/users'].get.security = [{ oauth: ['read'] }];
  head.servers = [{ url: 'https://api2.example.com' }];
  head.paths['/legacy'].get.deprecated = true;

  const found = ids(compare(base, head));
  assert.ok(found.has('security-requirement-added'));
  assert.ok(found.has('server-removed'));
  assert.ok(found.has('server-added'));
  assert.ok(found.has('deprecated-added'));
});

test('--ignore-change removes a class and updates the summary', () => {
  const base = baseDocument();
  const head = baseDocument() as any;
  delete head.paths['/legacy'];

  const ignored = compareSpecs(
    loadSpecFromText(JSON.stringify(base)),
    loadSpecFromText(JSON.stringify(head)),
    { ignoreChanges: ['operation-removed'] },
  );
  assert.equal(ignored.summary.total, 0);
});

test('fail-on levels gate the exit status', () => {
  const base = baseDocument();
  const head = baseDocument() as any;
  head.paths['/users'].get.parameters.push({
    name: 'cursor',
    in: 'query',
    required: true,
    schema: { type: 'string' },
  });
  const report = compare(base, head);
  assert.equal(report.summary.breaking, 1);
  assert.equal(shouldFail(report, 'breaking'), true);
  assert.equal(shouldFail(report, 'never'), false);
});

test('a type change in both directions does not spam duplicates', () => {
  const base = baseDocument() as any;
  const head = baseDocument() as any;
  const schema = head.paths['/users'].get.responses['200'].content['application/json'].schema;
  schema.properties.total = { type: 'string' };
  const report = compare(base, head);
  const forTotal = report.changes.filter(
    (change) => change.id === 'response-property-type-changed' && change.message.includes('total'),
  );
  assert.equal(forTotal.length, 1);
});

test('recursive and reused schemas self-compare without exponential expansion', () => {
  const doc = {
    openapi: '3.0.3',
    info: { title: 'Tree', version: '1.0.0' },
    paths: {
      '/tree': {
        get: {
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
          properties: {
            value: { type: 'string' },
            parent: { $ref: '#/components/schemas/Node' },
            children: {
              type: 'array',
              items: { $ref: '#/components/schemas/Node' },
            },
          },
        },
      },
    },
  };
  const report = compare(doc, doc);
  assert.equal(report.changes.length, 0);
});
