import type { RuleDefinition } from '../types.ts';
import { isPlainObject } from '../../util/text.ts';
import { isRefNode, refName } from '../../spec/ref.ts';

const VALID_STATUS = /^(?:[1-5]\d{2}|default)$/;
const BODYLESS_STATUS = new Set(['204', '205', '304', '101']);

// 1xx (informational) and 3xx (redirection) responses carry no body by
// definition — only 304 is special enough to list explicitly.
const BODYLESS_RANGE = /^[13]\d\d$/;

function isErrorStatus(status: string): boolean {
  return status.startsWith('4') || status.startsWith('5');
}

export const responseSuccessRequired: RuleDefinition = {
  id: 'response-success-required',
  title: 'Every operation documents a success response',
  description:
    'An operation without a 2xx response gives consumers no contract for the happy path. ' +
    'Most generators will simply omit the return type.',
  severity: 'error',
  category: 'responses',
  keywords: ['response', '2xx', 'success'],
  check({ spec, report }) {
    for (const operation of spec.operations) {
      const hasSuccess = [...operation.responses.keys()].some((status) => /^2\d\d$/.test(status));
      if (!hasSuccess) {
        report({
          message: `${operation.key} declares no 2xx response`,
          path: `${operation.pointer}/responses`,
          operation: operation.key,
          hint: 'Add the response the endpoint returns on success, e.g. "200".',
        });
      }
    }
  },
};

export const responseDescriptionRequired: RuleDefinition = {
  id: 'response-description-required',
  title: 'Every response has a description',
  description:
    'The description is required by the OpenAPI specification and is what consumers read ' +
    'to understand when a status code is returned.',
  severity: 'error',
  category: 'responses',
  keywords: ['response', 'documentation'],
  check({ spec, report }) {
    for (const operation of spec.operations) {
      for (const response of operation.responses.values()) {
        if (!response.description || response.description.trim() === '') {
          report({
            message: `Response "${response.status}" of ${operation.key} has no description`,
            path: response.pointer,
            operation: operation.key,
            hint: 'Describe when this status code is returned.',
          });
        }
      }
    }
  },
};

export const responseStatusValid: RuleDefinition = {
  id: 'response-status-valid',
  title: 'Response status codes are valid',
  description:
    'Only real HTTP status codes (or the "default" key) are allowed. A typo such as "20O" ' +
    'silently produces an unreachable branch.',
  severity: 'error',
  category: 'responses',
  keywords: ['response', 'status', 'http'],
  check({ spec, report }) {
    for (const operation of spec.operations) {
      for (const response of operation.responses.values()) {
        if (!VALID_STATUS.test(response.status)) {
          report({
            message: `"${response.status}" is not a valid HTTP status code in ${operation.key}`,
            path: response.pointer,
            operation: operation.key,
            hint: 'Use a three digit status code or "default".',
          });
        }
      }
    }
  },
};

export const responseSchemaRequired: RuleDefinition = {
  id: 'response-schema-required',
  title: 'Responses declare a schema',
  description:
    'A response that only carries an example cannot be validated, cannot be turned into a ' +
    'typed client and cannot be checked against the contract.',
  severity: 'error',
  category: 'responses',
  keywords: ['response', 'schema', 'contract'],
  check({ spec, report }) {
    for (const operation of spec.operations) {
      for (const response of operation.responses.values()) {
        if (BODYLESS_STATUS.has(response.status)) continue;
        if (BODYLESS_RANGE.test(response.status)) continue;

        if (response.content.size === 0) {
          report({
            message: `Response "${response.status}" of ${operation.key} declares no content`,
            path: response.pointer,
            operation: operation.key,
            hint: 'Add a "content" block with a media type and a schema.',
          });
          continue;
        }

        for (const mediaType of response.content.values()) {
          if (!mediaType.schema) {
            report({
              message: `Response "${response.status}" of ${operation.key} has no schema for "${mediaType.contentType}"`,
              path: `${response.pointer}/content/${mediaType.contentType}`,
              operation: operation.key,
              hint: 'Describe the payload with a schema instead of an example only.',
            });
          }
        }
      }
    }
  },
};

export const responseContentType: RuleDefinition = {
  id: 'response-content-type',
  title: 'Responses use a specific content type',
  description:
    '"application/json" is understood by every client. Wildcards and generic types such as ' +
    '"text/plain" force consumers to guess how to parse the payload.',
  severity: 'warn',
  category: 'responses',
  keywords: ['response', 'content-type', 'media type'],
  check({ spec, report }) {
    for (const operation of spec.operations) {
      for (const response of operation.responses.values()) {
        for (const mediaType of response.content.values()) {
          const contentType = mediaType.contentType.toLowerCase();
          if (contentType.includes('*/*')) {
            report({
              message: `Response "${response.status}" of ${operation.key} uses the wildcard content type "${mediaType.contentType}"`,
              path: `${response.pointer}/content/${mediaType.contentType}`,
              operation: operation.key,
              hint: 'Declare the concrete media type you return.',
            });
          } else if (!contentType.includes('/')) {
            report({
              message: `Response "${response.status}" of ${operation.key} uses the invalid content type "${mediaType.contentType}"`,
              path: `${response.pointer}/content/${mediaType.contentType}`,
              operation: operation.key,
              hint: 'Use a media type such as "application/json".',
            });
          }
        }
      }
    }
  },
};

