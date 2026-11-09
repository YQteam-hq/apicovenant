import type { ApiSpec, MediaType, Operation, Parameter } from '../spec/model.ts';
import { deref } from '../spec/ref.ts';
import { deepEqual } from '../spec/schema.ts';
import { isPlainObject } from '../util/text.ts';
import {
  SEVERITY_RANK,
  definitionOf,
  type ChangeSeverity,
} from './taxonomy.ts';

export interface BreakingChange {
  id: string;
  severity: ChangeSeverity;
  operation: string;
  location: { base: string | null; head: string | null };
  message: string;
  hint: string;
}

export interface BreakingSummary {
  breaking: number;
  risky: number;
  compatible: number;
  info: number;
  total: number;
}

export interface BreakingReport {
  apicovenant: number;
  base: string;
  head: string;
  summary: BreakingSummary;
  changes: BreakingChange[];
}

export interface BreakingOptions {
  ignoreChanges?: string[];
}

const JSON_ESCAPE = (token: string): string => token.replace(/~/g, '~0').replace(/\//g, '~1');

function operationKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function indexOperations(spec: ApiSpec): Map<string, Operation> {
  const map = new Map<string, Operation>();
  for (const operation of spec.operations) map.set(operationKey(operation.method, operation.path), operation);
  return map;
}

function parameterKey(parameter: Parameter): string {
  return parameter.name;
}

function indexParameters(parameters: Parameter[]): Map<string, Parameter> {
  const map = new Map<string, Parameter>();
  for (const parameter of parameters) {
    if (!map.has(parameterKey(parameter))) map.set(parameterKey(parameter), parameter);
  }
  return map;
}

function typeName(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === 'string').sort().join('|');
  return undefined;
}

function typeSet(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  return [];
}

function isSuperSet(candidate: string[], reference: string[]): boolean {
  return reference.every((entry) => candidate.includes(entry));
}

function isSubSet(candidate: string[], reference: string[]): boolean {
  return candidate.every((entry) => reference.includes(entry));
}

interface SchemaContext {
  operation: string;
  direction: 'request' | 'response';
  baseDoc: unknown;
  headDoc: unknown;
  basePointer: string;
  headPointer: string;
  typeChangeId: string;
  emit: (id: string, message: string, base: string | null, head: string | null) => void;

  /** Memoizes schema pairs so recursive/reused definitions are visited once. */
  seen?: WeakMap<object, WeakSet<object>>;
}

