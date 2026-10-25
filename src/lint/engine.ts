import { SEVERITY_ORDER, type Finding, type LintOptions, type LintResult, type RuleDefinition, type Severity } from './types.ts';
import { ALL_RULES } from './rules/index.ts';
import type { ApiSpec } from '../spec/model.ts';

export function allRules(): RuleDefinition[] {
  return ALL_RULES;
}

export function findRule(id: string): RuleDefinition | undefined {
  return ALL_RULES.find((rule) => rule.id === id);
}

export function selectRules(options: LintOptions): RuleDefinition[] {
  const include = options.rules?.length ? new Set(options.rules) : null;
  const ignore = new Set(options.ignore ?? []);

  return ALL_RULES.filter((rule) => {
    if (ignore.has(rule.id)) return false;
    if (include) return include.has(rule.id);
    return true;
  });
}

export function lint(spec: ApiSpec, options: LintOptions = {}): LintResult {
  const rules = selectRules(options);
  const findings: Finding[] = [];

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
        findings.push({
          ruleId: rule.id,
          severity: finding.severity ?? rule.severity,
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
      findings.push({
        ruleId: rule.id,
        severity: 'error',
        message: `rule failed to run: ${(error as Error).message}`,
        path: '',
      });
    }
  }

  const minSeverity = options.minSeverity;
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
