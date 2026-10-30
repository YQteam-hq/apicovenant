import type { RuleDefinition } from '../types.ts';

const VERB_PREFIXES = [
  'get',
  'list',
  'create',
  'update',
  'delete',
  'remove',
  'patch',
  'put',
  'fetch',
  'find',
  'search',
  'count',
  'bulk',
  'cancel',
  'confirm',
  'verify',
  'download',
  'upload',
  'export',
  'import',
  'subscribe',
  'unsubscribe',
];

export const operationIdRequired: RuleDefinition = {
  id: 'operation-id-required',
  title: 'Every operation declares an operationId',
  description:
    'operationId is the stable identity of an endpoint across releases. Generated SDKs, ' +
    'client libraries and generated documentation are all keyed by it, so a missing value ' +
    'creates churn that no consumer can track.',
  severity: 'error',
  category: 'operations',
  keywords: ['operationid', 'sdk', 'stability'],
  check({ spec, report }) {
    for (const operation of spec.operations) {
      if (!operation.operationId) {
        report({
          message: `${operation.key} has no operationId`,
          path: operation.pointer,
          operation: operation.key,
          hint: 'Add a camelCase operationId such as "listUsers" or "createUser".',
        });
      }
    }
  },
};

export const operationIdUnique: RuleDefinition = {
  id: 'operation-id-unique',
  title: 'operationId values are unique',
  description:
    'Two operations sharing an operationId produce colliding client methods in every ' +
    'generated SDK, and make it impossible to tell which endpoint a bug report refers to.',
  severity: 'error',
  category: 'operations',
  keywords: ['operationid', 'duplicate', 'collision'],
  check({ spec, report }) {
    const seen = new Map<string, string>();
    for (const operation of spec.operations) {
      const id = operation.operationId;
      if (!id) continue;
      const previous = seen.get(id);
      if (previous) {
        report({
          message: `operationId "${id}" is already used by ${previous}`,
          path: operation.pointer,
          operation: operation.key,
          hint: 'Make every operationId unique across the document.',
        });
      } else {
        seen.set(id, operation.key);
      }
    }
  },
};

export const operationIdNaming: RuleDefinition = {
  id: 'operation-id-naming',
  title: 'operationId uses camelCase and starts with a verb',
  description:
    'A verb-prefixed camelCase operationId reads like a function call and groups nicely in ' +
    'generated clients: getUser, listOrders, cancelSubscription.',
  severity: 'warn',
  category: 'operations',
  keywords: ['naming', 'convention', 'camelcase'],
  check({ spec, report }) {
    for (const operation of spec.operations) {
      const id = operation.operationId;
      if (!id) continue;

      if (!/^[a-z][a-zA-Z0-9]*$/.test(id)) {
        report({
          message: `operationId "${id}" is not camelCase`,
          path: operation.pointer,
          operation: operation.key,
          hint: 'Use camelCase, e.g. "listUsers".',
        });
        continue;
      }

      const prefix = VERB_PREFIXES.find((verb) => id.startsWith(verb));
      if (!prefix) {
        report({
          message: `operationId "${id}" does not start with a known verb`,
          path: operation.pointer,
          operation: operation.key,
          hint: `Start the id with a verb such as ${VERB_PREFIXES.slice(0, 6).join(', ')}.`,
        });
      }
    }
  },
};

export const operationSummaryRequired: RuleDefinition = {
  id: 'operation-summary-required',
  title: 'Every operation has a summary',
  description:
    'The summary is the one-line description that shows up in API explorers and generated ' +
    'documentation. Without it, consumers cannot tell what an endpoint does.',
  severity: 'warn',
  category: 'operations',
  keywords: ['documentation', 'summary'],
  check({ spec, report }) {
    for (const operation of spec.operations) {
      const summary = operation.summary ?? operation.description;
      if (!summary || summary.trim() === '') {
        report({
          message: `${operation.key} has no summary`,
          path: operation.pointer,
          operation: operation.key,
          hint: 'Add a short imperative summary, e.g. "List all orders".',
        });
      }
    }
  },
};

