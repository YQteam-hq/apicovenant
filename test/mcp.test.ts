import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { serveMcp } from '../src/mcp/server.ts';
import { MCP_PROTOCOL_VERSION } from '../src/mcp/protocol.ts';
import type { JsonRpcResponse } from '../src/mcp/protocol.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function drive(messages: unknown[]): Promise<JsonRpcResponse[]> {
  const lines: string[] = [];
  const input = (async function* () {
    for (const message of messages) {
      yield typeof message === 'string' ? `${message}\n` : `${JSON.stringify(message)}\n`;
    }
  })();

  await serveMcp({
    input,
    write: (line) => {
      lines.push(line);
    },
    cwd: root,
  });

  return lines.map((line) => JSON.parse(line) as JsonRpcResponse);
}

async function driveOne(message: unknown): Promise<JsonRpcResponse> {
  const responses = await drive([message]);
  const response = responses[0];
  assert.ok(response, 'the server did not answer');
  return response;
}

function initialize(id = 1) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
  };
}

test('initialize negotiates the protocol version and announces the capabilities', async () => {
  const response = await driveOne(initialize());
  const result = response.result as Record<string, any>;

  assert.equal(response.jsonrpc, '2.0');
  assert.equal(response.id, 1);
  assert.equal(result['protocolVersion'], MCP_PROTOCOL_VERSION);
  assert.equal(result['serverInfo'].name, 'apicovenant');
  assert.ok(result['serverInfo'].version);
  assert.ok(result['capabilities'].tools);
  assert.ok(result['capabilities'].resources);
  assert.ok(result['instructions']);
});

test('a client that asks for an older version gets that version back', async () => {
  const response = await driveOne(
    { ...initialize(), params: { protocolVersion: '2025-03-26', capabilities: {} } },
  );
  assert.equal((response.result as Record<string, any>)['protocolVersion'], '2025-03-26');
});

test('a client that asks for an unknown version gets the supported one', async () => {
  const response = await driveOne(
    { ...initialize(), params: { protocolVersion: '1999-01-01', capabilities: {} } },
  );
  assert.equal((response.result as Record<string, any>)['protocolVersion'], MCP_PROTOCOL_VERSION);
});

test('notifications never get a response', async () => {
  const responses = await drive([
    initialize(),
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } },
    { jsonrpc: '2.0', id: 2, method: 'ping' },
  ]);

  assert.equal(responses.length, 2);
  assert.deepEqual(
    responses.map((response) => response.id),
    [1, 2],
  );
});

test('an unknown method is a JSON-RPC error', async () => {
  const response = await driveOne({ jsonrpc: '2.0', id: 7, method: 'nope/nope' });
  assert.equal(response.error?.code, -32601);
  assert.match(response.error?.message ?? '', /Method not found/);
});

test('a message that is not JSON is a parse error', async () => {
  const response = await driveOne('this is not json');
  assert.equal(response.error?.code, -32700);
  assert.equal(response.id, null);
});

test('tools/list announces every tool with an input schema', async () => {
  const response = await driveOne({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const tools = (response.result as Record<string, any>)['tools'] as Array<Record<string, any>>;

  assert.deepEqual(
    tools.map((tool) => tool['name']).sort(),
    ['check_contract_drift', 'example_response', 'lint_openapi', 'list_operations', 'list_rules'],
  );
  for (const tool of tools) {
    assert.equal(tool['inputSchema'].type, 'object');
    assert.ok(tool['description']);
    assert.ok(tool['title']);
  }
});

test('resources/list and resources/read expose the documentation', async () => {
  const responses = await drive([
    { jsonrpc: '2.0', id: 2, method: 'resources/list' },
    { jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'apicovenant://rules' } },
    { jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'apicovenant://nope' } },
  ]);

  const resources = (responses[0]?.result as Record<string, any>)['resources'] as Array<Record<string, any>>;
  assert.ok(resources.some((resource) => resource['uri'] === 'apicovenant://rules'));

  const contents = (responses[1]?.result as Record<string, any>)['contents'] as Array<Record<string, any>>;
  assert.match(contents[0]?.text ?? '', /operation-id-required/);

  assert.equal(responses[2]?.error?.code, -32602);
});

