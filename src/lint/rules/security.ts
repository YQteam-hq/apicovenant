import type { RuleDefinition } from '../types.ts';
import { securitySchemes } from '../../spec/model.ts';
import { isPlainObject } from '../../util/text.ts';

const PUBLIC_PATH_HINTS = ['/health', '/healthz', '/livez', '/readyz', '/status', '/version', '/login', '/oauth', '/register', '/signup', '/public'];

export const securityRequirementDefined: RuleDefinition = {
  id: 'security-requirement-defined',
  title: 'Operations declare their security',
  description:
    'An operation without a security requirement is publicly reachable unless the whole ' +
    'document declares a global default. Being explicit keeps the contract honest.',
  severity: 'warn',
  category: 'security',
  keywords: ['security', 'auth', 'authentication'],
  check({ spec, report }) {
    const hasGlobalSecurity = spec.globalSecurity.length > 0;

    for (const operation of spec.operations) {
      if (operation.security.length > 0) continue;

      const explicitlyPublic = operation.raw['x-public'] === true;
      // Match whole path segments: a substring test would exempt
      // "/users/login-history" because it contains "/login".
      const segments = operation.path.toLowerCase().split('/').filter(Boolean);
      const looksPublic = PUBLIC_PATH_HINTS.some((hint) => segments.includes(hint.slice(1)));

      if (explicitlyPublic || looksPublic) continue;

      if (hasGlobalSecurity) {
        report({
          message: `${operation.key} overrides the global security requirement with an empty list`,
          path: `${operation.pointer}/security`,
          operation: operation.key,
          hint: 'Confirm the endpoint is intentionally public, or mark it with "x-public: true".',
        });
      } else {
        report({
          message: `${operation.key} does not declare a security requirement`,
          path: `${operation.pointer}/security`,
          operation: operation.key,
          hint: 'Add a "security" block, or mark the endpoint with "x-public: true".',
        });
      }
    }
  },
};

export const securitySchemeUndefined: RuleDefinition = {
  id: 'security-scheme-undefined',
  title: 'Security requirements reference declared schemes',
  description:
    'A security requirement that names a scheme which does not exist cannot be satisfied. ' +
    'Clients either ignore it or fail to build.',
  severity: 'error',
  category: 'security',
  keywords: ['security', 'scheme', 'reference'],
  check({ spec, report }) {
    const schemes = securitySchemes(spec);

    for (const operation of spec.operations) {
      operation.security.forEach((requirement, index) => {
        for (const name of Object.keys(requirement)) {
          if (name === '') continue;
          if (!(name in schemes)) {
            report({
              message: `${operation.key} requires security scheme "${name}" which is not declared`,
              path: `${operation.pointer}/security/${index}/${name}`,
              operation: operation.key,
              hint: `Add it to "components.securitySchemes" or use one of: ${Object.keys(schemes).join(', ') || '(none)'}.`,
            });
          }
        }
      });
    }
  },
};

export const securityScopesDeclared: RuleDefinition = {
  id: 'security-scopes-declared',
  title: 'OAuth scopes are declared',
  description:
    'Requesting a scope that the authorization server does not define leads to a 403 at ' +
    'runtime. Declaring scopes in the scheme keeps the contract and the server in sync.',
  severity: 'warn',
  category: 'security',
  keywords: ['security', 'oauth', 'scopes'],
  check({ spec, report }) {
    const schemes = securitySchemes(spec);

    for (const operation of spec.operations) {
      operation.security.forEach((requirement, index) => {
        for (const [name, scopes] of Object.entries(requirement)) {
          const scheme = schemes[name];
          if (!scheme) continue;
          const type = scheme['type'];
          if (type !== 'oauth2' && type !== 'openIdConnect') continue;

          const declared = isPlainObject(scheme['scopes']) ? Object.keys(scheme['scopes']) : [];
          for (const scope of scopes) {
            if (!declared.includes(scope)) {
              report({
                message: `${operation.key} requests OAuth scope "${scope}" which "${name}" does not declare`,
                path: `${operation.pointer}/security/${index}/${name}`,
                operation: operation.key,
                hint: `Declared scopes: ${declared.join(', ') || '(none)'}.`,
              });
            }
          }
        }
      });
    }
  },
};

export const securityRules = [
  securityRequirementDefined,
  securitySchemeUndefined,
  securityScopesDeclared,
];
