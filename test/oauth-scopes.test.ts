import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadSpecFromText } from '../src/spec/loader.ts';
import { lint } from '../src/lint/engine.ts';

function scopesFindings(schemes: Record<string, unknown>, security: Array<Record<string, string[]>>) {
  const spec = loadSpecFromText(
    JSON.stringify({
      openapi: '3.0.3',
      info: { title: 'Scopes', version: '1.0.0' },
      paths: {
        '/widgets': {
          get: {
            operationId: 'listWidgets',
            security,
            responses: { '200': { description: 'ok' } },
          },
        },
      },
      components: { securitySchemes: schemes },
    }),
  );
  return lint(spec).findings.filter((finding) => finding.ruleId === 'security-scopes-declared');
}

const OAUTH = {
  type: 'oauth2',
  flows: {
    clientCredentials: {
      tokenUrl: 'https://example.com/token',
      scopes: { read: 'Read widgets', write: 'Write widgets' },
    },
  },
};

test('scopes declared in a flow are not reported', () => {
  const findings = scopesFindings({ oauth: OAUTH }, [{ oauth: ['read', 'write'] }]);
  assert.deepEqual(findings, []);
});

test('a scope that no flow declares is still reported', () => {
  const findings = scopesFindings({ oauth: OAUTH }, [{ oauth: ['read', 'admin'] }]);
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /"admin"/);
});

test('a scope declared by any flow counts', () => {
  const findings = scopesFindings(
    {
      oauth: {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: 'https://example.com/authorize',
            tokenUrl: 'https://example.com/token',
            scopes: { profile: 'Read the profile' },
          },
          clientCredentials: {
            tokenUrl: 'https://example.com/token',
            scopes: { read: 'Read widgets' },
          },
        },
      },
    },
    [{ oauth: ['profile', 'read'] }],
  );
  assert.deepEqual(findings, []);
});

test('an OpenID Connect scheme does not declare scopes in the document', () => {
  const findings = scopesFindings(
    { oidc: { type: 'openIdConnect', openIdConnectUrl: 'https://example.com/.well-known/openid-configuration' } },
    [{ oidc: ['openid', 'email'] }],
  );
  assert.deepEqual(findings, []);
});

test('a security scheme referenced through $ref is resolved', () => {
  const spec = loadSpecFromText(
    JSON.stringify({
      openapi: '3.0.3',
      info: { title: 'Refs', version: '1.0.0' },
      paths: {
        '/widgets': {
          get: {
            operationId: 'listWidgets',
            security: [{ oauth: ['read'] }],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
      components: {
        securitySchemes: { oauth: { $ref: '#/components/x-oauth' } },
        'x-oauth': OAUTH,
      },
    }),
  );
  const findings = lint(spec).findings.filter(
    (finding) =>
      finding.ruleId === 'security-scopes-declared' || finding.ruleId === 'security-scheme-undefined',
  );
  assert.deepEqual(findings, []);
});
