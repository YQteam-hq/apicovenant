import { parseArgs } from 'node:util';

import { red } from '../util/ansi.ts';
import { VERSION } from '../version.ts';
import {
  DIFF_HELP,
  INIT_HELP,
  LINT_HELP,
  MAIN_HELP,
  MCP_HELP,
  MOCK_HELP,
  RECORD_HELP,
  RULES_HELP,
  BREAKING_HELP,
  COVERAGE_HELP,
  MIGRATE_HELP,
  TEST_HELP,
} from './help.ts';
import { UsageError, describeError, parseFailOn, parseInteger, parseSeverity, splitList } from './common.ts';
import { runLint, renderRuleCatalogue } from './commands/lint.ts';
import { runMock } from './commands/mock.ts';
import { runRecord } from './commands/record.ts';
import { runDiff } from './commands/diff.ts';
import { runInit } from './commands/init.ts';
import { runMcp } from './commands/mcp.ts';
import { runBreaking } from './commands/breaking.ts';
import { runCoverage } from './commands/coverage.ts';
import { runTest } from './commands/test.ts';
import { runMigrate } from './commands/migrate.ts';
import { loadConfig } from '../config.ts';
import { loadPlugins } from '../plugin/load.ts';
import { STRICT_RULES } from '../lint/rules/strict.ts';

const OPTIONS = {
  format: { type: 'string' },
  output: { type: 'string' },
  rules: { type: 'string' },
  ignore: { type: 'string' },
  severity: { type: 'string' },
  'fail-on': { type: 'string' },
  'list-rules': { type: 'boolean' },
  config: { type: 'string' },
  baseline: { type: 'string' },
  'update-baseline': { type: 'string' },
  'no-baseline': { type: 'boolean' },
  port: { type: 'string' },
  host: { type: 'string' },
  latency: { type: 'string' },
  strict: { type: 'boolean' },
  'strict-unknown': { type: 'boolean' },
  cors: { type: 'boolean' },
  'cors-origin': { type: 'string', multiple: true },
  watch: { type: 'boolean' },
  'max-body': { type: 'string' },
  'include-unsafe': { type: 'boolean' },
  'max-cases': { type: 'string' },
  'no-plugins': { type: 'boolean' },
  fix: { type: 'boolean' },
  write: { type: 'boolean' },
  'fix-aggressive': { type: 'boolean' },
  'strict-schema': { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  'config-version': { type: 'string' },
  target: { type: 'string' },
  out: { type: 'string' },
  spec: { type: 'string' },
  golden: { type: 'string' },
  'max-requests': { type: 'string' },
  duration: { type: 'string' },
  'replay-all': { type: 'boolean' },
  'compare-header': { type: 'string', multiple: true },
  'ignore-header': { type: 'string', multiple: true },
  'ignore-path': { type: 'string', multiple: true },
  base: { type: 'string' },
  head: { type: 'string' },
  'ignore-change': { type: 'string', multiple: true },
  min: { type: 'string' },
  'redact-header': { type: 'string', multiple: true },
  'redact-query': { type: 'string', multiple: true },
  header: { type: 'string', multiple: true, short: 'H' },
  query: { type: 'string', multiple: true },
  force: { type: 'boolean' },
  category: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

type ParsedValues = Partial<Record<keyof typeof OPTIONS, string | boolean | string[] | undefined>>;

function parse(argv: string[]): { values: ParsedValues; positionals: string[] } {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: OPTIONS,
    strict: true,
  });
  return { values: values as ParsedValues, positionals };
}

function asString(value: string | boolean | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asBoolean(value: string | boolean | string[] | undefined): boolean {
  return value === true;
}

function asStringArray(value: string | boolean | string[] | undefined): string[] | undefined {
  if (Array.isArray(value)) return value;
  return typeof value === 'string' ? [value] : undefined;
}

function parseHeaders(values: string[] | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const entry of values ?? []) {
    const separator = entry.indexOf(':');
    const name = separator === -1 ? '' : entry.slice(0, separator).trim();
    if (!name) {
      throw new UsageError(`invalid header "${entry}" (expected "Name: value")`);
    }
    headers[name] = entry.slice(separator + 1).trim();
  }
  return headers;
}

function parseQueries(values: string[] | undefined): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const entry of values ?? []) {
    const separator = entry.indexOf('=');
    const name = separator === -1 ? '' : entry.slice(0, separator).trim();
    if (!name) throw new UsageError(`invalid query parameter "${entry}" (expected "name=value")`);
    const value = entry.slice(separator + 1);
    const existing = query[name];
    if (existing === undefined) query[name] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else query[name] = [existing, value];
  }
  return query;
}

function requireFormat(value: string | undefined, allowed: string[], fallback: string): string {
  if (!value) return fallback;
  if (!allowed.includes(value)) {
    throw new UsageError(`invalid format "${value}" (expected ${allowed.join(' or ')})`);
  }
  return value;
}

