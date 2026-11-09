import { readTextFile, writeTextFile } from '../../util/fs.ts';
import { watchFile, unwatchFile } from 'node:fs';
import { resolve } from 'node:path';
import { lint, allRules, findRule } from '../../lint/engine.ts';
import { renderTextReport } from '../../report/text.ts';
import { renderJsonReport } from '../../report/json.ts';
import { renderHtmlReport } from '../../report/html.ts';
import { renderSarif, type SarifLevel } from '../../report/sarif.ts';
import { bold, dim, green, red, yellow } from '../../util/ansi.ts';
import { TOOL_NAME, VERSION } from '../../version.ts';
import { loadConfig, applyPluginPresets, type FailOn } from '../../config.ts';
import { loadPlugins } from '../../plugin/load.ts';
import type { PluginReporter, PluginRule } from '../../plugin/api.ts';
import { applyBaseline, buildBaseline, loadBaseline, saveBaseline } from '../../baseline.ts';
import { loadSpec, UsageError, describeError } from '../common.ts';
import type { Finding, RuleDefinition, Severity } from '../../lint/types.ts';
import { STRICT_RULES } from '../../lint/rules/strict.ts';
import { applyFixes } from '../../fix/fix.ts';
import { unifiedDiff } from '../../util/diff.ts';

export interface LintCommandOptions {
  document: string;
  format?: string;
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
  noPlugins?: boolean;
  watch?: boolean;
  fix?: boolean;
  write?: boolean;
  fixAggressive?: boolean;
  strictSchema?: boolean;
}

