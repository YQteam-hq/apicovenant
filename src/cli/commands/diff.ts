import { readTextFile, writeTextFile } from '../../util/fs.ts';
import { parseGoldenFile } from '../../record/golden.ts';
import { startMockServer } from '../../mock/server.ts';
import {
  compareGolden,
  HttpLiveSource,
  MockLiveSource,
  type DiffReport,
  type LiveSource,
} from '../../diff/compare.ts';
import { renderDiffReport } from '../../report/diff.ts';
import { renderDiffHtmlReport } from '../../report/diff-html.ts';
import { TOOL_NAME, VERSION } from '../../version.ts';
import { loadConfig, type ReportFormat } from '../../config.ts';
import { UsageError, loadSpec } from '../common.ts';

export interface DiffCommandOptions {
  golden: string;
  target?: string;
  spec?: string;
  format?: ReportFormat;
  replayAll: boolean;
  headers?: Record<string, string>;
  failOn?: 'changed' | 'never';
  config?: string;
  output?: string;
}

export async function runDiff(options: DiffCommandOptions): Promise<number> {
  if (!options.golden) throw new UsageError('--golden is required');

  const loaded = await loadConfig({ explicitPath: options.config });
  const fileConfig = loaded.config;

  const format: ReportFormat = options.format ?? fileConfig.format ?? 'text';
  const output = options.output ?? fileConfig.output;

  if (!options.target && !options.spec) {
    throw new UsageError('either --target or --spec is required');
  }
  if (options.target && options.spec) {
    throw new UsageError('--spec and --target are mutually exclusive; pass exactly one of them');
  }

  const golden = parseGoldenFile(await readTextFile(options.golden));

  let source: LiveSource;
  let mockHandle: { url: string; close(): Promise<void> } | undefined;
  let spec = undefined;

  if (options.spec) {
    spec = await loadSpec(options.spec);
    mockHandle = await startMockServer(spec);
    source = new MockLiveSource(mockHandle.url, `mock(${options.spec})`);
  } else {
    source = new HttpLiveSource(options.target as string, undefined, options.headers);
  }

  const report: DiffReport = await compareGolden(golden, source, {
    replayAll: options.replayAll,
    spec,
  });

  if (mockHandle) await mockHandle.close();

  let rendered: string;
  if (format === 'json') {
    rendered = `${JSON.stringify(
      {
        tool: TOOL_NAME,
        version: VERSION,
        generatedAt: new Date().toISOString(),
        ...report,
      },
      null,
      2,
    )}\n`;
  } else if (format === 'html') {
    rendered = renderDiffHtmlReport({
      report,
      goldenFile: options.golden,
      title: 'Contract drift report',
    });
  } else {
    rendered = `${renderDiffReport({ report, goldenFile: options.golden })}\n`;
  }

  if (output) {
    await writeTextFile(output, rendered);
    process.stdout.write(
      `${TOOL_NAME}: report written to ${output} (${report.summary.changed} changed, ${report.summary.unchanged} unchanged)\n`,
    );
  } else {
    process.stdout.write(rendered);
  }

  if (options.failOn === 'never') return 0;
  if (report.summary.changed > 0 || report.summary.failed > 0) return 1;
  return 0;
}
