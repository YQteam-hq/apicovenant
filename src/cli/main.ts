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
} from './help.ts';
import { UsageError, describeError, parseFailOn, parseInteger, parseSeverity, splitList } from './common.ts';
import { runLint, renderRuleCatalogue } from './commands/lint.ts';
import { runMock } from './commands/mock.ts';
import { runRecord } from './commands/record.ts';
import { runDiff } from './commands/diff.ts';
import { runInit } from './commands/init.ts';
import { runMcp } from './commands/mcp.ts';

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
  target: { type: 'string' },
  out: { type: 'string' },
  spec: { type: 'string' },
  golden: { type: 'string' },
  'max-requests': { type: 'string' },
  duration: { type: 'string' },
  'replay-all': { type: 'boolean' },
  header: { type: 'string', multiple: true, short: 'H' },
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
};

// Options each command accepts. A single global option table would silently
// swallow options that belong to a different command (e.g. "mock --baseline").
const COMMAND_OPTIONS: Record<string, readonly (keyof typeof OPTIONS)[]> = {
  lint: ['format', 'output', 'rules', 'ignore', 'severity', 'fail-on', 'list-rules',
         'config', 'baseline', 'update-baseline', 'no-baseline'],
  mock: ['port', 'host', 'latency'],
  record: ['target', 'out', 'spec', 'host', 'port', 'max-requests', 'duration'],
  diff: ['golden', 'target', 'spec', 'format', 'replay-all', 'fail-on', 'config', 'output', 'header'],
  rules: ['format', 'category'],
  init: ['output', 'force'],
  mcp: [],
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
          format: asString(values.format)
            ? (requireFormat(asString(values.format), ['text', 'json', 'html'], 'text') as
                | 'text'
                | 'json'
                | 'html')
            : undefined,
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
        });

      case 'mock':
        return await runMock({
          document: positionals[1] ?? '',
          host: asString(values.host) ?? '127.0.0.1',
          port: parseInteger(asString(values.port), 0, 'port'),
          latency: parseInteger(asString(values.latency), 0, 'latency'),
        });

      case 'record':
        return await runRecord({
          target: asString(values.target) ?? '',
          out: asString(values.out) ?? '',
          spec: asString(values.spec),
          host: asString(values.host) ?? '127.0.0.1',
          port: parseInteger(asString(values.port), 0, 'port'),
          maxRequests: asString(values['max-requests'])
            ? parseInteger(asString(values['max-requests']), 0, 'max-requests')
            : undefined,
          durationSeconds: asString(values.duration)
            ? parseInteger(asString(values.duration), 0, 'duration')
            : undefined,
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
          failOn: parseFailOn(asString(values['fail-on']), ['changed', 'never'] as const),
          config: asString(values.config),
          output: asString(values.output),
        });

      case 'rules': {
        const format = requireFormat(asString(values.format), ['text', 'json'], 'text');
        process.stdout.write(renderRuleCatalogue(asString(values.category), format as 'text' | 'json'));
        return 0;
      }

      case 'init':
        return await runInit({
          force: asBoolean(values.force),
          fileName: asString(values.output),
        });

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