function compareSchema(baseRaw: unknown, headRaw: unknown, context: SchemaContext, depth = 0, label = ''): void {
  if (depth > 12) return;

  const base = deref(context.baseDoc, baseRaw, { shallow: true });
  const head = deref(context.headDoc, headRaw, { shallow: true });
  if (!isPlainObject(base) || !isPlainObject(head)) return;

  // A document can reuse the same definition from many properties, and a
  // recursive definition can otherwise be expanded exponentially. Compare
  // each base/head object pair at most once per operation.
  const seen = context.seen ?? new WeakMap<object, WeakSet<object>>();
  context.seen = seen;
  let counterparts = seen.get(base);
  if (!counterparts) {
    counterparts = new WeakSet<object>();
    seen.set(base, counterparts);
  }
  if (counterparts.has(head)) return;
  counterparts.add(head);

  const composition = (schema: Record<string, unknown>): string | undefined => {
    for (const key of ['oneOf', 'anyOf', 'allOf']) {
      const value = schema[key];
      if (Array.isArray(value)) {
        const signature = value
          .map((entry) => (isPlainObject(entry) && typeof entry['$ref'] === 'string' ? entry['$ref'] : JSON.stringify(entry)))
          .join('|');
        return `${key}:${signature}`;
      }
    }
    return undefined;
  };

  const baseComposition = composition(base);
  const headComposition = composition(head);
  if (baseComposition !== headComposition && (baseComposition || headComposition)) {
    context.emit(
      'schema-composition-changed',
      `${label || 'Schema'} changed its composition (${baseComposition ?? 'none'} → ${headComposition ?? 'none'})`,
      context.basePointer,
      context.headPointer,
    );
    return;
  }

  const baseType = typeName(base['type']);
  const headType = typeName(head['type']);
  const baseTypes = typeSet(base['type']);
  const headTypes = typeSet(head['type']);

  if (baseTypes.length > 0 && headTypes.length > 0 && !deepEqual([...baseTypes].sort(), [...headTypes].sort())) {
    const widened = isSuperSet(headTypes, baseTypes);
    if (context.direction === 'response') {
      if (widened) {
        context.emit(
          'response-property-type-widened',
          `${label || 'Response schema'} widened its type from ${baseType} to ${headType}`,
          context.basePointer,
          context.headPointer,
        );
      } else if (isSubSet(headTypes, baseTypes)) {
        context.emit(
          context.typeChangeId,
          `${label || 'Response schema'} changed its type from ${baseType} to ${headType}`,
          context.basePointer,
          context.headPointer,
        );
      } else {
        context.emit(
          context.typeChangeId,
          `${label || 'Response schema'} changed its type from ${baseType} to ${headType}`,
          context.basePointer,
          context.headPointer,
        );
      }
    } else {
      context.emit(
        context.typeChangeId,
        `${label || 'Request schema'} changed its type from ${baseType} to ${headType}`,
        context.basePointer,
        context.headPointer,
      );
    }
  }

  const baseEnum = Array.isArray(base['enum']) ? base['enum'] : undefined;
  const headEnum = Array.isArray(head['enum']) ? head['enum'] : undefined;
  if (baseEnum && headEnum) {
    const removed = baseEnum.filter((value) => !headEnum.some((candidate) => deepEqual(candidate, value)));
    const added = headEnum.filter((value) => !baseEnum.some((candidate) => deepEqual(candidate, value)));
    const name = label || 'Schema';

    if (removed.length > 0) {
      if (context.direction === 'request') {
        context.emit(
          'schema-enum-narrowed',
          `${name} enum narrowed (removed ${removed.map((value) => JSON.stringify(value)).join(', ')})`,
          context.basePointer,
          context.headPointer,
        );
      }
    }
    if (added.length > 0) {
      if (context.direction === 'request') {
        context.emit(
          'schema-enum-widened',
          `${name} enum widened (added ${added.map((value) => JSON.stringify(value)).join(', ')})`,
          context.basePointer,
          context.headPointer,
        );
      } else {
        context.emit(
          'response-property-type-changed',
          `${name} enum widened (added ${added.map((value) => JSON.stringify(value)).join(', ')})`,
          context.basePointer,
          context.headPointer,
        );
      }
    }
  }

  const baseRequired = Array.isArray(base['required'])
    ? base['required'].filter((entry): entry is string => typeof entry === 'string')
    : [];
  const headRequired = Array.isArray(head['required'])
    ? head['required'].filter((entry): entry is string => typeof entry === 'string')
    : [];
  for (const name of headRequired) {
    if (baseRequired.includes(name)) continue;
    context.emit(
      context.direction === 'request' ? 'request-property-required-added' : 'response-property-required-added',
      `${context.direction === 'request' ? 'Request' : 'Response'} property "${label ? `${label}.` : ''}${name}" became required`,
      context.basePointer,
      context.headPointer,
    );
  }

  const baseProperties = isPlainObject(base['properties']) ? base['properties'] : {};
  const headProperties = isPlainObject(head['properties']) ? head['properties'] : {};

  for (const [name, value] of Object.entries(baseProperties)) {
    const childLabel = label ? `${label}.${name}` : name;
    if (!(name in headProperties)) {
      context.emit(
        context.direction === 'request' ? 'request-property-removed' : 'response-property-removed',
        `${context.direction === 'request' ? 'Request' : 'Response'} property "${childLabel}" was removed`,
        `${context.basePointer}/properties/${JSON_ESCAPE(name)}`,
        null,
      );
      continue;
    }
    compareSchema(value, headProperties[name], {
      ...context,
      basePointer: `${context.basePointer}/properties/${JSON_ESCAPE(name)}`,
      headPointer: `${context.headPointer}/properties/${JSON_ESCAPE(name)}`,
    }, depth + 1, childLabel);
  }

  for (const name of Object.keys(headProperties)) {
    if (name in baseProperties) continue;
    const childLabel = label ? `${label}.${name}` : name;
    context.emit(
      context.direction === 'request' ? 'request-property-added' : 'response-property-added',
      `${context.direction === 'request' ? 'Request' : 'Response'} property "${childLabel}" was added`,
      null,
      `${context.headPointer}/properties/${JSON_ESCAPE(name)}`,
    );
  }

  const baseAdditional = base['additionalProperties'];
  const headAdditional = head['additionalProperties'];
  if (baseAdditional !== false && headAdditional === false) {
    context.emit(
      'schema-additional-properties-forbidden',
      `${label || 'Schema'} no longer allows additional properties`,
      context.basePointer,
      context.headPointer,
    );
  } else if (baseAdditional === false && headAdditional !== false) {
    context.emit(
      'schema-additional-properties-allowed',
      `${label || 'Schema'} now allows additional properties`,
      context.basePointer,
      context.headPointer,
    );
  }

  if (base['default'] !== undefined && head['default'] !== undefined && !deepEqual(base['default'], head['default'])) {
    context.emit(
      'default-changed',
      `Default for ${label || 'schema'} changed from ${JSON.stringify(base['default'])} to ${JSON.stringify(head['default'])}`,
      context.basePointer,
      context.headPointer,
    );
  }

  if (base['items'] !== undefined && head['items'] !== undefined) {
    compareSchema(base['items'], head['items'], {
      ...context,
      basePointer: `${context.basePointer}/items`,
      headPointer: `${context.headPointer}/items`,
    }, depth + 1, label ? `${label}[]` : 'items');
  }
}

