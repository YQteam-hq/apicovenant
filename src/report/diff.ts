import { bold, cyan, dim, green, magenta, red, yellow } from '../util/ansi.ts';
import { humanizePointer } from '../util/json-pointer.ts';
import { describeReport, summariseDifferences, summariseMockViolations, type DiffReport } from '../diff/compare.ts';

export interface DiffTextOptions {
  report: DiffReport;
  goldenFile: string;

  limit?: number;
}

export function renderDiffReport(options: DiffTextOptions): string {
  const { report } = options;
  const lines: string[] = [];

  lines.push(bold('contract diff'));
  lines.push(`  ${dim('golden')}  ${options.goldenFile}`);
  lines.push(`  ${dim('source')}  ${report.source}`);
  lines.push('');

  const parts: string[] = [];
  if (report.summary.changed > 0) parts.push(red(`${report.summary.changed} changed`));
  if (report.summary.unchanged > 0) parts.push(green(`${report.summary.unchanged} unchanged`));
  if (report.summary.failed > 0) parts.push(red(`${report.summary.failed} failed`));
  if (report.summary.skipped > 0) parts.push(yellow(`${report.summary.skipped} skipped`));
  lines.push(parts.join(dim(' · ')) || green('nothing to compare'));
  lines.push('');

  const limit = options.limit ?? report.interactions.length;
  let printed = 0;

  for (const interaction of report.interactions) {
    if (interaction.skipped) {
      if (printed >= limit) break;
      printed += 1;
      lines.push(`${yellow('○')} ${bold(interaction.key)} ${dim('(skipped, unsafe method)')}`);
      lines.push('');
      continue;
    }

    const details = summariseDifferences(interaction);
    const mockNotes = summariseMockViolations(interaction);
    if (details.length === 0) {
      if (mockNotes.length === 0) {
        if (printed >= limit) continue;
        printed += 1;
        lines.push(`${green('✓')} ${interaction.key}`);
        lines.push('');
        continue;
      }
      if (printed >= limit) break;
      printed += 1;
      lines.push(`${yellow('◐')} ${bold(interaction.key)} ${dim('(the mock does not satisfy the spec)')}`);
      for (const note of mockNotes) {
        lines.push(`  ${cyan('!')} ${note}`);
      }
      lines.push('');
      continue;
    }

    if (printed >= limit) break;
    printed += 1;

    lines.push(`${red('✖')} ${bold(interaction.key)}`);
    for (const detail of details) {
      if (detail.startsWith('schema violation')) {
        lines.push(`  ${cyan('!')} ${detail}`);
      } else if (detail.startsWith('status')) {
        lines.push(`  ${red('•')} ${detail}`);
      } else {
        lines.push(`  ${yellow('•')} ${detail}`);
      }
    }
    for (const note of mockNotes) {
      lines.push(`  ${cyan('!')} ${note}`);
    }

    for (const difference of interaction.body.differences.slice(0, 8)) {
      lines.push(
        `      ${dim(humanizePointer(difference.path))} ${magenta(difference.kind)} ${dim(formatValue(difference.before))} → ${dim(formatValue(difference.after))}`,
      );
    }
    if (interaction.body.differences.length > 8) {
      lines.push(dim(`      … ${interaction.body.differences.length - 8} more body differences`));
    }
    lines.push('');
  }

  if (limit < report.interactions.length) {
    lines.push(dim(`  … ${report.interactions.length - limit} more interactions (use --format json for the full report)`));
    lines.push('');
  }

  const mockIssues = report.interactions.reduce((total, interaction) => total + interaction.mockViolations.length, 0);
  if (mockIssues > 0) {
    lines.push(
      yellow(
        `⚠ ${mockIssues} schema problem${mockIssues === 1 ? '' : 's'} in the generated mock — a generator limitation, not contract drift`,
      ),
    );
    lines.push('');
  }

  if (report.summary.changed === 0 && report.summary.failed === 0) {
    lines.push(green(bold('✓ the contract held')));
  } else {
    lines.push(red(bold(`✖ the contract drifted — ${describeReport(report)}`)));
  }

  return lines.join('\n');
}

function formatValue(value: unknown): string {
  if (value === undefined) return '(absent)';
  if (typeof value === 'string') return JSON.stringify(value);
  return JSON.stringify(value) ?? String(value);
}
