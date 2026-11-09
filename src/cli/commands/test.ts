import { loadConfig } from '../../config.ts';
import { runContractTests } from '../../contract/run.ts';
import { renderJunit } from '../../report/junit.ts';
import { renderSarif } from '../../report/sarif.ts';
import { writeTextFile } from '../../util/fs.ts';
import { bold, cyan, dim, green, red, yellow } from '../../util/ansi.ts';
import { TOOL_NAME, VERSION } from '../../version.ts';
import { loadSpec, UsageError } from '../common.ts';
import type { ContractTestRun } from '../../contract/run.ts';

export type ContractFormat = 'text' | 'json' | 'junit' | 'sarif';

export interface TestCommandOptions {
  document: string;
  target?: string;
  includeUnsafe?: boolean;
  failOn?: 'failure' | 'never';
  format?: ContractFormat;
  output?: string;
  maxCases?: number;
  config?: string;
}

function renderText(run: ContractTestRun, document: string): string {
  const lines: string[] = [];
  lines.push(
    `${bold('contract tests')} ${dim(document)} ${dim('→')} ${cyan(run.target)}`,
  );
  lines.push('');

  for (const result of run.results) {
    const duration = result.status === 'pass' ? dim(` ${Math.round(result.durationMs)}ms`) : '';
    if (result.status === 'pass') {
      lines.push(`  ${green('✓')} ${result.name}${duration}`);
    } else if (result.status === 'fail') {
      lines.push(`  ${red('✗')} ${result.name}${duration}`);
      lines.push(`      ${red(result.message ?? 'failed')}`);
    } else {
      lines.push(`  ${yellow('-')} ${result.name} ${dim(result.message ?? 'skipped')}`);
    }
  }

  lines.push('');
  const parts = [
    run.summary.failed > 0 ? red(`${run.summary.failed} failed`) : green('0 failed'),
    `${run.summary.passed} passed`,
    `${run.summary.skipped} skipped`,
    `${run.summary.total} total`,
  ];
  lines.push(`  ${parts.join(dim(' · '))}`);
  return `${lines.join('\n')}\n`;
}

export async function runTest(options: TestCommandOptions): Promise<number> {
  if (!options.document) throw new UsageError('no OpenAPI document given');

  const loaded = await loadConfig({ explicitPath: options.config });
  const section = loaded.config.test;

  const format: ContractFormat =
    options.format ??
    (section?.format === 'json' || section?.format === 'junit' || section?.format === 'sarif'
      ? section.format
      : 'text');
  const failOn = options.failOn ?? section?.failOn ?? 'failure';
  const includeUnsafe = options.includeUnsafe ?? section?.includeUnsafe ?? false;
  const maxCases = options.maxCases ?? section?.maxCases ?? 200;
  const output = options.output ?? section?.output;

  const spec = await loadSpec(options.document);
  const run = await runContractTests(spec, {
    baseUrl: options.target,
    includeUnsafe,
    maxCases,
  });

  let report: string;
  if (format === 'json') {
    report = `${JSON.stringify(
      {
        spec: options.document,
        target: run.target,
        summary: run.summary,
        results: run.results,
      },
      null,
      2,
    )}\n`;
  } else if (format === 'junit') {
    report = renderJunit('apicovenant', run.results.map((result) => ({
      name: result.name,
      classname: `apicovenant.${result.method}`,
      status: result.status,
      durationMs: result.durationMs,
      message: result.message,
    })));
  } else if (format === 'sarif') {
    report = renderSarif({
      tool: TOOL_NAME,
      version: VERSION,
      informationUri: 'https://github.com/apicovenant/apicovenant',
      rules: [
        {
          id: 'contract-response',
          title: 'Response violates the documented contract',
          description: 'The status, media type or JSON body does not match the OpenAPI document.',
          level: 'error',
        },
      ],
      results: run.results
        .filter((result) => result.status === 'fail')
        .map((result) => ({
          ruleId: 'contract-response',
          level: 'error' as const,
          message: result.message ?? 'contract test failed',
          uri: options.document,
          location: `${result.method} ${result.path}`,
        })),
    });
  } else {
    report = renderText(run, options.document);
  }

  if (output && output !== '-') {
    await writeTextFile(output, report);
  } else {
    process.stdout.write(report);
  }

  if (run.summary.failed > 0 && failOn === 'failure') return 1;
  return 0;
}
