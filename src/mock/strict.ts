import type { IncomingHttpHeaders } from 'node:http';

import type { ApiSpec, Operation, Parameter } from '../spec/model.ts';
import { deref } from '../spec/ref.ts';
import { validateSchema, type SchemaViolation } from '../spec/schema.ts';
import { isPlainObject } from '../util/text.ts';

export interface ValidationViolation {
  in: 'path' | 'query' | 'header' | 'cookie' | 'body';
  name?: string;
  path: string;
  message: string;
}

export interface MockValidation {
  status: number;
  error: 'invalid_request' | 'unsupported_media_type' | 'payload_too_large';
  violations: ValidationViolation[];
}

// Transport-level headers are never part of the API contract. The list stays
// intentionally small: anything application-specific must be documented.
const STANDARD_HEADERS = new Set([
  'accept',
  'accept-encoding',
  'accept-language',
  'authorization',
  'cache-control',
  'connection',
  'content-length',
  'content-type',
  'cookie',
  'host',
  'if-modified-since',
  'if-none-match',
  'origin',
  'pragma',
  'range',
  'referer',
  'upgrade-insecure-requests',
  'user-agent',
]);

function isTransportHeader(name: string): boolean {
  return (
    STANDARD_HEADERS.has(name) ||
    name.startsWith('sec-') ||
    name.startsWith('x-forwarded-') ||
    name.startsWith('x-real-')
  );
}

function parseCookies(header: string | string[] | undefined): Record<string, string> {
  const text = Array.isArray(header) ? header.join('; ') : (header ?? '');
  const out: Record<string, string> = {};
  for (const entry of text.split(';')) {
    const separator = entry.indexOf('=');
    if (separator === -1) continue;
    const name = entry.slice(0, separator).trim();
    if (!name) continue;
    const value = entry.slice(separator + 1).trim();
    out[name] = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  }
  return out;
}

