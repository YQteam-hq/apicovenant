import path from 'node:path';

import { readTextFile } from '../util/fs.ts';
import { isPlainObject } from '../util/text.ts';
import { parseYaml, YamlError } from '../yaml/parser.ts';
import { collectRefs, resolveLocalRef } from './ref.ts';

export class ExternalRefError extends Error {
  readonly reference: string;
  readonly source: string;

  constructor(message: string, reference: string, source: string) {
    super(message);
    this.name = 'ExternalRefError';
    this.reference = reference;
    this.source = source;
  }
}

interface RefSplit {
  file: string;
  pointer: string;
}

function splitRef(ref: string): RefSplit {
  const hash = ref.indexOf('#');
  if (hash === -1) return { file: ref, pointer: '' };
  return { file: ref.slice(0, hash), pointer: ref.slice(hash) };
}

function isRemote(reference: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(reference);
}

function parseFile(text: string, filePath: string): unknown {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (path.extname(filePath).toLowerCase() === '.json') {
    try {
      return JSON.parse(source);
    } catch (error) {
      throw new ExternalRefError(
        `cannot parse ${filePath}: ${(error as Error).message}`,
        filePath,
        filePath,
      );
    }
  }
  try {
    return parseYaml(source);
  } catch (error) {
    if (error instanceof YamlError) {
      throw new ExternalRefError(`cannot parse ${filePath}: ${error.message}`, filePath, filePath);
    }
    throw error;
  }
}

/**
 * Resolves `$ref` values that point at another file, or at a part of the
 * current document other than the root.
 *
 * OpenAPI allows splitting a document across files ("common.yaml#/components/
 * schemas/User"). Everything downstream — lint rules, the mock generator, the
 * diff — only understands local pointers, so unresolved external references
 * used to be silently treated as "no schema": each one produced a false
 * finding, and a document with 868 of them produced 868 false findings with
 * no hint about the cause.
 *
 * Resolved targets are copied into `components.x-external.*` and referenced
 * through a local pointer, so shared schemas stay shared and recursive
 * definitions keep working.
 */
export async function bundleExternalRefs(root: unknown, documentPath: string): Promise<unknown> {
  if (!isPlainObject(root) && !Array.isArray(root)) return root;

  // Every document that keeps its references local is returned untouched;
  // bundling deep-copies the whole tree, which is measurable on multi-megabyte
  // specifications.
  const hasExternalRef = [...collectRefs(root)].some((ref) => !ref.startsWith('#/'));
  if (!hasExternalRef) return root;

  const files = new Map<string, unknown>();
  const bundled = new Map<string, string>();
  const externals: Record<string, unknown> = {};
  let counter = 0;

  const loadFile = async (filePath: string): Promise<unknown> => {
    const cached = files.get(filePath);
    if (cached !== undefined) return cached;
    let text: string;
    try {
      text = await readTextFile(filePath);
    } catch {
      throw new ExternalRefError(`referenced file does not exist: ${filePath}`, filePath, documentPath);
    }
    const parsed = parseFile(text, filePath);
    files.set(filePath, parsed);
    return parsed;
  };

  const bundleTarget = async (filePath: string, pointer: string, reference: string): Promise<string> => {
    const key = `${filePath}${pointer}`;
    const existing = bundled.get(key);
    if (existing) return existing;

    const document = await loadFile(filePath);
    const target = pointer === '' ? document : resolveLocalRef(document, pointer);
    if (target === undefined) {
      throw new ExternalRefError(
        `unresolved $ref "${reference}": no value at "${pointer || '#'}" in ${filePath}`,
        reference,
        documentPath,
      );
    }

    counter += 1;
    const name = `external_${counter}`;
    const localPointer = `#/components/x-external/${name}`;
    // Register before walking so that a recursive schema terminates.
    bundled.set(key, localPointer);
    externals[name] = await walk(target, filePath, false);
    return localPointer;
  };

  const walk = async (node: unknown, filePath: string, isRoot: boolean): Promise<unknown> => {
    if (isPlainObject(node) && typeof node['$ref'] === 'string') {
      const ref = node['$ref'];
      const { file, pointer } = splitRef(ref);

      if (isRemote(ref)) {
        throw new ExternalRefError(
          `external $ref "${ref}" points at a URL; apicovenant resolves local files only`,
          ref,
          documentPath,
        );
      }

      // A local pointer inside the root document already resolves as-is.
      if (isRoot && file === '') return { ...node };

      // Relative paths are relative to the file that contains the $ref,
      // not to the root document.
      const targetFile = file === '' ? filePath : path.resolve(path.dirname(filePath), file);
      const localPointer = await bundleTarget(targetFile, pointer, ref);
      const rest = Object.fromEntries(Object.entries(node).filter(([key]) => key !== '$ref'));
      return Object.keys(rest).length > 0 ? { $ref: localPointer, ...rest } : { $ref: localPointer };
    }

    if (Array.isArray(node)) {
      const out: unknown[] = [];
      for (const item of node) out.push(await walk(item, filePath, isRoot));
      return out;
    }

    if (isPlainObject(node)) {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node)) out[key] = await walk(value, filePath, isRoot);
      return out;
    }

    return node;
  };

  const result = (await walk(root, path.resolve(documentPath), true)) as Record<string, unknown>;

  if (Object.keys(externals).length === 0) return result;

  const components = isPlainObject(result['components']) ? result['components'] : {};
  const previous = isPlainObject(components['x-external']) ? components['x-external'] : {};
  return {
    ...result,
    components: {
      ...components,
      'x-external': { ...previous, ...externals },
    },
  };
}
