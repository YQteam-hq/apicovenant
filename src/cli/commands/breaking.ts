import { writeTextFile } from '../../util/fs.ts';
import { loadConfig } from '../../config.ts';
import { loadSpec, UsageError } from '../common.ts';
import { compareSpecs, shouldFail, type BreakingReport } from '../../breaking/compare.ts';
import { CHANGE_DEFINITIONS } from '../../breaking/taxonomy.ts';
import { renderSarif, type SarifLevel, type SarifResult, type SarifRuleDefinition } from '../../report/sarif.ts';
import { TOOL_NAME, VERSION } from '../../version.ts';
import { bold, dim, green, red, yellow } from '../../util/ansi.ts';

export type BreakingFormat = 'text' | 'json' | 'sarif';

export interface BreakingCommandOptions {
  base: string;
  head: string;
  format?: BreakingFormat;
  output?: string;
  failOn?: 'breaking' | 'risky' | 'any' | 'never';
  ignoreChanges?: string[];
  config?: string;
}

const LEVEL: Record<string, SarifLevel> = {
  breaking: 'error',
  risky: 'warning',
  compatible: 'note',
  info: 'note',
};

function renderText(report: BreakingReport): string {
  const lines: string[] = [];
  lines.push('breaking changes');
  lines.push(`  base  ${report.base}`);
  lines.push(`  head  ${report.head}`);
  lines.push(
    `  ${report.summary.breaking} breaking, ${report.summary.risky} risky, ` +
      `${report.summary.compatible} compatible, ${report.summary.info} info (${report.summary.total} total)`,
  );

  if (report.changes.length === 0) {
    lines.push('');
    lines.push(green('✓') + ' the head document is compatible with the base document');
    return lines.join('\n');
  }

  for (const change of report.changes) {
    const label =
      change.severity === 'breaking'
        ? red('BREAKING')
        : change.severity === 'risky'
          ? yellow('RISKY   ')
          : change.severity === 'compatible'
            ? green('COMPAT  ')
            : dim('INFO    ');
    lines.push('');
    lines.push(`${label} ${bold(change.operation)}`);
    lines.push(`  ${change.id}: ${change.message}`);
    if (change.location.base) lines.push(`  base ${dim(change.location.base)}`);
    if (change.location.head) lines.push(`  head ${dim(change.location.head)}`);
    lines.push(`  ${dim(change.hint)}`);
  }

  return lines.join('\n');
}

export function renderBreaking(report: BreakingReport, format: BreakingFormat): string {
  if (format === 'json') {
    return `${JSON.stringify({ tool: TOOL_NAME, version: VERSION, ...report }, null, 2)}\n`;
  }
  if (format === 'sarif') {
    const rules: SarifRuleDefinition[] = Object.entries(CHANGE_DEFINITIONS).map(([id, definition]) => ({
      id,
      title: definition.title,
      description: definition.hint,
      level: LEVEL[definition.severity] ?? 'note',
    }));
    const results: SarifResult[] = report.changes.map((change) => ({
      ruleId: change.id,
      level: LEVEL[change.severity] ?? 'note',
      message: `${change.operation}: ${change.message}`,
      uri: report.head || report.base,
      location: change.location.head ?? change.location.base ?? undefined,
    }));
    return renderSarif({
      tool: TOOL_NAME,
      version: VERSION,
      informationUri: 'https://github.com/YQteam-hq/apicovenant#readme',
      rules,
      results,
    });
  }
  return `${renderText(report)}\n`;
}

export async function runBreaking(options: BreakingCommandOptions): Promise<number> {
  if (!options.base) throw new UsageError('--base is required');
  if (!options.head) throw new UsageError('--head is required');

  const loaded = await loadConfig({ explicitPath: options.config });
  const section = loaded.config.breaking;

  const configuredFormat = section?.format;
  const format: BreakingFormat =
    options.format ?? (configuredFormat === 'json' || configuredFormat === 'sarif' ? configuredFormat : 'text');
  const failOn = options.failOn ?? section?.failOn ?? 'breaking';
  const ignoreChanges = [...(section?.ignoreChanges ?? []), ...(options.ignoreChanges ?? [])];
  const requestedOutput = options.output ?? section?.output;
  const output = requestedOutput === '-' ? undefined : requestedOutput;

  const base = await loadSpec(options.base);
  const head = await loadSpec(options.head);
  const report = compareSpecs(base, head, { ignoreChanges });

  const rendered = renderBreaking(report, format);
  if (output) {
    await writeTextFile(output, rendered);
    process.stdout.write(
      `${green('✓')} report written to ${bold(output)} ${dim(`(${report.summary.total} changes)`)}\n`,
    );
  } else {
    process.stdout.write(rendered);
  }

  return shouldFail(report, failOn) ? 1 : 0;
}
