import type { RuleDefinition } from '../types.ts';

export const openapiVersionSupported: RuleDefinition = {
  id: 'openapi-version-supported',
  title: 'The document declares a supported OpenAPI version',
  description:
    'apicovenant understands OpenAPI 3.0.x and 3.1.x. Other versions are rejected so that ' +
    'rules never silently misread the contract.',
  severity: 'error',
  category: 'document',
  keywords: ['openapi', 'version', 'swagger'],
  check({ spec, report }) {
    const version = spec.version;
    if (version === '') {
      report({
        message: 'The document does not declare an "openapi" version',
        path: '/openapi',
        hint: 'Add e.g. "openapi: 3.1.0".',
      });
      return;
    }
    if (!/^3\.(0|1)\./.test(version)) {
      report({
        message: `OpenAPI version "${version}" is not supported`,
        path: '/openapi',
        hint: 'Use 3.0.x or 3.1.x.',
      });
    }
  },
};

export const infoContactRequired: RuleDefinition = {
  id: 'info-contact-required',
  title: 'The API declares contact information',
  description:
    'Consumers need to know who to contact when the API breaks or the documentation is ' +
    'unclear. A contact block is the only place to put that.',
  severity: 'info',
  category: 'document',
  keywords: ['info', 'contact', 'support'],
  check({ spec, report }) {
    const contact = spec.info.contact;
    const hasContact = Boolean(contact && (contact.email || contact.url || contact.name));
    if (!hasContact) {
      report({
        message: 'The API does not declare contact information',
        path: '/info/contact',
        hint: 'Add an "info.contact" block with a name, URL or email address.',
      });
    }
  },
};

export const infoLicenseRequired: RuleDefinition = {
  id: 'info-license-required',
  title: 'The API declares its license',
  description:
    'The license states the terms under which the API may be used, which matters as soon as ' +
    'the document is shared outside the organisation.',
  severity: 'info',
  category: 'document',
  keywords: ['info', 'license', 'legal'],
  check({ spec, report }) {
    if (!spec.info.license?.name) {
      report({
        message: 'The API does not declare a license',
        path: '/info/license',
        hint: 'Add an "info.license" block, e.g. "Apache-2.0".',
      });
    }
  },
};

export const serverHttps: RuleDefinition = {
  id: 'server-https',
  title: 'Servers use HTTPS',
  description:
    'Plain HTTP exposes credentials and payloads to anyone on the network. Local ' +
    'development hosts are exempt because they never leave the machine.',
  severity: 'warn',
  category: 'document',
  keywords: ['server', 'https', 'tls', 'security'],
  check({ spec, report }) {
    const servers = spec.servers;
    servers.forEach((server, index) => {
      if (!server.url.startsWith('http://')) return;
      // Match the hostname exactly: a substring test would exempt
      // "http://localhost.example.com" or "http://api.127.0.0.1.attacker.net".
      if (isLocalHostname(server.url)) return;
      report({
        message: `Server "${server.url}" uses plain HTTP`,
        path: `/servers/${index}/url`,
        hint: 'Use "https://" for every non-local server.',
      });
    });
  },
};

function isLocalHostname(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    // An unparseable host is not known to be local.
    return false;
  }
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]' ||
    hostname === '::1' ||
    hostname.endsWith('.local')
  );
}

export const tagDeclared: RuleDefinition = {
  id: 'tag-declared',
  title: 'Tags are declared globally',
  description:
    'Tags used by operations but missing from the top level "tags" list show up without a ' +
    'description and are ordered unpredictably in the documentation.',
  severity: 'warn',
  category: 'document',
  keywords: ['tags', 'documentation'],
  check({ spec, report }) {
    const declared = new Set(spec.tags.map((tag) => tag.name));
    if (declared.size === 0) return;

    for (const operation of spec.operations) {
      for (const tag of operation.tags) {
        if (declared.has(tag)) continue;
        report({
          message: `Tag "${tag}" used by ${operation.key} is not declared in the global tags list`,
          path: operation.pointer,
          operation: operation.key,
          hint: `Add a "tags" entry with name "${tag}" and a description.`,
        });
      }
    }
  },
};

export const documentRules = [
  openapiVersionSupported,
  infoContactRequired,
  infoLicenseRequired,
  serverHttps,
  tagDeclared,
];
