import { deref } from '../spec/ref.ts';
import { generateExample, validateSchema } from '../spec/schema.ts';
import { isPlainObject } from '../util/text.ts';
import { matchesStatusClass } from '../mock/generator.ts';
import type { ApiSpec, Operation, Parameter, Response } from '../spec/model.ts';

export interface ContractCase {
  name: string;
  method: string;
  path: string;
  requestPath: string;
  headers: Record<string, string>;
  body?: string;
  contentType?: string;
  expectedStatuses: string[];
  skipped?: string;
}

export interface ContractCaseResult {
  name: string;
  method: string;
  path: string;
  status: 'pass' | 'fail' | 'skip';
  durationMs: number;
  message?: string;
}

export interface BuildOptions {
  includeUnsafe?: boolean;
  maxCases?: number;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function exampleFor(spec: ApiSpec, schema: unknown, example: unknown): unknown {
  if (example !== undefined) return example;
  const resolved = deref(spec.raw, schema);
  if (isPlainObject(resolved)) {
    if (resolved['example'] !== undefined) return resolved['example'];
    if (resolved['default'] !== undefined) return resolved['default'];
  }
  return generateExample(resolved, { includeOptional: false });
}

function serialiseParameter(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(',');
  }
  if (isPlainObject(value)) return JSON.stringify(value);
  return String(value);
}

function pushQuery(url: URL, parameter: Parameter, value: unknown): void {
  if (Array.isArray(value)) {
    // Query arrays default to style=form, explode=true, which repeats the name.
    const explode = parameter.explode ?? parameter.style !== 'form';
    if (explode) {
      for (const entry of value) url.searchParams.append(parameter.name, String(entry));
    } else {
      url.searchParams.set(parameter.name, value.map((entry) => String(entry)).join(','));
    }
    return;
  }
  url.searchParams.set(parameter.name, serialiseParameter(value));
}

/**
 * Builds one case per operation. Optional parameters without an example are
 * not invented: sending a random value would test the generator, not the API.
 */
export function buildContractCases(spec: ApiSpec, options: BuildOptions = {}): ContractCase[] {
  const maxCases = options.maxCases ?? 200;
  const cases: ContractCase[] = [];

  for (const operation of spec.operations) {
    if (cases.length >= maxCases) break;

    const method = operation.method.toUpperCase();
    const expectedStatuses = [...operation.responses.keys()];
    const name = `${method} ${operation.path}${operation.operationId ? ` (${operation.operationId})` : ''}`;

    if (!SAFE_METHODS.has(method) && !options.includeUnsafe) {
      cases.push({
        name,
        method,
        path: operation.path,
        requestPath: operation.path,
        headers: {},
        expectedStatuses,
        skipped: 'unsafe method (pass --include-unsafe to run it)',
      });
      continue;
    }

    let requestPath = operation.path;
    const headers: Record<string, string> = {};
    const cookies: string[] = [];
    const query = new URLSearchParams();
    let skipped: string | undefined;

    for (const parameter of operation.parameters) {
      const schema = deref(spec.raw, parameter.schema);
      const value = exampleFor(spec, schema, parameter.example ?? parameter.raw['example']);
      const schemaHasValue = isPlainObject(schema)
        && (schema['default'] !== undefined || schema['example'] !== undefined);

      if (parameter.in === 'path') {
        requestPath = requestPath.replace(
          `{${parameter.name}}`,
          encodeURIComponent(String(value)),
        );
        continue;
      }

      if (parameter.in === 'query') {
        const hasValue = parameter.required || parameter.example !== undefined
          || parameter.raw['example'] !== undefined || schemaHasValue;
        if (hasValue) {
          const url = new URL('http://localhost');
          pushQuery(url, parameter, value);
          for (const [key, entry] of url.searchParams) query.append(key, entry);
        }
        continue;
      }

      if (parameter.in === 'header') {
        if (parameter.required || parameter.example !== undefined
          || parameter.raw['example'] !== undefined || schemaHasValue) {
          headers[parameter.name] = String(value);
        }
        continue;
      }

      if (parameter.in === 'cookie') {
        if (parameter.required || parameter.example !== undefined
          || parameter.raw['example'] !== undefined || schemaHasValue) {
          cookies.push(`${parameter.name}=${encodeURIComponent(String(value))}`);
        }
      }
    }

    if (cookies.length > 0) headers['Cookie'] = cookies.join('; ');

    let body: string | undefined;
    let contentType: string | undefined;
    if (operation.requestBody) {
      const entries = [...operation.requestBody.content.entries()];
      const preferred = entries.find(([key]) => key.includes('json')) ?? entries[0];
      if (!preferred) {
        skipped = 'request body has no documented media type';
      } else {
        const [mediaType, entry] = preferred;
        contentType = mediaType;
        headers['Content-Type'] = mediaType;
        const value = entry.example !== undefined
          ? entry.example
          : generateExample(deref(spec.raw, entry.schema), { includeOptional: false });
        body = typeof value === 'string' ? value : JSON.stringify(value);
      }
    }

    if (skipped === undefined && requestPath.includes('{')) {
      skipped = 'a path parameter has no example';
    }

    const queryString = query.toString();
    cases.push({
      name,
      method,
      path: operation.path,
      requestPath: queryString.length > 0 ? `${requestPath}?${queryString}` : requestPath,
      headers,
      body,
      contentType,
      expectedStatuses,
      skipped,
    });
  }

  return cases;
}

export function findDocumentedResponse(operation: Operation, status: number): Response | undefined {
  const responses = [...operation.responses.values()];
  const exact = responses.find((response) => response.status === String(status));
  if (exact) return exact;
  const wildcard = responses.find((response) => matchesStatusClass(response.status, status));
  if (wildcard) return wildcard;
  return responses.find((response) => response.status === 'default');
}

function mediaBase(contentType: string | null): string {
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

export function validateContractResponse(
  spec: ApiSpec,
  operation: Operation,
  status: number,
  contentType: string | null,
  bodyText: string,
): string[] {
  const documented = findDocumentedResponse(operation, status);
  if (!documented) {
    return [
      `status ${status} is not documented (expected ${[...operation.responses.keys()].join(', ') || 'none'})`,
    ];
  }

  if (documented.content.size === 0) return [];

  const actualType = mediaBase(contentType);
  const mediaType = [...documented.content.entries()].find(
    ([key]) => key.toLowerCase() === actualType,
  );
  if (!mediaType) {
    return [
      `Content-Type "${actualType || '(missing)'}" is not documented for ${documented.status} (expected ${[...documented.content.keys()].join(', ')})`,
    ];
  }

  const [name, entry] = mediaType;
  if (!name.includes('json') || entry.schema === undefined) return [];

  let parsed: unknown;
  try {
    parsed = bodyText.length === 0 ? undefined : JSON.parse(bodyText);
  } catch {
    return ['response body is not valid JSON'];
  }

  return validateSchema(parsed, deref(spec.raw, entry.schema), { maxErrors: 5 }).map(
    (violation) => `${violation.path || '/'} ${violation.message}`,
  );
}