export async function runLint(options: LintCommandOptions): Promise<number> {
  if (options.fix || options.write || options.fixAggressive) {
    return await runFix(options);
  }
  if (options.watch && !options.listRules) {
    return await watchLint(options);
  }
  const loaded = await loadConfig({ explicitPath: options.config });
  const plugins = options.noPlugins
    ? { rules: [] as PluginRule[], reporters: [] as PluginReporter[], presets: [], sources: [] }
    : await loadPlugins(loaded.config.plugins ?? []);
  const fileConfig = applyPluginPresets(loaded.config, plugins.presets);
  const strictRules = fileConfig.strictRules ? STRICT_RULES : [];
  const extraRules = [...plugins.rules, ...strictRules];

  const builtinIds = new Set(allRules(strictRules).map((rule) => rule.id));
  const conflicting = plugins.rules.filter((rule) => builtinIds.has(rule.id));
  if (conflicting.length > 0) {
    throw new UsageError(
      `plugin rule${conflicting.length === 1 ? '' : 's'} ${conflicting.map((rule) => rule.id).join(', ')} conflict with built-in rules`,
    );
  }
  const formats = new Set<string>();
  for (const reporter of plugins.reporters) {
    if (formats.has(reporter.format)) {
      throw new UsageError(`more than one plugin reporter registers --format ${reporter.format}`);
    }
    formats.add(reporter.format);
  }

  if (options.listRules) {
    process.stdout.write(renderRuleCatalogue(undefined, options.format === 'json' ? 'json' : 'text', extraRules));
    return 0;
  }

  const section = fileConfig.lint;
  const ruleSettings = section?.rules ?? fileConfig.rules;

  const format: string =
    options.format ?? section?.format ?? fileConfig.format ?? 'text';
  const reporter = plugins.reporters.find((entry) => entry.format === format);
  if (!['text', 'json', 'html', 'sarif'].includes(format) && !reporter) {
    throw new UsageError(
      `invalid format "${format}" (expected text, json, html or sarif${plugins.reporters.length > 0 ? ` or a plugin reporter: ${plugins.reporters.map((entry) => entry.format).join(', ')}` : ''})`,
    );
  }
  // "--output -" is the conventional way to ask for stdout.
  const requested = options.output ?? section?.output ?? fileConfig.output;
  const output = requested === '-' ? undefined : requested;
  const severity: Severity = options.severity ?? section?.severity ?? fileConfig.severity ?? 'info';
  const failOn: FailOn = options.failOn ?? section?.failOn ?? fileConfig.failOn ?? 'error';
  const rules = options.rules && options.rules.length > 0 ? options.rules : ruleSettings?.only;
  const ignore = [...(ruleSettings?.ignore ?? []), ...(options.ignore ?? [])];
  const ruleLevels = ruleSettings?.levels;

  const unknown = [...(rules ?? []), ...Object.keys(ruleLevels ?? {})].filter(
    (id) => !findRule(id, extraRules),
  );
  if (unknown.length > 0) {
    throw new UsageError(
      `unknown rule${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}. Run "apicovenant rules" for the catalogue.`,
    );
  }

  const spec = await loadSpec(options.document);

  const result = lint(spec, { rules, ignore, minSeverity: severity, ruleLevels, extraRules, strictSchema: options.strictSchema });

  const baselinePath = options.noBaseline
    ? undefined
    : (options.baseline ?? section?.baseline ?? fileConfig.baseline);

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

  if (reporter) {
    try {
      report = reporter.render({
        summary: { total: findings.length, error: counts.error, warn: counts.warn, info: counts.info },
        findings,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`plugin reporter "${reporter.id}" (${reporter.source ?? 'unknown'}) failed: ${message}`);
    }
  } else if (format === 'json') {
    report = renderJsonReport({
      tool: TOOL_NAME,
      version: VERSION,
      document: spec.document,
      findings,
    });
  } else if (format === 'sarif') {
    const catalog = allRules(extraRules);
    const levelOf = (severity: Severity): SarifLevel =>
      severity === 'error' ? 'error' : severity === 'warn' ? 'warning' : 'note';
    report = renderSarif({
      tool: TOOL_NAME,
      version: VERSION,
      informationUri: 'https://github.com/YQteam-hq/apicovenant#readme',
      rules: catalog.map((rule) => ({
        id: rule.id,
        title: rule.title,
        description: rule.description,
        level: levelOf(rule.severity),
      })),
      results: findings.map((finding) => ({
        ruleId: finding.ruleId,
        level: levelOf(finding.severity),
        message: finding.message,
        uri: spec.document,
        location: finding.path,
      })),
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

/**
 * Applies the mechanical lint fixes. The default is a dry run that prints a
 * unified diff; --write persists the result. Semantic findings are untouched.
 */
async function runFix(options: LintCommandOptions): Promise<number> {
  if (options.watch) {
    throw new UsageError('--fix cannot be combined with --watch');
  }
  if (!options.document || options.document === '-') {
    throw new UsageError('--fix needs a file path; stdin cannot be rewritten');
  }

  const text = await readTextFile(options.document);
  const spec = await loadSpec(options.document);
  const fixed = applyFixes(text, spec, { aggressive: options.fixAggressive });

  if (fixed.changes.length === 0) {
    process.stdout.write(`${green('✓')} no fixable issues found\n`);
    return 0;
  }

  if (!options.write) {
    process.stdout.write(unifiedDiff(text, fixed.text, options.document, `${options.document} (fixed)`));
    const fixCount = fixed.changes.length;
    process.stdout.write(`${dim(String(fixCount) + ' fix' + (fixCount === 1 ? '' : 'es') + ' available; re-run with --write to apply')}\n`);
    return 0;
  }

  await writeTextFile(options.document, fixed.text);
  process.stdout.write(
    `${green('✓')} applied ${fixed.changes.length} fix${fixed.changes.length === 1 ? '' : 'es'} to ${bold(options.document)}\n`,
  );
  for (const change of fixed.changes) {
    process.stdout.write(`  ${dim(change.ruleId)} ${change.message}\n`);
  }
  return 0;
}

/**
 * Watch mode re-runs the linter on every change. The output is buffered per
 * pass so a parse failure can be reported without wiping the last good report;
 * the process stays alive until Ctrl+C.
 */
async function watchLint(options: LintCommandOptions): Promise<number> {
  const target = resolve(options.document);
  let running = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const runAndRender = async (): Promise<void> => {
    let buffer = '';
    const original = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      buffer += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      return true;
    }) as typeof process.stdout.write;
    try {
      await runLint({ ...options, watch: false });
    } finally {
      process.stdout.write = original;
    }
    // Clear only after a successful pass; a failed pass leaves the previous
    // report visible above the error message.
    process.stdout.write(`\x1b[2J\x1b[H${buffer}`);
  };

  const cycle = async (): Promise<void> => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      await runAndRender();
    } catch (error) {
      process.stderr.write(`\n${red('error')} ${describeError(error)}\n`);
      process.stderr.write(`${dim('keeping the previous result; watching for changes')}\n`);
    } finally {
      running = false;
      if (pending) {
        pending = false;
        void cycle();
      }
    }
  };

  // The first pass is not buffered: a broken document on startup should fail
  // like any other invocation instead of starting a watcher on nothing.
  await runLint({ ...options, watch: false });

  const onFileChange = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void cycle();
    }, 300);
  };
  // Stat polling is deliberately used instead of fs.watch: a watcher started in
  // a child process on a network or overlay filesystem otherwise misses
  // truncate-and-write replacements, which is exactly what editors do.
  watchFile(target, { interval: 300, persistent: true }, onFileChange);

  // Announce only after the watcher is armed, so a client that edits the file
  // as soon as it sees this line cannot race the first event.
  process.stdout.write(`\n${dim(`watching ${target} for changes (Ctrl+C to stop)`)}`);

  await new Promise<void>((resolveSignal) => {
    const stop = (): void => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      resolveSignal();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });

  clearTimeout(timer);
  unwatchFile(target, onFileChange);
  process.stdout.write(`\n${dim('watch stopped')}\n`);
  return 0;
}

export function renderRuleCatalogue(
  category?: string,
  format: 'text' | 'json' = 'text',
  extraRules: RuleDefinition[] = [],
): string {
  const rules = [...allRules(extraRules)].sort((a, b) => a.id.localeCompare(b.id));
  const selected = category ? rules.filter((rule) => rule.category === category) : rules;

  if (format === 'json') {
    return `${JSON.stringify(
      selected.map((rule) => ({
        id: rule.id,
        title: rule.title,
        severity: rule.severity,
        category: rule.category,
        description: rule.description,
        source: rule.source ?? 'builtin',
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
      if (rule.source) lines.push(`        ${dim(`plugin: ${rule.source}`)}`);
    }
    lines.push('');
  }

  lines.push(dim(`${selected.length} rules in ${byCategory.size} categories`));
  return lines.join('\n');
}
