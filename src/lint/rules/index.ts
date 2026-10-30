import type { RuleDefinition } from '../types.ts';
import { operationRules } from './operations.ts';
import { pathRules } from './paths.ts';
import { parameterRules } from './parameters.ts';
import { responseRules } from './responses.ts';
import { schemaRules } from './schemas.ts';
import { securityRules } from './security.ts';
import { paginationRules } from './pagination.ts';
import { documentRules } from './document.ts';

export const ALL_RULES: RuleDefinition[] = [
  ...documentRules,
  ...operationRules,
  ...pathRules,
  ...parameterRules,
  ...responseRules,
  ...schemaRules,
  ...securityRules,
  ...paginationRules,
];

export {
  operationRules,
  pathRules,
  parameterRules,
  responseRules,
  schemaRules,
  securityRules,
  paginationRules,
  documentRules,
};
