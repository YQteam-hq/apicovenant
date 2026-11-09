import { readTextFile, writeTextFile } from '../../util/fs.ts';
import { parseGoldenFile } from '../../record/golden.ts';
import { loadSpec, UsageError } from '../common.ts';
import { loadConfig } from '../../config.ts';
import {
  coverageShouldFail,
  measureCoverage,
  renderCoverageText,
  type CoverageReport,
} from '../../coverage/coverage.ts';
import { renderSarif, type SarifLevel, type SarifResult, type SarifRuleDefinition } from '../../report/sarif.ts';
import { TOOL_NAME, VERSION } from '../../version.ts';
import { bold, dim, green, red } from '../../util/ansi.ts';

export type CoverageFormat = 'text' | 'json' | 'sarif';

export interface CoverageCommandOptions {
  golden: string;
  spec: string;
  format?: CoverageFormat;
  output?: string;
  min?: number;
  failOn?: 'gap' | 'undocumented' | 'never';
  config?: string;
}

const RULES: SarifRuleDefinition[] = [
  { id: 'unexercised-operation', title: 'Documented operation was never exercised', level: 'warning' },
  { id: 'undocumented-path', title: 'Traffic hit a path the document does not describe', level: 'error' },
  { id: 'undocumented-method', title: 'Traffic used a method the document does not describe', level: 'error' },
  { id: 'status-gap', title: 'Observed status code is not documented', level: 'note' },
];

function renderJson(report: CoverageReport): string {
  return `${JSON.stringify({ tool: TOOL_NAME, version: VERSION, ...report }, null, 2)}\n`;
}

function renderSarifReport(report: CoverageReport): string {
  const results: SarifResult[] = [];
  for (const entry of report.unexercised) {
    results.push({
      ruleId: 'unexercised-operation',
      level: 'warning' as SarifLevel,
      message: `${entry.operation} was never exercised by the recorded traffic`,
      uri: report.spec,
      location: entry.operation,
    });
  }
  for (const entry of report.undocumented) {
    results.push({
      ruleId: entry.reason === 'path-not-documented' ? 'undocumented-path' : 'undocumented-method',
      level: 'error' as SarifLevel,
      message: `${entry.method} ${entry.path} is not documented (${entry.reason})`,
      uri: report.spec,
      location: `${entry.method} ${entry.path}`,
    });
  }
  for (const gap of report.statusGaps) {
    results.push({
      ruleId: 'status-gap',
      level: 'note' as SarifLevel,
      message: `${gap.method} ${gap.path} returned ${gap.observed.join(', ')}; documented: ${gap.documented.join(', ')}`,
      uri: report.spec,
      location: `${gap.method} ${gap.path}`,
    });
  }
  return renderSarif({
    tool: TOOL_NAME,
    version: VERSION,
    informationUri: 'https://github.com/YQteam-hq/apicovenant#readme',
    rules: RULES,
    results,
  });
}

export async function runCoverage(options: CoverageCommandOptions): Promise<number> {
  if (!options.golden) throw new UsageError('--golden is required');
  if (!options.spec) throw new UsageError('--spec is required');

  const loaded = await loadConfig({ explicitPath: options.config });
  const section = loaded.config.coverage;

  const configuredFormat = section?.format;
  const format: CoverageFormat =
    options.format ?? (configuredFormat === 'json' || configuredFormat === 'sarif' ? configuredFormat : 'text');
  const failOn = options.failOn ?? section?.failOn ?? 'never';
  const min = options.min ?? section?.min;
  if (min !== undefined && (!Number.isInteger(min) || min < 0 || min > 100)) {
    throw new UsageError(`invalid --min "${String(min)}" (expected an integer from 0 to 100)`);
  }
  const requestedOutput = options.output ?? section?.output;
  const output = requestedOutput === '-' ? undefined : requestedOutput;

  const golden = parseGoldenFile(await readTextFile(options.golden));
  const spec = await loadSpec(options.spec);
  const report = measureCoverage(golden, spec, options.golden);

  const rendered =
    format === 'json'
      ? renderJson(report)
      : format === 'sarif'
        ? renderSarifReport(report)
        : `${renderCoverageText(report)}\n`;

  if (output) {
    await writeTextFile(output, rendered);
    process.stdout.write(`${green('✓')} report written to ${bold(output)}\n`);
  } else {
    process.stdout.write(rendered);
  }

  const failing = coverageShouldFail(report, failOn, min);
  if (failing && !output) {
    process.stdout.write(
      `\n${red('✖')} coverage gate failed ${dim(`(fail-on ${failOn}${min !== undefined ? `, min ${min}%` : ''})`)}\n`,
    );
  }
  return failing ? 1 : 0;
}
