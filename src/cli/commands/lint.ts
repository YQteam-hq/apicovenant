import { writeTextFile } from '../../util/fs.ts';
import { lint, allRules, findRule } from '../../lint/engine.ts';
import { renderTextReport } from '../../report/text.ts';
import { renderJsonReport } from '../../report/json.ts';
import { renderHtmlReport } from '../../report/html.ts';
import { bold, dim, green, red, yellow } from '../../util/ansi.ts';
import { TOOL_NAME, VERSION } from '../../version.ts';
import { loadConfig, type FailOn, type ReportFormat } from '../../config.ts';
import { applyBaseline, buildBaseline, loadBaseline, saveBaseline } from '../../baseline.ts';
import { loadSpec, UsageError } from '../common.ts';
import type { Finding, Severity } from '../../lint/types.ts';

export interface LintCommandOptions {
  document: string;
  format?: ReportFormat;
  output?: string;
  rules?: string[];
  ignore?: string[];
  severity?: Severity;
  failOn?: FailOn;
  listRules?: boolean;
  config?: string;
  baseline?: string;
  updateBaseline?: string;
  noBaseline?: boolean;
}

export async function runLint(options: LintCommandOptions): Promise<number> {
  if (options.listRules) {
    process.stdout.write(renderRuleCatalogue(undefined, options.format === 'json' ? 'json' : 'text'));
    return 0;
  }

  const loaded = await loadConfig({ explicitPath: options.config });
  const fileConfig = loaded.config;

  const format: ReportFormat = options.format ?? fileConfig.format ?? 'text';
  const output = options.output ?? fileConfig.output;
  const severity: Severity = options.severity ?? fileConfig.severity ?? 'info';
  const failOn: FailOn = options.failOn ?? fileConfig.failOn ?? 'error';
  const rules = options.rules && options.rules.length > 0 ? options.rules : fileConfig.rules?.only;
  const ignore = [...(fileConfig.rules?.ignore ?? []), ...(options.ignore ?? [])];

  const unknown = (rules ?? []).filter((id) => !findRule(id));
  if (unknown.length > 0) {
    throw new UsageError(
      `unknown rule${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}. Run "apicovenant rules" for the catalogue.`,
    );
  }

  const spec = await loadSpec(options.document);

  const result = lint(spec, { rules, ignore, minSeverity: severity });

  const baselinePath = options.noBaseline
    ? undefined
    : (options.baseline ?? fileConfig.baseline);

  let findings: Finding[] = result.findings;
  let suppressed = 0;

  if (options.updateBaseline) {
    const baseline = buildBaseline(result.findings);
    await saveBaseline(options.updateBaseline, baseline);
    process.stdout.write(
      `${green('✓')} baseline written to ${bold(options.updateBaseline)} ${dim(`(${baseline.findings.length} findings recorded)`)}\n`,
    );
    return 0;
  }

  if (baselinePath) {
    const baseline = await loadBaseline(baselinePath);
    if (baseline.findings.length > 0) {
      const applied = applyBaseline(result.findings, baseline);
      findings = applied.fresh;
      suppressed = applied.suppressed.length;
    }
  }

  let report: string;
  const counts: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;

  if (format === 'json') {
    report = renderJsonReport({
      tool: TOOL_NAME,
      version: VERSION,
      document: spec.document,
      findings,
    });
  } else if (format === 'html') {
    report = renderHtmlReport({
      tool: TOOL_NAME,
      version: VERSION,
      document: spec.document,
      findings,
      title: `${spec.info.title} — contract report`,
    });
  } else {
    const lines = renderTextReport({
      document: spec.document,
      findings,
      successMessage: `${spec.info.title} v${spec.info.version} follows every convention.`,
      groupByRule: true,
    });
    report =
      suppressed > 0
        ? `${lines}\n  ${dim(`${suppressed} known finding${suppressed === 1 ? '' : 's'} suppressed by the baseline`)}\n`
        : lines;
  }

  if (output) {
    await writeTextFile(output, report);
    const summary = `${counts.error} errors, ${counts.warn} warnings, ${counts.info} info`;
    process.stdout.write(`${green('✓')} report written to ${bold(output)} ${dim(`(${summary})`)}\n`);
  } else {
    process.stdout.write(`${report}\n`);
  }

  if (failOn === 'never') return 0;
  if (failOn === 'warn') {
    if (counts.error > 0 || counts.warn > 0) return 1;
    return 0;
  }
  if (counts.error > 0) return 1;
  return 0;
}

export function renderRuleCatalogue(category?: string, format: 'text' | 'json' = 'text'): string {
  const rules = [...allRules()].sort((a, b) => a.id.localeCompare(b.id));
  const selected = category ? rules.filter((rule) => rule.category === category) : rules;

  if (format === 'json') {
    return `${JSON.stringify(
      selected.map((rule) => ({
        id: rule.id,
        title: rule.title,
        severity: rule.severity,
        category: rule.category,
        description: rule.description,
      })),
      null,
      2,
    )}\n`;
  }

  const lines: string[] = [];
  const byCategory = new Map<string, typeof selected>();
  for (const rule of selected) {
    const list = byCategory.get(rule.category) ?? [];
    list.push(rule);
    byCategory.set(rule.category, list);
  }

  for (const [cat, list] of byCategory) {
    lines.push(bold(cat));
    lines.push('');
    for (const rule of list) {
      const severity =
        rule.severity === 'error' ? red('error') : rule.severity === 'warn' ? yellow('warn ') : dim('info ');
      lines.push(`  ${severity}  ${rule.id}`);
      lines.push(`        ${rule.title}`);
    }
    lines.push('');
  }

  lines.push(dim(`${selected.length} rules in ${byCategory.size} categories`));
  return lines.join('\n');
}