export const responseErrorEnvelope: RuleDefinition = {
  id: 'response-error-envelope',
  title: 'Error responses share one envelope',
  description:
    'When every failure uses the same error schema, clients can implement error handling ' +
    'once. Mixed error shapes are the single most common cause of brittle integrations.',
  severity: 'warn',
  category: 'responses',
  keywords: ['error', 'envelope', 'consistency'],
  check({ spec, report }) {
    const usage = new Map<string, Array<{ path: string; operation: string }>>();

    for (const operation of spec.operations) {
      for (const response of operation.responses.values()) {
        if (!isErrorStatus(response.status)) continue;
        const mediaType = response.content.get('application/json') ?? response.content.values().next().value;
        if (!mediaType) continue;

        const schema = mediaType.schema;
        if (!isRefNode(schema)) {
          usage.set('<inline>', [
            ...(usage.get('<inline>') ?? []),
            { path: `${response.pointer}/content/${mediaType.contentType}/schema`, operation: operation.key },
          ]);
          continue;
        }
        const name = refName(schema.$ref);
        usage.set(name, [...(usage.get(name) ?? []), { path: `${response.pointer}/content/${mediaType.contentType}/schema`, operation: operation.key }]);
      }
    }

    if (usage.size === 0) return;

    const sorted = [...usage.entries()].sort((a, b) => b[1].length - a[1].length);
    const dominant = sorted[0];

    for (const [name, entries] of sorted) {
      if (sorted.length === 1 && name !== '<inline>') continue;

      for (const entry of entries) {
        if (name === '<inline>') {
          report({
            message: `Error response of ${entry.operation} defines an inline schema instead of a shared error component`,
            path: entry.path,
            operation: entry.operation,
            hint: 'Reference a shared error schema such as "#/components/schemas/Error".',
          });
          continue;
        }
        if (name === dominant?.[0]) continue;
        report({
          message: `Error response of ${entry.operation} uses "${name}" while the API mostly uses "${dominant?.[0]}"`,
          path: entry.path,
          operation: entry.operation,
          hint: `Use the same error schema as the rest of the API ("${dominant?.[0]}").`,
        });
      }
    }
  },
};

export const responseNoDefaultOnly: RuleDefinition = {
  id: 'response-no-default-only',
  title: 'Operations document explicit status codes',
  description:
    'Relying on the catch-all "default" response hides which status codes the endpoint can ' +
    'actually return and blocks accurate client generation.',
  severity: 'info',
  category: 'responses',
  keywords: ['response', 'default'],
  check({ spec, report }) {
    for (const operation of spec.operations) {
      const keys = [...operation.responses.keys()];
      if (keys.length === 1 && keys[0] === 'default') {
        report({
          message: `${operation.key} only documents the "default" response`,
          path: `${operation.pointer}/responses`,
          operation: operation.key,
          hint: 'Document the concrete success status code as well.',
        });
      }
    }
  },
};

export const responseUsesExample: RuleDefinition = {
  id: 'response-example-recommended',
  title: 'Responses provide an example',
  description:
    'An example makes the contract concrete and lets the mock server answer with something ' +
    'realistic without generating one on the fly.',
  severity: 'info',
  category: 'responses',
  keywords: ['response', 'example', 'mock'],
  check({ spec, report }) {
    for (const operation of spec.operations) {
      for (const response of operation.responses.values()) {
        for (const mediaType of response.content.values()) {
          const hasExample = mediaType.example !== undefined || (mediaType.examples && Object.keys(mediaType.examples).length > 0);
          if (hasExample) continue;
          const schema = mediaType.schema;
          const schemaHasExample = isPlainObject(schema) && (schema['example'] !== undefined || schema['examples'] !== undefined);
          if (!schemaHasExample) {
            report({
              message: `Response "${response.status}" of ${operation.key} has no example`,
              path: `${response.pointer}/content/${mediaType.contentType}`,
              operation: operation.key,
              hint: 'Add an "example" so the contract is unambiguous.',
            });
          }
        }
      }
    }
  },
};

export const responseRules = [
  responseSuccessRequired,
  responseDescriptionRequired,
  responseStatusValid,
  responseSchemaRequired,
  responseContentType,
  responseErrorEnvelope,
  responseNoDefaultOnly,
  responseUsesExample,
];
