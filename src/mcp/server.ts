import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';

import { TOOL_NAME, VERSION } from '../version.ts';
import { MCP_TOOLS, runMcpTool } from './tools.ts';
import {
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_PARSE_ERROR,
  MCP_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  errorResponse,
  isJsonRpcNotification,
  isJsonRpcRequest,
  successResponse,
  type JsonRpcResponse,
  type McpResource,
} from './protocol.ts';

export interface McpServerOptions {
  input: AsyncIterable<string | Uint8Array>;
  write: (line: string) => void;
  log?: (message: string) => void;
  cwd?: string;
}

const INSTRUCTIONS = [
  'apicovenant guards OpenAPI contracts. Use lint_openapi after editing a document,',
  'list_operations to learn what an API exposes, example_response to see the shape of a',
  'payload, list_rules to look up a rule, and check_contract_drift to compare recorded',
  'traffic against a live API or a mock.',
].join(' ');

function packageRoot(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, '..', '..');
  } catch {
    return process.cwd();
  }
}

function buildResources(): McpResource[] {
  return [
    {
      uri: 'apicovenant://rules',
      name: 'rule-reference',
      title: 'The rule reference',
      description: 'Every lint rule with its severity, category and what it protects.',
      mimeType: 'text/markdown',
    },
    {
      uri: 'apicovenant://docs',
      name: 'documentation',
      title: 'The documentation index',
      description: 'The guides that ship with the tool: rules, configuration and baselines.',
      mimeType: 'text/markdown',
    },
  ];
}

function readResource(uri: string): string | undefined {
  const root = packageRoot();
  if (uri === 'apicovenant://rules') {
    try {
      return readFileSync(path.join(root, 'docs', 'rules.md'), 'utf8');
    } catch {
      return undefined;
    }
  }
  if (uri === 'apicovenant://docs') {
    const files = [
      ['rules.md', 'The rule reference'],
      ['configuration.md', 'Configuration files'],
      ['baseline.md', 'Baselines'],
      ['mcp.md', 'The Model Context Protocol server'],
    ];
    const lines = ['# apicovenant documentation', ''];
    for (const [file, title] of files) {
      lines.push(`- ${title} — docs/${file}`);
    }
    return lines.join('\n');
  }
  return undefined;
}

function negotiateVersion(requested: unknown): string {
  if (typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) {
    return requested;
  }
  return MCP_PROTOCOL_VERSION;
}

export function createMessageHandler(
  options: McpServerOptions,
): (message: unknown) => Promise<JsonRpcResponse | undefined> {
  const cwd = options.cwd ?? process.cwd();

  return async function handle(message: unknown): Promise<JsonRpcResponse | undefined> {
    if (isJsonRpcNotification(message)) {
      return undefined;
    }

    if (!isJsonRpcRequest(message)) {
      return errorResponse(null, JSON_RPC_INVALID_REQUEST, 'Invalid request: expected JSON-RPC 2.0.');
    }

    const id = message.id;
    const params = message.params ?? {};

    switch (message.method) {
      case 'initialize': {
        const version = negotiateVersion(params['protocolVersion']);
        return successResponse(id, {
          protocolVersion: version,
          capabilities: {
            tools: { listChanged: false },
            resources: { listChanged: false, subscribe: false },
          },
          serverInfo: {
            name: TOOL_NAME,
            title: 'apicovenant — an OpenAPI contract guardian',
            version: VERSION,
          },
          instructions: INSTRUCTIONS,
        });
      }

      case 'ping':
        return successResponse(id, {});

      case 'tools/list':
        return successResponse(id, { tools: MCP_TOOLS.map((definition) => definition.tool) });

      case 'tools/call': {
        const name = params['name'];
        if (typeof name !== 'string' || name.length === 0) {
          return errorResponse(id, JSON_RPC_INVALID_PARAMS, 'Invalid params: "name" is required.');
        }
        const rawArguments = params['arguments'];
        const args =
          typeof rawArguments === 'object' && rawArguments !== null
            ? (rawArguments as Record<string, unknown>)
            : {};
        const result = await runMcpTool(name, args, { cwd });
        return successResponse(id, result);
      }

      case 'resources/list':
        return successResponse(id, { resources: buildResources() });

      case 'resources/read': {
        const uri = params['uri'];
        if (typeof uri !== 'string') {
          return errorResponse(id, JSON_RPC_INVALID_PARAMS, 'Invalid params: "uri" is required.');
        }
        const text = readResource(uri);
        if (text === undefined) {
          return errorResponse(id, JSON_RPC_INVALID_PARAMS, `Unknown resource: ${uri}`);
        }
        return successResponse(id, {
          contents: [{ uri, mimeType: 'text/markdown', text }],
        });
      }

      default:
        return errorResponse(id, JSON_RPC_METHOD_NOT_FOUND, `Method not found: ${message.method}`);
    }
  };
}

export async function serveMcp(options: McpServerOptions): Promise<void> {
  const handle = createMessageHandler(options);
  const decoder = new StringDecoder('utf8');
  let buffer = '';

  const send = (response: JsonRpcResponse): void => {
    options.write(`${JSON.stringify(response)}\n`);
  };

  const dispatch = async (line: string): Promise<void> => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      send(errorResponse(null, JSON_RPC_PARSE_ERROR, 'Parse error: the message is not valid JSON.'));
      return;
    }

    try {
      const response = await handle(message);
      if (response) send(response);
    } catch (error) {
      options.log?.(`apicovenant mcp: ${(error as Error).message}`);
      const id = isJsonRpcRequest(message) ? message.id : null;
      send(errorResponse(id, JSON_RPC_INTERNAL_ERROR, (error as Error).message ?? String(error)));
    }
  };

  for await (const chunk of options.input) {
    buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line.length > 0) await dispatch(line);
      index = buffer.indexOf('\n');
    }
  }

  const rest = buffer.trim();
  if (rest.length > 0) await dispatch(rest);
}
