import { bold, cyan, dim, green, magenta, red, yellow } from '../util/ansi.ts';
import { humanizePointer } from '../util/json-pointer.ts';
import { truncate } from '../util/text.ts';
import type { Finding, Severity } from '../lint/types.ts';

const SEVERITY_LABEL: Record<Severity, string> = {
  error: 'error',
  warn: 'warning',
  info: 'info',
};

const SEVERITY_COLOR: Record<Severity, (text: string) => string> = {
  error: red,
  warn: yellow,
  info: cyan,
};

export interface TextReportOptions {

  document: string;

  findings: Finding[];

  total?: number;

  successMessage?: string;

  groupByRule?: boolean;

  limit?: number;


  maxPerRule?: number;
}

export function renderTextReport(options: TextReportOptions): string {
  const lines: string[] = [];
  const findings = options.findings;
  const limit = options.limit ?? findings.length;

  const maxPerRule = options.maxPerRule ?? 20;

  if (findings.length === 0) {
    lines.push(green(bold('✓ no findings')));
    if (options.successMessage) lines.push(dim(`  ${options.successMessage}`));
    lines.push('');
    lines.push(dim(`  document: ${options.document}`));
    return lines.join('\n');
  }

  const counts = { error: 0, warn: 0, info: 0 } as Record<Severity, number>;
  for (const finding of findings) counts[finding.severity] += 1;

  const summaryParts: string[] = [];
  if (counts.error > 0) summaryParts.push(red(`${counts.error} ${counts.error === 1 ? 'error' : 'errors'}`));
  if (counts.warn > 0) summaryParts.push(yellow(`${counts.warn} ${counts.warn === 1 ? 'warning' : 'warnings'}`));
  if (counts.info > 0) summaryParts.push(cyan(`${counts.info} ${counts.info === 1 ? 'info' : 'info'}`));

  lines.push(bold(summaryParts.join(dim(' · '))));
  lines.push('');

  const printedPerRule = new Map<string, number>();

  const hiddenPerRule = new Map<string, number>();

  let currentOperation: string | undefined;
  for (const finding of findings.slice(0, limit)) {
    const printed = printedPerRule.get(finding.ruleId) ?? 0;
    if (printed >= maxPerRule) {
      hiddenPerRule.set(finding.ruleId, (hiddenPerRule.get(finding.ruleId) ?? 0) + 1);
      continue;
    }
    printedPerRule.set(finding.ruleId, printed + 1);
    const operation = finding.operation ?? '';
    if (operation !== currentOperation) {
      currentOperation = operation;
      lines.push(bold(currentOperation || 'document'));
      lines.push('');
    }

    const label = SEVERITY_COLOR[finding.severity](SEVERITY_LABEL[finding.severity].padEnd(7));
    lines.push(`  ${label} ${magenta(finding.ruleId)}`);
    lines.push(`          ${finding.message}`);
    if (finding.path) {
      lines.push(`          ${dim(humanizePointer(finding.path))}`);
    }
    if (finding.hint) {
      lines.push(`          ${dim('→ ' + finding.hint)}`);
    }
    lines.push('');
  }

  if (hiddenPerRule.size > 0) {
    for (const [rule, count] of [...hiddenPerRule.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(dim(`  … and ${count} more ${rule}`));
    }
    lines.push('');
  }

  if (limit < findings.length) {
    lines.push(dim(`  … ${findings.length - limit} more findings (use --format json for the full list)`));
    lines.push('');
  }

  if (options.groupByRule) {
    lines.push(renderRuleBreakdown(findings));
  }

  lines.push(dim(`  document: ${options.document}`));
  return lines.join('\n');
}

export function renderRuleBreakdown(findings: Finding[]): string {
  const byRule = new Map<string, number>();
  for (const finding of findings) byRule.set(finding.ruleId, (byRule.get(finding.ruleId) ?? 0) + 1);

  const entries = [...byRule.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (entries.length === 0) return '';

  const lines = [bold('rules fired')];
  for (const [rule, count] of entries) {
    lines.push(`  ${magenta(rule.padEnd(34))} ${count}`);
  }
  lines.push('');
  return lines.join('\n');
}

export function renderSummaryLine(counts: Record<Severity, number>, document: string): string {
  const parts: string[] = [];
  if (counts.error) parts.push(red(`${counts.error} error${counts.error === 1 ? '' : 's'}`));
  if (counts.warn) parts.push(yellow(`${counts.warn} warning${counts.warn === 1 ? '' : 's'}`));
  if (counts.info) parts.push(cyan(`${counts.info} info`));
  if (parts.length === 0) return green('✓ 0 findings');
  return `${parts.join(dim(' · '))} ${dim(`in ${truncate(document, 60)}`)}`;
}