test('lint_openapi reports the findings of a broken document', async () => {
  const response = await driveOne(
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'lint_openapi',
        arguments: { path: 'examples/legacy.openapi.yaml', severity: 'error' },
      },
    },
  );

  const result = response.result as Record<string, any>;
  assert.notEqual(result['isError'], true);
  const structured = result['structuredContent'] as Record<string, any>;
  assert.ok(structured['total'] > 0);
  assert.ok(structured['counts'].error > 0);
  assert.match(result['content'][0].text, /operation-id-required/);
});

test('lint_openapi rejects a severity outside the enum with a tool error', async () => {
  const response = await driveOne(
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'lint_openapi',
        arguments: { path: 'examples/legacy.openapi.yaml', severity: 'bogus' },
      },
    },
  );

  const result = response.result as Record<string, any>;
  assert.equal(result['isError'], true);
  assert.match(result['content'][0].text, /Invalid severity "bogus"/);
});

test('lint_openapi accepts a clean document and an unknown rule', async () => {
  const responses = await drive([
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'lint_openapi', arguments: { path: 'examples/shop.openapi.yaml' } },
    },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'lint_openapi', arguments: { path: 'examples/shop.openapi.yaml', rules: ['no-such-rule'] } },
    },
  ]);

  const clean = responses[0]?.result as Record<string, any>;
  assert.equal((clean['structuredContent'] as Record<string, any>)['total'], 0);
  assert.match(clean['content'][0].text, /follows every convention/);

  const bad = responses[1]?.result as Record<string, any>;
  assert.equal(bad['isError'], true);
  assert.match(bad['content'][0].text, /Unknown rule/);
});

test('list_operations describes the operations of a document', async () => {
  const response = await driveOne(
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'list_operations', arguments: { path: 'examples/shop.openapi.yaml' } },
    },
  );

  const structured = (response.result as Record<string, any>)['structuredContent'] as Record<string, any>;
  assert.ok(structured['total'] > 0);
  const operations = structured['operations'] as Array<Record<string, any>>;
  assert.ok(operations.every((operation) => typeof operation['method'] === 'string'));
  assert.ok(operations.every((operation) => typeof operation['path'] === 'string'));
});

test('example_response returns a payload for an operation', async () => {
  const response = await driveOne(
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'example_response',
        arguments: { path: 'examples/shop.openapi.yaml', method: 'get', operationPath: '/users' },
      },
    },
  );

  const result = response.result as Record<string, any>;
  assert.notEqual(result['isError'], true);
  const structured = result['structuredContent'] as Record<string, any>;
  assert.equal(structured['status'], 200);
  assert.ok(structured['body']);
});

test('example_response explains an operation that does not exist', async () => {
  const response = await driveOne(
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'example_response',
        arguments: { path: 'examples/shop.openapi.yaml', method: 'delete', operationPath: '/nope' },
      },
    },
  );

  const result = response.result as Record<string, any>;
  assert.equal(result['isError'], true);
  assert.match(result['content'][0].text, /No operation DELETE \/nope/);
});

test('list_rules can be filtered by category', async () => {
  const response = await driveOne(
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'list_rules', arguments: { category: 'pagination' } },
    },
  );

  const structured = (response.result as Record<string, any>)['structuredContent'] as Record<string, any>;
  assert.equal(structured['total'], 2);
  const rules = structured['rules'] as Array<Record<string, any>>;
  assert.ok(rules.every((rule) => rule['category'] === 'pagination'));
});

test('an unknown tool is a tool error, not a crash', async () => {
  const response = await driveOne(
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'nope', arguments: {} } },
  );

  const result = response.result as Record<string, any>;
  assert.equal(result['isError'], true);
  assert.match(result['content'][0].text, /Unknown tool/);
});

test('a missing argument is reported as a tool error', async () => {
  const response = await driveOne(
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'lint_openapi', arguments: {} },
    },
  );

  const result = response.result as Record<string, any>;
  assert.equal(result['isError'], true);
  assert.match(result['content'][0].text, /"path" is required/);
});
