export type ChangeSeverity = 'breaking' | 'risky' | 'compatible' | 'info';

export interface ChangeDefinition {
  severity: ChangeSeverity;
  title: string;
  hint: string;
}

/**
 * The change taxonomy of `apicovenant breaking`. The ids are stable: they are
 * the values accepted by --ignore-change and recorded in JSON/SARIF reports.
 */
export const CHANGE_DEFINITIONS: Record<string, ChangeDefinition> = {
  'operation-removed': {
    severity: 'breaking',
    title: 'Operation removed',
    hint: 'Keep the operation, or version the endpoint and announce the removal.',
  },
  'operation-added': {
    severity: 'compatible',
    title: 'Operation added',
    hint: 'Old clients are unaffected by a new operation.',
  },
  'operation-id-changed': {
    severity: 'risky',
    title: 'Operation id changed',
    hint: 'Generated clients derive method names from operationId; keep it stable.',
  },
  'parameter-required-added': {
    severity: 'breaking',
    title: 'Required parameter added or made required',
    hint: 'Old clients do not send the parameter. Accept it as optional first.',
  },
  'parameter-required-removed': {
    severity: 'breaking',
    title: 'Required parameter removed',
    hint: 'The server no longer accepts a parameter old clients still send.',
  },
  'parameter-optional-removed': {
    severity: 'risky',
    title: 'Optional parameter removed',
    hint: 'Clients that rely on it change behaviour or receive an error.',
  },
  'parameter-optional-added': {
    severity: 'compatible',
    title: 'Optional parameter added',
    hint: 'Optional parameters are backwards compatible.',
  },
  'parameter-type-changed': {
    severity: 'breaking',
    title: 'Parameter type changed',
    hint: 'Keep the old type, or add a new parameter under a new name.',
  },
  'parameter-location-changed': {
    severity: 'breaking',
    title: 'Parameter location changed',
    hint: 'Keep the parameter where clients already send it.',
  },
  'request-body-required-added': {
    severity: 'breaking',
    title: 'Request body became required',
    hint: 'Old clients send no body; keep the body optional.',
  },
  'request-body-removed': {
    severity: 'risky',
    title: 'Request body removed',
    hint: 'Old clients may still send one and be rejected.',
  },
  'request-body-added': {
    severity: 'compatible',
    title: 'Optional request body added',
    hint: 'A new optional body is backwards compatible.',
  },
  'request-media-type-removed': {
    severity: 'breaking',
    title: 'Request media type removed',
    hint: 'Keep accepting the old Content-Type during a deprecation window.',
  },
  'request-media-type-added': {
    severity: 'compatible',
    title: 'Request media type added',
    hint: 'New accepted media types are backwards compatible.',
  },
  'request-property-required-added': {
    severity: 'breaking',
    title: 'Request property became required',
    hint: 'Old clients omit the property; keep it optional.',
  },
  'request-property-removed': {
    severity: 'risky',
    title: 'Request property removed',
    hint: 'Old clients may still send the field and be rejected.',
  },
  'request-property-added': {
    severity: 'compatible',
    title: 'Request property added',
    hint: 'New optional request fields are backwards compatible.',
  },
  'request-property-type-changed': {
    severity: 'breaking',
    title: 'Request property type changed',
    hint: 'Old clients send the previous type; accept both or add a new field.',
  },
  'response-status-removed': {
    severity: 'breaking',
    title: 'Response status removed',
    hint: 'Clients branch on documented status codes; keep the branch.',
  },
  'response-status-added': {
    severity: 'compatible',
    title: 'Response status added',
    hint: 'New status codes are usually backwards compatible.',
  },
  'response-media-type-removed': {
    severity: 'breaking',
    title: 'Response media type removed',
    hint: 'Keep returning the old Content-Type, or negotiate explicitly.',
  },
  'response-media-type-added': {
    severity: 'compatible',
    title: 'Response media type added',
    hint: 'New response media types are backwards compatible.',
  },
  'response-property-removed': {
    severity: 'breaking',
    title: 'Response property removed',
    hint: 'Clients read the field; keep it or version the endpoint.',
  },
  'response-property-added': {
    severity: 'compatible',
    title: 'Response property added',
    hint: 'New response fields are backwards compatible.',
  },
  'response-property-required-added': {
    severity: 'risky',
    title: 'Response property became required',
    hint: 'Strict clients may reject a payload that suddenly omits the field.',
  },
  'response-property-type-changed': {
    severity: 'breaking',
    title: 'Response property type changed',
    hint: 'Old clients parse the previous type; keep it or version the endpoint.',
  },
  'response-property-type-widened': {
    severity: 'compatible',
    title: 'Response property type widened',
    hint: 'A union that still includes the old type is usually safe.',
  },
  'response-header-removed': {
    severity: 'risky',
    title: 'Response header removed',
    hint: 'Clients may read the header; check the deprecation window.',
  },
  'response-header-added': {
    severity: 'compatible',
    title: 'Response header added',
    hint: 'New headers are backwards compatible.',
  },
  'schema-composition-changed': {
    severity: 'risky',
    title: 'Schema composition changed',
    hint: 'oneOf/anyOf pairs cannot be matched reliably; review the variants by hand.',
  },
  'schema-enum-narrowed': {
    severity: 'breaking',
    title: 'Enum narrowed',
    hint: 'A value old clients send or expect was removed.',
  },
  'schema-enum-widened': {
    severity: 'compatible',
    title: 'Enum widened',
    hint: 'New values are backwards compatible for clients that tolerate them.',
  },
  'schema-additional-properties-forbidden': {
    severity: 'breaking',
    title: 'Additional properties forbidden',
    hint: 'Old clients may send fields the schema now rejects.',
  },
  'schema-additional-properties-allowed': {
    severity: 'compatible',
    title: 'Additional properties allowed',
    hint: 'Allowing more fields is backwards compatible.',
  },
  'security-requirement-added': {
    severity: 'breaking',
    title: 'Security requirement added',
    hint: 'Old clients are unauthenticated; introduce the requirement gradually.',
  },
  'security-scope-added': {
    severity: 'breaking',
    title: 'Security scope added',
    hint: 'Existing tokens may lack the new scope.',
  },
  'security-requirement-removed': {
    severity: 'compatible',
    title: 'Security requirement removed',
    hint: 'Removing an authentication requirement is backwards compatible.',
  },
  'server-removed': {
    severity: 'risky',
    title: 'Server removed',
    hint: 'Clients pinned to the old deployment address must migrate.',
  },
  'server-added': {
    severity: 'compatible',
    title: 'Server added',
    hint: 'New deployments are backwards compatible.',
  },
  'deprecated-added': {
    severity: 'info',
    title: 'Operation deprecated',
    hint: 'Announce the replacement before removing the operation.',
  },
  'default-changed': {
    severity: 'info',
    title: 'Default value changed',
    hint: 'Clients that omit the field now receive a different value.',
  },
};

export const SEVERITY_RANK: Record<ChangeSeverity, number> = {
  breaking: 0,
  risky: 1,
  compatible: 2,
  info: 3,
};

export function definitionOf(id: string): ChangeDefinition {
  const definition = CHANGE_DEFINITIONS[id];
  if (!definition) throw new Error(`unknown change id "${id}"`);
  return definition;
}