const HELP_BY_COMMAND: Record<string, string> = {
  lint: LINT_HELP,
  mock: MOCK_HELP,
  record: RECORD_HELP,
  diff: DIFF_HELP,
  rules: RULES_HELP,
  init: INIT_HELP,
  mcp: MCP_HELP,
  breaking: BREAKING_HELP,
  coverage: COVERAGE_HELP,
  migrate: MIGRATE_HELP,
  test: TEST_HELP,
};

// Options each command accepts. A single global option table would silently
// swallow options that belong to a different command (e.g. "mock --baseline").
const COMMAND_OPTIONS: Record<string, readonly (keyof typeof OPTIONS)[]> = {
  lint: ['format', 'output', 'rules', 'ignore', 'severity', 'fail-on', 'list-rules',
         'config', 'baseline', 'update-baseline', 'no-baseline', 'no-plugins', 'watch',
         'fix', 'write', 'fix-aggressive', 'strict-schema', 'dry-run'],
  mock: ['port', 'host', 'latency', 'strict', 'strict-unknown', 'cors', 'cors-origin', 'watch', 'max-body', 'config'],
  record: ['target', 'out', 'spec', 'host', 'port', 'max-requests', 'duration', 'redact-header', 'redact-query'],
  diff: ['golden', 'target', 'spec', 'format', 'replay-all', 'fail-on', 'config', 'output', 'header',
         'query', 'compare-header', 'ignore-header', 'ignore-path'],
  rules: ['format', 'category', 'config', 'no-plugins', 'strict'],
  init: ['output', 'force', 'config-version'],
  mcp: [],
  breaking: ['base', 'head', 'format', 'output', 'fail-on', 'ignore-change', 'config'],
  coverage: ['golden', 'spec', 'format', 'output', 'min', 'fail-on', 'config'],
  migrate: ['config', 'golden', 'output', 'dry-run', 'force'],
  test: ['target', 'include-unsafe', 'fail-on', 'format', 'output', 'max-cases', 'config'],
};

// Accepted everywhere, on every command.
const GLOBAL_OPTIONS = new Set<keyof typeof OPTIONS>(['help', 'version']);


