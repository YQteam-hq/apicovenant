export type SarifLevel = 'error' | 'warning' | 'note';

export interface SarifRuleDefinition {
  id: string;
  title: string;
  description?: string;
  level: SarifLevel;
}

export interface SarifResult {
  ruleId: string;
  level: SarifLevel;
  message: string;
  uri: string;
  /** JSON Pointer or operation label, kept as a logical location. */
  location?: string;
}

export interface SarifReportOptions {
  tool: string;
  version: string;
  informationUri?: string;
  rules: SarifRuleDefinition[];
  results: SarifResult[];
}

/**
 * SARIF 2.1.0, the format GitHub code scanning and most CI dashboards read.
 * OpenAPI findings have no line numbers, so each result points at the
 * document URI plus a logical location carrying the JSON Pointer.
 */
export function renderSarif(options: SarifReportOptions): string {
  const known = new Set(options.rules.map((rule) => rule.id));
  const rules = options.rules.map((rule) => ({
    id: rule.id,
    name: rule.title.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || rule.id,
    shortDescription: { text: rule.title },
    fullDescription: { text: rule.description ?? rule.title },
    defaultConfiguration: { level: rule.level },
    helpUri: options.informationUri,
  }));

  const results = options.results.map((result) => ({
    ruleId: result.ruleId,
    ruleIndex: Math.max(0, options.rules.findIndex((rule) => rule.id === result.ruleId)),
    level: result.level,
    message: { text: result.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: result.uri },
        },
        logicalLocations: result.location
          ? [{ fullyQualifiedName: result.location, kind: 'member' }]
          : undefined,
      },
    ],
    properties: {
      ruleKnown: known.has(result.ruleId),
      pointer: result.location ?? null,
    },
  }));

  const document = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: options.tool,
            version: options.version,
            informationUri: options.informationUri,
            rules,
          },
        },
        results,
      },
    ],
  };

  return `${JSON.stringify(document, null, 2)}\n`;
}
