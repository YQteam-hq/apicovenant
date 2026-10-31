import path from 'node:path';

import { parseYaml, YamlError } from '../yaml/parser.ts';
import { isPlainObject } from '../util/text.ts';
import { readTextFile } from '../util/fs.ts';
import { buildSpec, type ApiSpec } from './model.ts';
import { collectRefs, resolveLocalRef } from './ref.ts';
import { bundleExternalRefs, ExternalRefError } from './external.ts';

export class SpecError extends Error {
  readonly file: string;

  constructor(message: string, file = '') {
    super(file ? `${file}: ${message}` : message);
    this.name = 'SpecError';
    this.file = file;
  }
}

export interface LoadOptions {

  document?: string;

  format?: 'yaml' | 'json';
}

export function parseDocument(text: string, options: LoadOptions = {}): unknown {
  const file = options.document ?? '';
  const format = options.format ?? detectFormat(file);

  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  try {
    if (format === 'json') {
      try {
        return JSON.parse(source);
      } catch (error) {
        throw new SpecError(`invalid JSON: ${(error as Error).message}`, file);
      }
    }
    return parseYaml(source);
  } catch (error) {
    if (error instanceof YamlError) {
      throw new SpecError(`invalid YAML: ${error.message}`, file);
    }
    throw error;
  }
}

export function detectFormat(file: string): 'yaml' | 'json' {
  const ext = path.extname(file).toLowerCase();
  return ext === '.json' ? 'json' : 'yaml';
}

export function validateDocument(doc: unknown, file = ''): void {
  if (!isPlainObject(doc)) {
    throw new SpecError('document root must be a mapping', file);
  }
  if (typeof doc['swagger'] === 'string') {
    throw new SpecError(
      `this is a Swagger ${doc['swagger']} document; apicovenant reads OpenAPI 3.0 and 3.1. ` +
        'Convert it first, for example with a Swagger 2.0 to OpenAPI 3 converter.',
      file,
    );
  }
  if (typeof doc['openapi'] !== 'string') {
    throw new SpecError(
      'missing "openapi" version field (expected an OpenAPI 3.0 or 3.1 document)',
      file,
    );
  }
  const version = doc['openapi'];
  if (!/^3\.\d+(\.\d+)?/.test(version)) {
    throw new SpecError(`unsupported OpenAPI version "${version}" (expected 3.0 or 3.1)`, file);
  }
  if (!isPlainObject(doc['info'])) {
    throw new SpecError('missing "info" object', file);
  }
  if (typeof doc['info']['title'] !== 'string' || doc['info']['title'].trim() === '') {
    throw new SpecError('missing "info.title"', file);
  }
  if (doc['paths'] !== undefined && !isPlainObject(doc['paths'])) {
    throw new SpecError('"paths" must be a mapping', file);
  }
}

// Every local $ref must point at something that exists; a dangling reference
// would otherwise make lint pass silently and mock return placeholder data.
function validateRefs(doc: unknown, file = ''): void {
  const refs = collectRefs(doc);
  for (const ref of refs) {
    if (!ref.startsWith('#/')) continue; // external references are out of scope
    if (resolveLocalRef(doc, ref) === undefined) {
      throw new SpecError(`unresolved $ref "${ref}"`, file);
    }
  }
}

export function loadSpecFromText(text: string, options: LoadOptions = {}): ApiSpec {
  const doc = parseDocument(text, options);
  validateDocument(doc, options.document ?? '');
  validateRefs(doc, options.document ?? '');
  return buildSpec(doc, options.document ?? '<memory>');
}

export async function loadSpecFile(filePath: string): Promise<ApiSpec> {
  const text = await readTextFile(filePath);
  const doc = parseDocument(text, { document: filePath });
  validateDocument(doc, filePath);

  // OpenAPI allows splitting a document across files. Everything downstream
  // only understands local pointers, so pull the referenced files in first.
  let bundled: unknown;
  try {
    bundled = await bundleExternalRefs(doc, filePath);
  } catch (error) {
    if (error instanceof ExternalRefError) {
      throw new SpecError(error.message, filePath);
    }
    throw error;
  }

  validateRefs(bundled, filePath);
  return buildSpec(bundled, filePath);
}

export async function loadSpecFromStdin(): Promise<ApiSpec> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return loadSpecFromText(text, { document: '<stdin>' });
}
