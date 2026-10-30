export const MCP_PROTOCOL_VERSION = '2025-06-18';

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export const JSON_RPC_PARSE_ERROR = -32700;
export const JSON_RPC_INVALID_REQUEST = -32600;
export const JSON_RPC_METHOD_NOT_FOUND = -32601;
export const JSON_RPC_INVALID_PARAMS = -32602;
export const JSON_RPC_INTERNAL_ERROR = -32603;

export type JsonRpcId = string | number;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcErrorBody {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  result?: unknown;
  error?: JsonRpcErrorBody;
}

export interface McpSchema {
  type: 'object';
  properties?: Record<string, McpSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface McpSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: McpSchemaProperty;
  default?: unknown;
}

export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: McpSchema;
  outputSchema?: McpSchema;
  annotations?: McpToolAnnotations;
}

export interface McpTextContent {
  type: 'text';
  text: string;
}

export interface McpToolResult {
  content: McpTextContent[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

export interface McpResource {
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: string;
}

export function isJsonRpcRequest(message: unknown): message is JsonRpcRequest {
  if (typeof message !== 'object' || message === null) return false;
  const candidate = message as Record<string, unknown>;
  if (candidate['jsonrpc'] !== '2.0') return false;
  if (typeof candidate['method'] !== 'string') return false;
  const id = candidate['id'];
  return typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));
}

export function isJsonRpcNotification(message: unknown): message is JsonRpcNotification {
  if (typeof message !== 'object' || message === null) return false;
  const candidate = message as Record<string, unknown>;
  if (candidate['jsonrpc'] !== '2.0') return false;
  if (typeof candidate['method'] !== 'string') return false;
  return candidate['id'] === undefined;
}

export function successResponse(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

export function errorResponse(
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  const error: JsonRpcErrorBody = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id, error };
}

export function textResult(text: string, structured?: Record<string, unknown>): McpToolResult {
  const result: McpToolResult = { content: [{ type: 'text', text }] };
  if (structured !== undefined) result.structuredContent = structured;
  return result;
}

export function errorResult(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