function mediaTypePointer(operation: Operation, direction: 'request' | 'response', status: string | null, mediaType: string): string {
  if (direction === 'request') {
    return `${operation.pointer}/requestBody/content/${JSON_ESCAPE(mediaType)}/schema`;
  }
  return `${operation.pointer}/responses/${JSON_ESCAPE(status ?? 'default')}/content/${JSON_ESCAPE(mediaType)}/schema`;
}

function compareMediaTypeSchemas(
  base: MediaType,
  head: MediaType,
  baseOperation: Operation,
  headOperation: Operation,
  direction: 'request' | 'response',
  status: string | null,
  emit: SchemaContext['emit'],
  baseDoc: unknown,
  headDoc: unknown,
  typeChangeId: string,
): void {
  if (base.schema === undefined || head.schema === undefined) return;
  compareSchema(base.schema, head.schema, {
    operation: headOperation.key,
    direction,
    baseDoc,
    headDoc,
    basePointer: mediaTypePointer(baseOperation, direction, status, base.contentType),
    headPointer: mediaTypePointer(headOperation, direction, status, head.contentType),
    typeChangeId,
    emit,
  });
}

function compareParameters(base: Operation, head: Operation, emit: SchemaContext['emit'], baseDoc: unknown, headDoc: unknown): void {
  const baseParameters = indexParameters(base.parameters);
  const headParameters = indexParameters(head.parameters);

  for (const [name, parameter] of baseParameters) {
    const counterpart = headParameters.get(name);
    if (!counterpart) {
      emit(
        parameter.required ? 'parameter-required-removed' : 'parameter-optional-removed',
        `Parameter "${name}" (${parameter.in}) was removed`,
        parameter.pointer,
        null,
      );
      continue;
    }
    if (parameter.in !== counterpart.in) {
      emit(
        'parameter-location-changed',
        `Parameter "${name}" moved from ${parameter.in} to ${counterpart.in}`,
        parameter.pointer,
        counterpart.pointer,
      );
    }
    if (!parameter.required && counterpart.required) {
      emit(
        'parameter-required-added',
        `Parameter "${name}" became required`,
        parameter.pointer,
        counterpart.pointer,
      );
    } else if (parameter.required && !counterpart.required) {
      emit(
        'parameter-required-removed',
        `Parameter "${name}" is no longer required`,
        parameter.pointer,
        counterpart.pointer,
      );
    }
    if (parameter.schema !== undefined && counterpart.schema !== undefined) {
      compareSchema(parameter.schema, counterpart.schema, {
        operation: head.key,
        direction: 'request',
        baseDoc,
        headDoc,
        basePointer: `${parameter.pointer}/schema`,
        headPointer: `${counterpart.pointer}/schema`,
        typeChangeId: 'parameter-type-changed',
        emit,
      }, 0, `Parameter "${name}"`);
    }
  }

  for (const [name, parameter] of headParameters) {
    if (baseParameters.has(name)) continue;
    emit(
      parameter.required ? 'parameter-required-added' : 'parameter-optional-added',
      `Parameter "${name}" (${parameter.in}) was added`,
      null,
      parameter.pointer,
    );
  }
}

