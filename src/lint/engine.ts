import { SEVERITY_ORDER, type Finding, type LintOptions, type LintResult, type RuleDefinition, type Severity } from './types.ts';
import { ALL_RULES } from './rules/index.ts';
import type { ApiSpec } from '../spec/model.ts';
import { isPlainObject } from '../util/text.ts';

/** Every rule, including rules contributed by a plugin. */
export function allRules(extra: RuleDefinition[] = []): RuleDefinition[] {
  return extra.length === 0 ? ALL_RULES : [...ALL_RULES, ...extra];
}

export function findRule(id: string, extra: RuleDefinition[] = []): RuleDefinition | undefined {
  return ALL_RULES.find((rule) => rule.id === id) ?? extra.find((rule) => rule.id === id);
}

export function selectRules(options: LintOptions): RuleDefinition[] {
  const include = options.rules?.length ? new Set(options.rules) : null;
  const ignore = new Set(options.ignore ?? []);
  const levels = options.ruleLevels ?? {};

  return allRules(options.extraRules).filter((rule) => {
    if (ignore.has(rule.id)) return false;
    if (levels[rule.id] === 'off') return false;
    if (include) return include.has(rule.id);
    return true;
  });
}

export function lint(spec: ApiSpec, options: LintOptions = {}): LintResult {
  const rules = selectRules(options);
  const findings: Finding[] = [];
  const levels = options.ruleLevels ?? {};

  for (const rule of rules) {
    const context = {
      spec,
      report(finding: {
        severity?: Severity;
        message: string;
        path: string;
        operation?: string;
        hint?: string;
      }): void {
        const configured = levels[rule.id];
        const severity: Severity =
          finding.severity ??
          (configured === 'error' || configured === 'warn' || configured === 'info' ? configured : rule.severity);
        findings.push({
          ruleId: rule.id,
          severity,
          message: finding.message,
          path: finding.path,
          operation: finding.operation,
          hint: finding.hint,
        });
      },
    };

    try {
      rule.check(context);
    } catch (error) {
      // A plugin failure is a configuration error, not a finding: surface it to
      // the caller so the CLI can exit with code 3 and print the plugin path.
      if (rule.source) throw error;
      findings.push({
        ruleId: rule.id,
        severity: 'error',
        message: `rule failed to run: ${(error as Error).message}`,
        path: '',
      });
    }
  }

  const minSeverity = options.minSeverity;
  if (options.strictSchema) findings.push(...unsupportedSchemaKeywords(spec.raw));
  // Guard against an invalid minSeverity: "x <= undefined" is always false,
  // which would silently suppress every finding.
  const filtered =
    minSeverity && minSeverity in SEVERITY_ORDER
      ? findings.filter((finding) => SEVERITY_ORDER[finding.severity] <= SEVERITY_ORDER[minSeverity])
      : findings;

  filtered.sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) return bySeverity;
    if (a.path !== b.path) return a.path.localeCompare(b.path);
    return a.ruleId.localeCompare(b.ruleId);
  });

  const counts: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const finding of filtered) counts[finding.severity] += 1;

  return {
    findings: filtered,
    counts,
    total: filtered.length,
    executed: rules.map((rule) => rule.id),
  };
}

// Keywords from JSON Schema 2020-12 that the built-in validator does not
// evaluate. --strict-schema turns silent acceptance into a warning.
const UNSUPPORTED_SCHEMA_KEYWORDS = new Set([
  'patternProperties',
  'propertyNames',
  'contains',
  'minContains',
  'maxContains',
  'unevaluatedItems',
  '$recursiveRef',
  '$recursiveAnchor',
  '$vocabulary',
  'contentSchema',
]);

function pointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

function unsupportedSchemaKeywords(document: unknown): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<unknown>();

  const walk = (node: unknown, path: string): void => {
    if (seen.has(node)) return;
    if (Array.isArray(node)) {
      seen.add(node);
      node.forEach((entry, index) => walk(entry, `${path}/${index}`));
      return;
    }
    if (!isPlainObject(node)) return;
    seen.add(node);
    for (const [key, value] of Object.entries(node)) {
      const childPath = `${path}/${pointerToken(key)}`;
      if (UNSUPPORTED_SCHEMA_KEYWORDS.has(key)) {
        findings.push({
          ruleId: 'schema-unsupported-keyword',
          severity: 'warn',
          message: `OpenAPI 3.1 keyword "${key}" is not evaluated by this build`,
          path: childPath,
          hint: 'Simplify the schema or validate it with a full JSON Schema validator.',
        });
      }
      walk(value, childPath);
    }
  };

  walk(document, '#');
  return findings;
}