export const operationDescriptionRequired: RuleDefinition = {
  id: 'operation-description-required',
  title: 'Every operation has a description',
  description:
    'Descriptions carry the context that does not fit in a summary: side effects, ' +
    'preconditions, rate limits and the meaning of each field.',
  severity: 'info',
  category: 'operations',
  keywords: ['documentation', 'description'],
  check({ spec, report }) {
    for (const operation of spec.operations) {
      if (!operation.description || operation.description.trim() === '') {
        report({
          message: `${operation.key} has no description`,
          path: operation.pointer,
          operation: operation.key,
          hint: 'Document behaviour, side effects and error conditions.',
        });
      }
    }
  },
};

export const operationTagRequired: RuleDefinition = {
  id: 'operation-tag-required',
  title: 'Every operation is tagged',
  description:
    'Tags are how an API is grouped in documentation and how consumers navigate it. ' +
    'Untagged operations end up in an "untagged" bucket.',
  severity: 'warn',
  category: 'operations',
  keywords: ['tags', 'grouping'],
  check({ spec, report }) {
    for (const operation of spec.operations) {
      if (operation.tags.length === 0) {
        report({
          message: `${operation.key} has no tags`,
          path: operation.pointer,
          operation: operation.key,
          hint: 'Add at least one tag, e.g. "users".',
        });
      }
    }
  },
};

export const operationDeprecatedNoted: RuleDefinition = {
  id: 'operation-deprecated-noted',
  title: 'Deprecated operations explain the replacement',
  description:
    'Marking an operation deprecated without saying what to use instead forces consumers to ' +
    'guess. Provide a replacement or a removal date.',
  severity: 'info',
  category: 'operations',
  keywords: ['deprecation', 'migration'],
  check({ spec, report }) {
    for (const operation of spec.operations) {
      if (!operation.deprecated) continue;
      const raw = operation.raw;
      const hasReplacement =
        typeof raw['x-replacement'] === 'string' ||
        typeof raw['x-deprecated-reason'] === 'string' ||
        typeof raw['x-sunset-date'] === 'string';
      const description = (operation.description ?? '').toLowerCase();
      if (!hasReplacement && !description.includes('deprecat')) {
        report({
          message: `${operation.key} is deprecated but no replacement is documented`,
          path: operation.pointer,
          operation: operation.key,
          hint: 'Add "x-replacement" or describe the replacement in the description.',
        });
      }
    }
  },
};

export const operationMethodSemantics: RuleDefinition = {
  id: 'operation-method-semantics',
  title: 'HTTP methods follow their semantics',
  description:
    'GET and HEAD must be safe and side-effect free, DELETE must be idempotent, and PUT ' +
    'must fully replace the resource. Mixing these up breaks caches, retries and CDNs.',
  severity: 'warn',
  category: 'operations',
  keywords: ['http', 'rest', 'semantics', 'idempotency'],
  check({ spec, report }) {
    for (const operation of spec.operations) {
      const body = operation.requestBody;
      if (body && (operation.method === 'get' || operation.method === 'head') && hasContent(body)) {
        report({
          message: `${operation.key} defines a request body; ${operation.method.toUpperCase()} must be safe`,
          path: operation.pointer,
          operation: operation.key,
          hint: 'Move the parameters to the query string or use POST.',
        });
      }

      if (body && operation.method === 'delete' && body.required) {
        report({
          message: `${operation.key} requires a request body; DELETE should only use path or query parameters`,
          path: operation.pointer,
          operation: operation.key,
          hint: 'Move the identifier into the path.',
        });
      }

      if (operation.method === 'put' && body && body.required === false) {
        report({
          message: `${operation.key} uses PUT but does not require a body`,
          path: operation.pointer,
          operation: operation.key,
          hint: 'PUT replaces the resource and therefore needs a body.',
        });
      }
    }
  },
};


function hasContent(body: { required?: boolean; content: Map<string, { schema?: unknown }> }): boolean {
  if (body.required === true) return true;
  for (const mediaType of body.content.values()) {
    const schema = mediaType.schema;
    if (!schema || typeof schema !== 'object') continue;
    const properties = (schema as { properties?: Record<string, unknown> }).properties;
    if (properties && Object.keys(properties).length > 0) return true;
  }
  return false;
}

export const operationRules = [
  operationIdRequired,
  operationIdUnique,
  operationIdNaming,
  operationSummaryRequired,
  operationDescriptionRequired,
  operationTagRequired,
  operationDeprecatedNoted,
  operationMethodSemantics,
];