function compareRequestBodies(base: Operation, head: Operation, emit: SchemaContext['emit'], baseDoc: unknown, headDoc: unknown): void {
  const baseBody = base.requestBody;
  const headBody = head.requestBody;

  if (!baseBody && !headBody) return;
  if (!baseBody && headBody) {
    emit(
      headBody.required ? 'request-body-required-added' : 'request-body-added',
      headBody.required ? 'A required request body was added' : 'An optional request body was added',
      null,
      headBody.pointer,
    );
  }
  if (baseBody && !headBody) {
    emit('request-body-removed', 'The request body was removed', baseBody.pointer, null);
    return;
  }
  if (!baseBody || !headBody) return;

  if (!baseBody.required && headBody.required) {
    emit('request-body-required-added', 'The request body became required', baseBody.pointer, headBody.pointer);
  }

  for (const [contentType, mediaType] of baseBody.content) {
    const counterpart = headBody.content.get(contentType);
    if (!counterpart) {
      emit(
        'request-media-type-removed',
        `Request media type "${contentType}" was removed`,
        `${baseBody.pointer}/content/${JSON_ESCAPE(contentType)}`,
        null,
      );
      continue;
    }
    compareMediaTypeSchemas(
      mediaType,
      counterpart,
      base,
      head,
      'request',
      null,
      emit,
      baseDoc,
      headDoc,
      'request-property-type-changed',
    );
  }
  for (const contentType of headBody.content.keys()) {
    if (baseBody.content.has(contentType)) continue;
    emit(
      'request-media-type-added',
      `Request media type "${contentType}" was added`,
      null,
      `${headBody.pointer}/content/${JSON_ESCAPE(contentType)}`,
    );
  }
}

function compareResponses(base: Operation, head: Operation, emit: SchemaContext['emit'], baseDoc: unknown, headDoc: unknown): void {
  for (const [status, response] of base.responses) {
    const counterpart = head.responses.get(status);
    if (!counterpart) {
      emit(
        'response-status-removed',
        `Response status ${status} was removed`,
        response.pointer,
        null,
      );
      continue;
    }
    for (const [contentType, mediaType] of response.content) {
      const headMedia = counterpart.content.get(contentType);
      if (!headMedia) {
        emit(
          'response-media-type-removed',
          `Response media type "${contentType}" was removed for status ${status}`,
          `${response.pointer}/content/${JSON_ESCAPE(contentType)}`,
          null,
        );
        continue;
      }
      compareMediaTypeSchemas(
        mediaType,
        headMedia,
        base,
        head,
        'response',
        status,
        emit,
        baseDoc,
        headDoc,
        'response-property-type-changed',
      );
    }
    for (const contentType of counterpart.content.keys()) {
      if (response.content.has(contentType)) continue;
      emit(
        'response-media-type-added',
        `Response media type "${contentType}" was added for status ${status}`,
        null,
        `${counterpart.pointer}/content/${JSON_ESCAPE(contentType)}`,
      );
    }
    for (const header of response.headers.keys()) {
      if (counterpart.headers.has(header)) continue;
      emit(
        'response-header-removed',
        `Response header "${header}" was removed for status ${status}`,
        `${response.pointer}/headers/${JSON_ESCAPE(header)}`,
        null,
      );
    }
    for (const header of counterpart.headers.keys()) {
      if (response.headers.has(header)) continue;
      emit(
        'response-header-added',
        `Response header "${header}" was added for status ${status}`,
        null,
        `${counterpart.pointer}/headers/${JSON_ESCAPE(header)}`,
      );
    }
  }

  for (const status of head.responses.keys()) {
    if (base.responses.has(status)) continue;
    emit(
      'response-status-added',
      `Response status ${status} was added`,
      null,
      head.responses.get(status)?.pointer ?? null,
    );
  }
}

function scopesFor(security: Array<Record<string, string[]>>, scheme: string): string[] {
  const out = new Set<string>();
  for (const requirement of security) {
    for (const scope of requirement[scheme] ?? []) out.add(scope);
  }
  return [...out];
}

function schemeSet(security: Array<Record<string, string[]>>): Set<string> {
  const out = new Set<string>();
  for (const requirement of security) {
    for (const scheme of Object.keys(requirement)) out.add(scheme);
  }
  return out;
}

