import type { RuleDefinition } from '../types.ts';
import { securitySchemes } from '../../spec/model.ts';

export const parameterRequiredPath: RuleDefinition = {
  id: 'parameter-required-path',
  title: 'Path parameters are required',
  description:
    'A path parameter is part of the URL and can never be optional. Declaring one as ' +
    'optional produces a contract that cannot be honoured.',
  severity: 'error',
  category: 'parameters',
  keywords: ['parameter', 'required', 'path'],
  check({ spec, report }) {
    for (const operation of spec.operations) {
      for (const parameter of operation.parameters) {
        if (parameter.in !== 'path') continue;
        if (!parameter.required) {
          report({
            message: `Path parameter "${parameter.name}" of ${operation.key} is not required`,
            path: parameter.pointer,
            operation: operation.key,
            hint: 'Set "required: true" on path parameters.',
          });
        }
      }
    }
  },
};

export const parameterDuplicate: RuleDefinition = {
  id: 'parameter-duplicate',
  title: 'Parameters are not declared twice',
  description:
    'The same name and location declared twice is ambiguous: the first or the second ' +
    'definition wins depending on the tooling.',
  severity: 'warn',
  category: 'parameters',
  keywords: ['parameter', 'duplicate'],
  check({ spec, report }) {
    for (const operation of spec.operations) {
      const seen = new Set<string>();
      for (const parameter of operation.parameters) {
        const key = `${parameter.in}:${parameter.name}`;
        if (seen.has(key)) {
          report({
            message: `Parameter "${parameter.name}" (${parameter.in}) is declared more than once in ${operation.key}`,
            path: parameter.pointer,
            operation: operation.key,
            hint: 'Remove the duplicate declaration.',
          });
        }
        seen.add(key);
      }
    }
  },
};

export const parameterDescription: RuleDefinition = {
  id: 'parameter-description',
  title: 'Parameters are documented',
  description:
    'Undocumented parameters are the most common source of integration bugs: the consumer ' +
    'cannot know the accepted format, the default value or the allowed range.',
  severity: 'info',
  category: 'parameters',
  keywords: ['parameter', 'documentation'],
  check({ spec, report }) {
    for (const operation of spec.operations) {
      for (const parameter of operation.parameters) {
        if (!parameter.description || parameter.description.trim() === '') {
          report({
            message: `Parameter "${parameter.name}" (${parameter.in}) of ${operation.key} has no description`,
            path: parameter.pointer,
            operation: operation.key,
            hint: 'Describe the accepted values and the default.',
          });
        }
      }
    }
  },
};

export const parameterNoQueryApiKey: RuleDefinition = {
  id: 'security-in-query',
  title: 'API keys are not passed in the query string',
  description:
    'Credentials in a query string leak into access logs, browser history and referrer ' +
    'headers. Use a header instead.',
  severity: 'warn',
  category: 'parameters',
  keywords: ['security', 'apikey', 'query'],
  check({ spec, report }) {
    const schemes = securitySchemes(spec);
    for (const [name, scheme] of Object.entries(schemes)) {
      if (scheme['type'] !== 'apiKey') continue;
      if (scheme['in'] !== 'query') continue;
      report({
        message: `Security scheme "${name}" passes an API key in the query string`,
        path: `/components/securitySchemes/${name}`,
        hint: 'Move the key to a header, e.g. "X-API-Key" or "Authorization".',
      });
    }
  },
};

export const parameterNameRequired: RuleDefinition = {
  id: 'parameter-name-required',
  title: 'Parameters declare a name',
  description:
    'The OpenAPI specification requires every parameter to carry a "name". A nameless ' +
    'parameter used to be dropped from the model entirely, which let it escape every ' +
    'other parameter rule.',
  severity: 'error',
  category: 'parameters',
  keywords: ['parameter', 'name', 'required'],
  check({ spec, report }) {
    for (const operation of spec.operations) {
      for (const parameter of operation.parameters) {
        if (parameter.name !== '') continue;
        const index = parameter.pointer.split('/').pop() ?? '?';
        report({
          message: `Parameter #${index} of ${operation.key} has no "name"`,
          path: parameter.pointer,
          operation: operation.key,
          hint: 'Add a "name" to the parameter, or remove it.',
        });
      }
    }
  },
};

export const parameterRules = [
  parameterRequiredPath,
  parameterNameRequired,
  parameterDuplicate,
  parameterDescription,
  parameterNoQueryApiKey,
];
