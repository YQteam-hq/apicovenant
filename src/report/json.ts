import type { Finding, Severity } from '../lint/types.ts';

export interface JsonReport {
  tool: string;
  version: string;
  document: string;
  generatedAt: string;
  summary: {
    total: number;
    error: number;
    warn: number;
    info: number;
  };
  findings: Array<{
    ruleId: string;
    severity: Severity;
    message: string;
    path: string;
    operation?: string;
    hint?: string;
  }>;
}

export interface BuildJsonReportOptions {
  tool: string;
  version: string;
  document: string;
  findings: Finding[];
  generatedAt?: string;
}

export function buildJsonReport(options: BuildJsonReportOptions): JsonReport {
  const counts: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const finding of options.findings) counts[finding.severity] += 1;

  return {
    tool: options.tool,
    version: options.version,
    document: options.document,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    summary: {
      total: options.findings.length,
      error: counts.error,
      warn: counts.warn,
      info: counts.info,
    },
    findings: options.findings.map((finding) => ({
      ruleId: finding.ruleId,
      severity: finding.severity,
      message: finding.message,
      path: finding.path,
      operation: finding.operation,
      hint: finding.hint,
    })),
  };
}

export function renderJsonReport(options: BuildJsonReportOptions): string {
  return `${JSON.stringify(buildJsonReport(options), null, 2)}\n`;
}