export async function run(argv: string[]): Promise<number> {
  let parsed: { values: ParsedValues; positionals: string[] };

  try {
    parsed = parse(argv);
  } catch (error) {
    process.stderr.write(`${red('error')} ${describeError(error)}\n\n${MAIN_HELP}`);
    return 2;
  }

  const { values, positionals } = parsed;
  const command = positionals[0];

  if (asBoolean(values.version)) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  if (!command || asBoolean(values.help)) {
    process.stdout.write((command && HELP_BY_COMMAND[command]) ?? MAIN_HELP);
    return 0;
  }

  try {
    const allowedOptions = COMMAND_OPTIONS[command];
    if (allowedOptions) {
      for (const key of Object.keys(values) as (keyof typeof OPTIONS)[]) {
        if (values[key] === undefined) continue;
        if (GLOBAL_OPTIONS.has(key) || allowedOptions.includes(key)) continue;
        throw new UsageError(`option --${key} is not valid for the "${command}" command`);
      }
    }

    switch (command) {
      case 'lint':
        return await runLint({
          document: positionals[1] ?? '',
          format: asString(values.format),
          output: asString(values.output),
          rules: splitList(asString(values.rules)),
          ignore: splitList(asString(values.ignore)),
          severity: asString(values.severity)
            ? parseSeverity(asString(values.severity), 'info')
            : undefined,
          failOn: parseFailOn(asString(values['fail-on']), ['error', 'warn', 'never'] as const),
          listRules: asBoolean(values['list-rules']),
          config: asString(values.config),
          baseline: asString(values.baseline),
          updateBaseline: asString(values['update-baseline']),
          noBaseline: asBoolean(values['no-baseline']),
          noPlugins: asBoolean(values['no-plugins']),
          watch: asBoolean(values.watch),
          fix: asBoolean(values.fix),
          write: asBoolean(values.write),
          fixAggressive: asBoolean(values['fix-aggressive']),
          strictSchema: asBoolean(values['strict-schema']),
        });

      case 'mock':
        return await runMock({
          document: positionals[1] ?? '',
          host: asString(values.host) ?? '127.0.0.1',
          port: parseInteger(asString(values.port), 0, 'port', 0, 65535),
          latency: parseInteger(asString(values.latency), 0, 'latency', 0, 600_000),
          strict: asBoolean(values.strict),
          strictUnknown: asBoolean(values['strict-unknown']),
          cors: asBoolean(values.cors),
          corsOrigins: asStringArray(values['cors-origin']),
          watch: asBoolean(values.watch),
          maxBody: asString(values['max-body']) !== undefined
            ? parseInteger(asString(values['max-body']), 0, 'max-body', 1)
            : undefined,
          config: asString(values.config),
        });

      case 'record':
        return await runRecord({
          target: asString(values.target) ?? '',
          out: asString(values.out) ?? '',
          spec: asString(values.spec),
          host: asString(values.host) ?? '127.0.0.1',
          port: parseInteger(asString(values.port), 0, 'port', 0, 65535),
          maxRequests: asString(values['max-requests'])
            ? parseInteger(asString(values['max-requests']), 0, 'max-requests', 1)
            : undefined,
          durationSeconds: asString(values.duration)
            ? parseInteger(asString(values.duration), 0, 'duration', 1)
            : undefined,
          redactHeaders: asStringArray(values['redact-header']),
          redactQueries: asStringArray(values['redact-query']),
        });

      case 'diff':
        return await runDiff({
          golden: asString(values.golden) ?? '',
          target: asString(values.target),
          spec: asString(values.spec),
          format: asString(values.format)
            ? (requireFormat(asString(values.format), ['text', 'json', 'html'], 'text') as
                | 'text'
                | 'json'
                | 'html')
            : undefined,
          replayAll: asBoolean(values['replay-all']),
          headers: parseHeaders(asStringArray(values.header)),
          query: parseQueries(asStringArray(values.query)),
          compareHeaders: asStringArray(values['compare-header']),
          ignoreHeaders: asStringArray(values['ignore-header']),
          ignorePaths: asStringArray(values['ignore-path']),
          failOn: parseFailOn(asString(values['fail-on']), ['changed', 'never'] as const),
          config: asString(values.config),
          output: asString(values.output),
        });

      case 'breaking':
        return await runBreaking({
          base: asString(values.base) ?? '',
          head: asString(values.head) ?? '',
          format: asString(values.format)
            ? (requireFormat(asString(values.format), ['text', 'json', 'sarif'], 'text') as
                | 'text'
                | 'json'
                | 'sarif')
            : undefined,
          output: asString(values.output),
          failOn: parseFailOn(asString(values['fail-on']), ['breaking', 'risky', 'any', 'never'] as const),
          ignoreChanges: asStringArray(values['ignore-change']),
          config: asString(values.config),
        });

      case 'coverage':
        return await runCoverage({
          golden: asString(values.golden) ?? '',
          spec: asString(values.spec) ?? '',
          format: asString(values.format)
            ? (requireFormat(asString(values.format), ['text', 'json', 'sarif'], 'text') as
                | 'text'
                | 'json'
                | 'sarif')
            : undefined,
          output: asString(values.output),
          min: asString(values.min) !== undefined
            ? parseInteger(asString(values.min), 0, 'min', 0, 100)
            : undefined,
          failOn: parseFailOn(asString(values['fail-on']), ['gap', 'undocumented', 'never'] as const),
          config: asString(values.config),
        });

      case 'migrate':
        return await runMigrate({
          config: asString(values.config),
          golden: asString(values.golden),
          output: asString(values.output),
          dryRun: asBoolean(values['dry-run']),
          force: asBoolean(values.force),
        });

      case 'test':
        return await runTest({
          document: positionals[1] ?? '',
          target: asString(values.target),
          includeUnsafe: asBoolean(values['include-unsafe']),
          failOn: parseFailOn(asString(values['fail-on']), ['failure', 'never'] as const),
          format: asString(values.format)
            ? (requireFormat(asString(values.format), ['text', 'json', 'junit', 'sarif'], 'text') as
                | 'text'
                | 'json'
                | 'junit'
                | 'sarif')
            : undefined,
          output: asString(values.output),
          maxCases: asString(values['max-cases']) !== undefined
            ? parseInteger(asString(values['max-cases']), 0, 'max-cases', 1)
            : undefined,
          config: asString(values.config),
        });

      case 'rules': {
        const format = requireFormat(asString(values.format), ['text', 'json'], 'text');
        const loaded = await loadConfig({ explicitPath: asString(values.config) });
        const plugins = asBoolean(values['no-plugins'])
          ? []
          : (await loadPlugins(loaded.config.plugins ?? [])).rules;
        const extra = loaded.config.strictRules || asBoolean(values.strict) ? STRICT_RULES : [];
        process.stdout.write(renderRuleCatalogue(asString(values.category), format as 'text' | 'json', [...plugins, ...extra]));
        return 0;
      }

      case 'init': {
        const requestedVersion = asString(values['config-version']);
        if (requestedVersion !== undefined && requestedVersion !== '1' && requestedVersion !== '2') {
          throw new UsageError('--config-version must be 1 or 2');
        }
        return await runInit({
          force: asBoolean(values.force),
          fileName: asString(values.output),
          configVersion: requestedVersion === '1' ? 1 : 2,
        });
      }

      case 'mcp':
        return await runMcp();

      default:
        process.stderr.write(`${red('error')} unknown command "${command}"\n\n${MAIN_HELP}`);
        return 2;
    }
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${red('error')} ${error.message}\n`);
      return 2;
    }
    process.stderr.write(`${red('error')} ${describeError(error)}\n`);
    return 3;
  }
}


export async function main(): Promise<void> {
  const code = await run(process.argv.slice(2));
  process.exitCode = code;
}