function compareSecurity(base: Operation, head: Operation, emit: SchemaContext['emit']): void {
  const baseSchemes = schemeSet(base.security);
  const headSchemes = schemeSet(head.security);

  for (const scheme of headSchemes) {
    if (!baseSchemes.has(scheme)) {
      emit(
        'security-requirement-added',
        `Security scheme "${scheme}" is now required`,
        null,
        `${head.pointer}/security`,
      );
      continue;
    }
    const baseScopes = scopesFor(base.security, scheme);
    for (const scope of scopesFor(head.security, scheme)) {
      if (baseScopes.includes(scope)) continue;
      emit(
        'security-scope-added',
        `Security scope "${scope}" of scheme "${scheme}" is now required`,
        null,
        `${head.pointer}/security`,
      );
    }
  }

  for (const scheme of baseSchemes) {
    if (headSchemes.has(scheme)) continue;
    emit(
      'security-requirement-removed',
      `Security scheme "${scheme}" is no longer required`,
      `${base.pointer}/security`,
      null,
    );
  }
}

export function compareSpecs(base: ApiSpec, head: ApiSpec, options: BreakingOptions = {}): BreakingReport {
  const ignored = new Set(options.ignoreChanges ?? []);
  const changes: BreakingChange[] = [];
  const seen = new Set<string>();

  const emitFor = (operation: string) =>
    (id: string, message: string, basePointer: string | null, headPointer: string | null): void => {
      if (ignored.has(id)) return;
      const key = `${id}|${operation}|${basePointer ?? ''}|${headPointer ?? ''}|${message}`;
      if (seen.has(key)) return;
      seen.add(key);
      const definition = definitionOf(id);
      changes.push({
        id,
        severity: definition.severity,
        operation,
        location: { base: basePointer, head: headPointer },
        message,
        hint: definition.hint,
      });
    };

  const baseOperations = indexOperations(base);
  const headOperations = indexOperations(head);

  for (const [key, operation] of baseOperations) {
    const counterpart = headOperations.get(key);
    if (!counterpart) {
      const emit = emitFor(key);
      emit(
        'operation-removed',
        `Operation ${key} was removed`,
        operation.pointer,
        null,
      );
      continue;
    }
    const emit = emitFor(key);
    if ((operation.operationId ?? '') !== (counterpart.operationId ?? '')) {
      emit(
        'operation-id-changed',
        `operationId changed from "${operation.operationId ?? '(none)'}" to "${counterpart.operationId ?? '(none)'}"`,
        `${operation.pointer}/operationId`,
        `${counterpart.pointer}/operationId`,
      );
    }
    if (!operation.deprecated && counterpart.deprecated) {
      emit('deprecated-added', `Operation ${key} was marked deprecated`, null, `${counterpart.pointer}/deprecated`);
    }
    compareParameters(operation, counterpart, emit, base.raw, head.raw);
    compareRequestBodies(operation, counterpart, emit, base.raw, head.raw);
    compareResponses(operation, counterpart, emit, base.raw, head.raw);
    compareSecurity(operation, counterpart, emit);
  }

  for (const [key, operation] of headOperations) {
    if (baseOperations.has(key)) continue;
    emitFor(key)(
      'operation-added',
      `Operation ${key} was added`,
      null,
      operation.pointer,
    );
  }

  const baseServers = new Set(base.servers.map((server) => server.url));
  const headServers = new Set(head.servers.map((server) => server.url));
  for (const url of baseServers) {
    if (!headServers.has(url)) {
      emitFor('(document)')('server-removed', `Server "${url}" was removed`, '/servers', null);
    }
  }
  for (const url of headServers) {
    if (!baseServers.has(url)) {
      emitFor('(document)')('server-added', `Server "${url}" was added`, null, '/servers');
    }
  }

  changes.sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    if (a.operation !== b.operation) return a.operation.localeCompare(b.operation);
    if (a.id !== b.id) return a.id.localeCompare(b.id);
    return (a.location.base ?? '').localeCompare(b.location.base ?? '');
  });

  const summary: BreakingSummary = { breaking: 0, risky: 0, compatible: 0, info: 0, total: changes.length };
  for (const change of changes) summary[change.severity] += 1;

  return {
    apicovenant: 1,
    base: base.document,
    head: head.document,
    summary,
    changes,
  };
}

export function shouldFail(report: BreakingReport, mode: 'breaking' | 'risky' | 'any' | 'never'): boolean {
  if (mode === 'never') return false;
  if (mode === 'any') return report.changes.length > 0;
  if (mode === 'risky') return report.summary.breaking > 0 || report.summary.risky > 0;
  return report.summary.breaking > 0;
}
