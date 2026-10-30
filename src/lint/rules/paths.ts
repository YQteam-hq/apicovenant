import type { RuleDefinition } from '../types.ts';

const VERB_SEGMENTS = new Set([
  'get',
  'fetch',
  'create',
  'make',
  'update',
  'modify',
  'edit',
  'change',
  'delete',
  'remove',
  'destroy',
  'drop',
  'list',
  'all',
  'retrieve',
  'search',
  'find',
  'query',
  'add',
  'set',
  'post',
  'put',
  'patch',
  'submit',
  'send',
  'upload',
  'download',
  'export',
  'import',
]);

const SINGULAR_EXCEPTIONS = new Set([
  'me',
  'self',
  'health',
  'healthz',
  'livez',
  'readyz',
  'status',
  'version',
  'info',
  'settings',
  'config',
  'search',
  'login',
  'logout',
  'token',
  'session',
  'profile',
  'metadata',
  'schema',
  'root',
]);

// Final path segments that name a filtered view of a collection rather than a
// collection of their own ("/users/active", "/orders/recent"). The plural
// check would otherwise flag every one of them.
const VIEW_SEGMENTS = new Set([
  'active',
  'archived',
  'recent',
  'current',
  'latest',
  'popular',
  'trending',
  'starred',
  'pinned',
  'mine',
  'all',
  'trash',
  'history',
  'summary',
  'stats',
]);

export const pathKebabCase: RuleDefinition = {
  id: 'path-kebab-case',
  title: 'Path segments are kebab-case',
  description:
    'Lowercase, hyphen separated paths are the most widely supported convention. Underscores ' +
    'and camelCase in URLs are inconsistently handled by proxies, CDNs and older clients.',
  severity: 'warn',
  category: 'paths',
  keywords: ['naming', 'url', 'kebab-case'],
  check({ spec, report }) {
    for (const pathItem of spec.paths) {
      for (const segment of pathItem.path.split('/')) {
        if (segment === '' || segment.startsWith('{')) continue;
        for (const part of segment.split('.')) {
          if (part === '' || part.startsWith('{')) continue;
          if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(part)) {
            report({
              message: `Path segment "${part}" in ${pathItem.path} is not kebab-case`,
              path: pathItem.pointer,
              operation: `* ${pathItem.path}`,
              hint: 'Use lowercase words separated by hyphens, e.g. "user-profiles".',
            });
            break;
          }
        }
      }
    }
  },
};

export const pathNoTrailingSlash: RuleDefinition = {
  id: 'path-no-trailing-slash',
  title: 'Paths do not end with a slash',
  description:
    'A trailing slash creates a second, distinct URL for the same resource. Which one a ' +
    'client hits depends on the framework, so caching and routing break silently.',
  severity: 'error',
  category: 'paths',
  keywords: ['url', 'trailing slash'],
  check({ spec, report }) {
    for (const pathItem of spec.paths) {
      if (pathItem.path.length > 1 && pathItem.path.endsWith('/')) {
        report({
          message: `Path "${pathItem.path}" ends with a trailing slash`,
          path: pathItem.pointer,
          operation: `* ${pathItem.path}`,
          hint: 'Remove the trailing slash.',
        });
      }
    }
  },
};

export const pathNoVerbs: RuleDefinition = {
  id: 'path-no-verbs',
  title: 'Paths do not contain verbs',
  description:
    'The HTTP method already expresses the action. Embedding verbs in the path ("/createUser") ' +
    'makes the URL space grow combinatorially and forces clients to guess which spelling is right.',
  severity: 'warn',
  category: 'paths',
  keywords: ['url', 'rest', 'verbs'],
  check({ spec, report }) {
    for (const pathItem of spec.paths) {
      for (const segment of pathItem.path.split('/')) {
        if (segment === '' || segment.startsWith('{')) continue;

        for (const word of segment.split(/[^A-Za-z0-9]+/)) {
          if (word === '') continue;
          if (!VERB_SEGMENTS.has(word.toLowerCase())) continue;
          report({
            message: `Path "${pathItem.path}" contains the verb "${word}"`,
            path: pathItem.pointer,
            operation: `* ${pathItem.path}`,
            hint: 'Express the action with the HTTP method and keep the path as a noun, e.g. "/users".',
          });
        }
      }
    }
  },
};

export const pathCollectionPlural: RuleDefinition = {
  id: 'path-collection-plural',
  title: 'Collection paths are plural',
  description:
    'Plural collection names ("/users") keep the URL space predictable: "/users" lists and ' +
    '"/users/{id}" addresses one item. Singular collections confuse generated clients. ' +
    'Filtered views ("/users/active") and an allow list of intentionally singular names ' +
    'are exempt.',
  severity: 'info',
  category: 'paths',
  keywords: ['url', 'plural', 'naming'],
  check({ spec, report }) {
    for (const pathItem of spec.paths) {
      const segments = pathItem.path.split('/').filter(Boolean);
      const last = segments[segments.length - 1];
      if (!last || last.startsWith('{')) continue;
      if (last.endsWith('s')) continue;
      if (SINGULAR_EXCEPTIONS.has(last.toLowerCase())) continue;
      if (VIEW_SEGMENTS.has(last.toLowerCase())) continue;
      report({
        message: `Collection path "${pathItem.path}" is not plural`,
        path: pathItem.pointer,
        operation: `* ${pathItem.path}`,
        hint: `Use "/${last}s" or pick a name that reads as a collection.`,
      });
    }
  },
};

export const pathParameterDefined: RuleDefinition = {
  id: 'path-parameter-defined',
  title: 'Path templates match their parameters',
  description:
    'Every {placeholder} in a path must be declared as a required path parameter, and every ' +
    'declared path parameter must appear in the template. A mismatch produces a URL that ' +
    'cannot be built by generated clients.',
  severity: 'error',
  category: 'paths',
  keywords: ['path', 'parameter', 'template'],
  check({ spec, report }) {

    for (const operation of spec.operations) {
      const declared = new Set(
        operation.parameters.filter((parameter) => parameter.in === 'path').map((parameter) => parameter.name),
      );
      const used = new Set<string>();
      const template = operation.path.match(/\{([^}]+)\}/g) ?? [];
      for (const token of template) used.add(token.slice(1, -1));

      for (const name of used) {
        if (!declared.has(name)) {
          report({
            message: `Path "${operation.path}" uses {"${name}"} but no matching path parameter is declared`,
            path: operation.pointer,
            operation: operation.key,
            hint: `Add a path parameter named "${name}" to the operation or the path item.`,
          });
        }
      }

      for (const name of declared) {
        if (!used.has(name)) {
          report({
            message: `Path parameter "${name}" is declared but never used in "${operation.path}"`,
            path: operation.pointer,
            operation: operation.key,
            hint: 'Remove the parameter or use it in the path template.',
          });
        }
      }
    }
  },
};

export const pathRules = [
  pathKebabCase,
  pathNoTrailingSlash,
  pathNoVerbs,
  pathCollectionPlural,
  pathParameterDefined,
];
