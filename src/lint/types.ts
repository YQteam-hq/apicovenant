import type { ApiSpec } from '../spec/model.ts';

export type Severity = 'error' | 'warn' | 'info';

export const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

export interface Finding {

  ruleId: string;
  severity: Severity;

  message: string;

  path: string;

  operation?: string;

  hint?: string;
}

export interface RuleReport {
  severity?: Severity;
  message: string;
  path: string;
  operation?: string;
  hint?: string;
}

export interface RuleContext {
  spec: ApiSpec;
  report(finding: RuleReport): void;
}

export interface RuleDefinition {

  id: string;

  title: string;

  description: string;

  severity: Severity;

  category: string;

  keywords?: string[];

  check(context: RuleContext): void;
}

export interface LintOptions {

  rules?: string[];

  ignore?: string[];

  minSeverity?: Severity;
}

export interface LintResult {
  findings: Finding[];
  counts: Record<Severity, number>;
  total: number;

  executed: string[];
}