function headerValues(headers: IncomingHttpHeaders, name: string): string[] {
  const raw = headers[name.toLowerCase()];
  if (raw === undefined) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function mediaTypeOf(contentType: string | undefined): string {
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

function isJsonMediaType(mediaType: string): boolean {
  return mediaType === 'application/json' || mediaType.endsWith('+json');
}

function coerceScalar(value: string, type: string | undefined): { value: unknown; error?: string } {
  if (type === 'integer') {
    if (!/^-?\d+$/.test(value.trim())) return { value, error: 'must be an integer' };
    return { value: Number.parseInt(value, 10) };
  }
  if (type === 'number') {
    const parsed = Number(value);
    if (value.trim() === '' || Number.isNaN(parsed)) return { value, error: 'must be a number' };
    return { value: parsed };
  }
  if (type === 'boolean') {
    if (value === 'true') return { value: true };
    if (value === 'false') return { value: false };
    return { value, error: 'must be true or false' };
  }
  return { value };
}

function schemaType(schema: Record<string, unknown>): string | undefined {
  const type = schema['type'];
  return typeof type === 'string' ? type : undefined;
}

function violationsFor(
  location: ValidationViolation['in'],
  name: string,
  value: unknown,
  schema: unknown,
): ValidationViolation[] {
  return validateSchema(value, schema).map((violation: SchemaViolation) => ({
    in: location,
    name,
    path: violation.path || `/${name}`,
    message: violation.message,
  }));
}

function collectParameter(
  parameter: Parameter,
  spec: ApiSpec,
  pathParams: Record<string, string>,
  url: URL,
  headers: IncomingHttpHeaders,
  cookies: Record<string, string>,
): { present: boolean; values: string[]; value: unknown; error?: string } {
  const name = parameter.name;
  let raw: string[] = [];
  if (parameter.in === 'path') {
    const value = pathParams[name];
    if (value !== undefined) raw = [value];
  } else if (parameter.in === 'query') {
    raw = url.searchParams.getAll(name);
  } else if (parameter.in === 'header') {
    raw = headerValues(headers, name);
  } else if (parameter.in === 'cookie') {
    const value = cookies[name];
    if (value !== undefined) raw = [value];
  }

  const schema = deref(spec.raw, parameter.schema);
  const object = isPlainObject(schema) ? schema : {};
  const type = schemaType(object);

  if (type === 'array') {
    const explode = parameter.explode ?? parameter.style !== 'form';
    const items = raw.flatMap((entry) => (explode ? [entry] : entry.split(',')));
    const itemSchema = object['items'];
    const coerced = items.map((entry) => {
      const itemType = isPlainObject(itemSchema) ? schemaType(itemSchema) : undefined;
      return coerceScalar(entry, itemType).value;
    });
    const firstError = items
      .map((entry) => {
        const itemType = isPlainObject(itemSchema) ? schemaType(itemSchema) : undefined;
        return coerceScalar(entry, itemType).error;
      })
      .find((error) => error !== undefined);
    return { present: raw.length > 0, values: raw, value: coerced, error: firstError };
  }

  const single = raw[0];
  if (single === undefined) return { present: false, values: [], value: undefined };
  const coerced = coerceScalar(single, type);
  return { present: true, values: [single], value: coerced.value, error: coerced.error };
}

/**
 * Validates a request against the operation it matched. Returns undefined when
 * the request is acceptable, otherwise the status and the violation list the
 * strict mock answers with.
 */
export function validateMockRequest(
  spec: ApiSpec,
  operation: Operation,
  pathParams: Record<string, string>,
  url: URL,
  headers: IncomingHttpHeaders,
  bodyText: string,
  maxBody: number,
  strictUnknown = false,
): MockValidation | undefined {
  const violations: ValidationViolation[] = [];
  const cookies = parseCookies(headers['cookie']);

  const seen = new Set<string>();
  for (const parameter of operation.parameters) {
    const key = `${parameter.in}:${parameter.name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const collected = collectParameter(parameter, spec, pathParams, url, headers, cookies);
    if (!collected.present) {
      if (parameter.required) {
        violations.push({
          in: parameter.in as ValidationViolation['in'],
          name: parameter.name,
          path: `/${parameter.name}`,
          message: 'is required',
        });
      }
      continue;
    }
    if (collected.error) {
      violations.push({
        in: parameter.in as ValidationViolation['in'],
        name: parameter.name,
        path: `/${parameter.name}`,
        message: collected.error,
      });
      continue;
    }
    const schema = deref(spec.raw, parameter.schema);
    if (schema !== undefined) {
      violations.push(...violationsFor(parameter.in as ValidationViolation['in'], parameter.name, collected.value, schema));
    }
  }

  if (strictUnknown) {
    const documented = new Map<string, Set<string>>([
      ['query', new Set()],
      ['header', new Set()],
      ['cookie', new Set()],
    ]);
    for (const parameter of operation.parameters) {
      documented.get(parameter.in)?.add(parameter.in === 'header' ? parameter.name.toLowerCase() : parameter.name);
    }

    for (const name of url.searchParams.keys()) {
      if (name === 'x-mock-status') continue;
      if (documented.get('query')?.has(name)) continue;
      violations.push({
        in: 'query',
        name,
        path: `/${name}`,
        message: 'is not documented',
      });
    }
    for (const name of Object.keys(headers)) {
      const lower = name.toLowerCase();
      if (isTransportHeader(lower) || lower.startsWith('x-mock-')) continue;
      if (documented.get('header')?.has(lower)) continue;
      violations.push({
        in: 'header',
        name: lower,
        path: `/${lower}`,
        message: 'is not documented',
      });
    }
    for (const name of Object.keys(cookies)) {
      if (documented.get('cookie')?.has(name)) continue;
      violations.push({
        in: 'cookie',
        name,
        path: `/${name}`,
        message: 'is not documented',
      });
    }
  }

  if (Buffer.byteLength(bodyText, 'utf8') > maxBody) {
    return {
      status: 413,
      error: 'payload_too_large',
      violations: [
        { in: 'body', path: '/', message: `request body exceeds ${maxBody} bytes` },
      ],
    };
  }

  const requestBody = operation.requestBody;
  if (requestBody) {
    if (bodyText.length === 0) {
      if (requestBody.required) {
        violations.push({ in: 'body', path: '/', message: 'request body is required' });
      }
    } else {
      const contentType = mediaTypeOf(Array.isArray(headers['content-type']) ? headers['content-type'][0] : headers['content-type']);
      const mediaType = [...requestBody.content.entries()].find(
        ([key]) => key.toLowerCase() === contentType,
      );
      if (!mediaType) {
        return {
          status: 415,
          error: 'unsupported_media_type',
          violations: [
            {
              in: 'body',
              path: '/',
              message: `unsupported Content-Type "${contentType || '(missing)'}"; documented: ${[...requestBody.content.keys()].join(', ')}`,
            },
          ],
        };
      }
      const [mediaTypeName, entry] = mediaType;
      const schema = entry.schema;
      if (schema !== undefined) {
        let parsed: unknown = bodyText;
        if (isJsonMediaType(mediaTypeName)) {
          try {
            parsed = JSON.parse(bodyText);
          } catch {
            return {
              status: 400,
              error: 'invalid_request',
              violations: [{ in: 'body', path: '/', message: 'must be valid JSON' }],
            };
          }
        }
        violations.push(...validateSchema(parsed, deref(spec.raw, schema)).map((violation) => ({
          in: 'body' as const,
          path: violation.path || '/',
          message: violation.message,
        })));
      }
    }
  }

  if (violations.length === 0) return undefined;
  return { status: 400, error: 'invalid_request', violations };
}
