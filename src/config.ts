import path from 'node:path';
import { existsSync } from 'node:fs';

import { parseYaml } from './yaml/parser.ts';
import { readTextFile } from './util/fs.ts';
import { isPlainObject } from './util/text.ts';
import type { Severity } from './lint/types.ts';

export type ReportFormat = 'text' | 'json' | 'html' | 'sarif' | 'junit';
export type FailOn = 'error' | 'warn' | 'never';

/** How a single rule is configured in a v2 file. */
export type RuleLevel = 'off' | 'info' | 'warn' | 'error';

export const RULE_LEVELS: RuleLevel[] = ['off', 'info', 'warn', 'error'];

export interface RuleSettings {
  ignore?: string[];
  only?: string[];

  /** Rule id → level overrides. "off" disables the rule. */
  levels?: Record<string, RuleLevel>;
}

export interface LintSection {
  rules?: RuleSettings;
  severity?: Severity;
  failOn?: FailOn;
  baseline?: string;
  format?: ReportFormat;
  output?: string;
}

export interface DiffSection {
  compareHeaders?: string[];
  ignoreHeaders?: string[];
  ignorePaths?: string[];
  failOn?: 'changed' | 'never';
  format?: ReportFormat;
  output?: string;
}

export interface BreakingSection {
  failOn?: 'breaking' | 'risky' | 'any' | 'never';
  ignoreChanges?: string[];
  format?: ReportFormat;
  output?: string;
}

export interface CoverageSection {
  min?: number;
  failOn?: 'gap' | 'undocumented' | 'never';
  format?: ReportFormat;
  output?: string;
}

export interface MockSection {
  strict?: boolean;
  strictUnknown?: boolean;
  cors?: boolean | string[];
  watch?: boolean;
  maxBody?: number;
}

export interface TestSection {
  includeUnsafe?: boolean;
  failOn?: 'failure' | 'never';
  format?: ReportFormat;
  output?: string;
  maxCases?: number;
}

/**
 * A configuration file. The v1 keys stay at the top level so that every
 * document written before 1.1.0 keeps loading unchanged; v2 adds one section
 * per command and an "extends" list.
 */
export interface ApicovenantConfig {
  version?: 2;
  extends?: string[];

  rules?: RuleSettings;

  severity?: Severity;

  failOn?: FailOn;

  format?: ReportFormat;

  output?: string;

  baseline?: string;

  lint?: LintSection;
  diff?: DiffSection;
  breaking?: BreakingSection;
  coverage?: CoverageSection;
  mock?: MockSection;
  test?: TestSection;
  plugins?: string[];

  /** Internal marker set by "extends: [apicovenant:strict]"; not a file key. */
  strictRules?: boolean;
}

export interface LoadedConfig {
  config: ApicovenantConfig;

  path?: string;

  /** True when the file was written in the v1 layout. */
  legacy?: boolean;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const CONFIG_FILE_NAMES = [
  'apicovenant.config.json',
  'apicovenant.config.yaml',
  'apicovenant.config.yml',
  '.apicovenantrc.json',
  '.apicovenantrc.yaml',
  '.apicovenantrc.yml',
];

const V2_SECTIONS = ['lint', 'diff', 'breaking', 'coverage', 'mock', 'test'] as const;
const V2_TOP_LEVEL = new Set([
  'version',
  'extends',
  'rules',
  'severity',
  'failOn',
  'format',
  'output',
  'baseline',
  ...V2_SECTIONS,
  'plugins',
]);
const V1_TOP_LEVEL = new Set(['rules', 'severity', 'failOn', 'format', 'output', 'baseline']);
const RULE_KEYS = new Set(['ignore', 'only']);
const SEVERITIES: Severity[] = ['error', 'warn', 'info'];
const V1_FORMATS: ReportFormat[] = ['text', 'json', 'html'];
const FORMATS: ReportFormat[] = ['text', 'json', 'html', 'sarif', 'junit'];
const FAIL_ON: FailOn[] = ['error', 'warn', 'never'];


export function findConfigFile(cwd = process.cwd()): string | undefined {
  for (const name of CONFIG_FILE_NAMES) {
    const candidate = path.join(cwd, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}


export function parseConfigFile(text: string, filePath: string): ApicovenantConfig {
  const extension = path.extname(filePath).toLowerCase();
  let parsed: unknown;

  if (extension === '.yaml' || extension === '.yml') {
    parsed = parseYaml(text);
  } else {
    try {

      const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
      parsed = JSON.parse(source);
    } catch (error) {
      throw new ConfigError(`${filePath}: invalid JSON (${(error as Error).message})`);
    }
  }

  if (!isPlainObject(parsed)) {
    throw new ConfigError(`${filePath}: the configuration must be a mapping`);
  }
  return validateConfig(parsed, filePath);
}

function validateConfig(raw: Record<string, unknown>, filePath: string): ApicovenantConfig {
  const rawVersion = raw['version'];
  if (rawVersion !== undefined && rawVersion !== 1 && rawVersion !== 2) {
    throw new ConfigError(`${filePath}: "version" must be 1 or 2`);
  }
  if (rawVersion === 2 || V2_SECTIONS.some((section) => raw[section] !== undefined)) {
    return validateV2(raw, filePath);
  }
  return validateV1(raw, filePath);
}

function validateV1(raw: Record<string, unknown>, filePath: string): ApicovenantConfig {
  for (const key of Object.keys(raw)) {
    if (!V1_TOP_LEVEL.has(key)) {
      throw new ConfigError(
        `${filePath}: unknown setting "${key}" (valid settings: ${[...V1_TOP_LEVEL].join(', ')})`,
      );
    }
  }

  const config: ApicovenantConfig = {};

  if (raw['rules'] !== undefined) {
    config.rules = parseRuleSettings(raw['rules'], `${filePath}: "rules"`, false);
  }
  if (raw['severity'] !== undefined) config.severity = parseSeverityValue(raw['severity'], `${filePath}: "severity"`);
  if (raw['failOn'] !== undefined) config.failOn = parseFailOnValue(raw['failOn'], `${filePath}: "failOn"`, FAIL_ON);
  if (raw['format'] !== undefined) config.format = parseFormat(raw['format'], `${filePath}: "format"`, V1_FORMATS);
  if (raw['output'] !== undefined) config.output = String(raw['output']);
  if (raw['baseline'] !== undefined) config.baseline = String(raw['baseline']);

  return config;
}

function validateV2(raw: Record<string, unknown>, filePath: string): ApicovenantConfig {
  for (const key of Object.keys(raw)) {
    if (!V2_TOP_LEVEL.has(key)) {
      throw new ConfigError(
        `${filePath}: unknown setting "${key}" (valid settings: ${[...V2_TOP_LEVEL].join(', ')})`,
      );
    }
  }

  const config: ApicovenantConfig = { version: 2 };

  if (raw['extends'] !== undefined) config.extends = toStringList(raw['extends'], `${filePath}: "extends"`);
  if (raw['plugins'] !== undefined) config.plugins = toStringList(raw['plugins'], `${filePath}: "plugins"`);
  if (raw['rules'] !== undefined) config.rules = parseRuleSettings(raw['rules'], `${filePath}: "rules"`, true);
  if (raw['severity'] !== undefined) config.severity = parseSeverityValue(raw['severity'], `${filePath}: "severity"`);
  if (raw['failOn'] !== undefined) config.failOn = parseFailOnValue(raw['failOn'], `${filePath}: "failOn"`, FAIL_ON);
  if (raw['format'] !== undefined) config.format = parseFormat(raw['format'], `${filePath}: "format"`, FORMATS);
  if (raw['output'] !== undefined) config.output = String(raw['output']);
  if (raw['baseline'] !== undefined) config.baseline = String(raw['baseline']);

  if (raw['lint'] !== undefined) config.lint = parseLintSection(raw['lint'], `${filePath}: "lint"`);
  if (raw['diff'] !== undefined) config.diff = parseDiffSection(raw['diff'], `${filePath}: "diff"`);
  if (raw['breaking'] !== undefined) config.breaking = parseBreakingSection(raw['breaking'], `${filePath}: "breaking"`);
  if (raw['coverage'] !== undefined) config.coverage = parseCoverageSection(raw['coverage'], `${filePath}: "coverage"`);
  if (raw['mock'] !== undefined) config.mock = parseMockSection(raw['mock'], `${filePath}: "mock"`);
  if (raw['test'] !== undefined) config.test = parseTestSection(raw['test'], `${filePath}: "test"`);

  return config;
}

function parseRuleSettings(value: unknown, label: string, allowLevels: boolean): RuleSettings {
  if (!isPlainObject(value)) throw new ConfigError(`${label} must be a mapping`);
  const section: RuleSettings = {};
  const levels: Record<string, RuleLevel> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (key === 'ignore' || key === 'only') {
      if (!Array.isArray(entry)) throw new ConfigError(`${label}.${key} must be a list of strings`);
      const list = toStringList(entry, `${label}.${key}`);
      if (key === 'ignore') section.ignore = list;
      else section.only = list;
      continue;
    }
    if (!allowLevels) {
      const setting = label.includes('"') ? label.slice(label.indexOf('"') + 1, label.lastIndexOf('"')) : label;
      throw new ConfigError(`${label}: unknown setting "${setting}.${key}" (valid settings: ignore, only)`);
    }
    if (typeof entry !== 'string' || !RULE_LEVELS.includes(entry as RuleLevel)) {
      throw new ConfigError(`${label}.${key} must be one of ${RULE_LEVELS.join(', ')}`);
    }
    levels[key] = entry as RuleLevel;
  }

  if (Object.keys(levels).length > 0) section.levels = levels;
  return section;
}

function parseLintSection(value: unknown, label: string): LintSection {
  const raw = requireMapping(value, label);
  const allowed = new Set(['rules', 'severity', 'failOn', 'baseline', 'format', 'output']);
  assertKeys(raw, allowed, label);
  const section: LintSection = {};
  if (raw['rules'] !== undefined) section.rules = parseRuleSettings(raw['rules'], `${label}.rules`, true);
  if (raw['severity'] !== undefined) section.severity = parseSeverityValue(raw['severity'], `${label}.severity`);
  if (raw['failOn'] !== undefined) section.failOn = parseFailOnValue(raw['failOn'], `${label}.failOn`, FAIL_ON);
  if (raw['baseline'] !== undefined) section.baseline = String(raw['baseline']);
  if (raw['format'] !== undefined) section.format = parseFormat(raw['format'], `${label}.format`, FORMATS);
  if (raw['output'] !== undefined) section.output = String(raw['output']);
  return section;
}

function parseDiffSection(value: unknown, label: string): DiffSection {
  const raw = requireMapping(value, label);
  assertKeys(raw, new Set(['compareHeaders', 'ignoreHeaders', 'ignorePaths', 'failOn', 'format', 'output']), label);
  const section: DiffSection = {};
  if (raw['compareHeaders'] !== undefined) {
    section.compareHeaders = toStringList(raw['compareHeaders'], `${label}.compareHeaders`);
  }
  if (raw['ignoreHeaders'] !== undefined) {
    section.ignoreHeaders = toStringList(raw['ignoreHeaders'], `${label}.ignoreHeaders`);
  }
  if (raw['ignorePaths'] !== undefined) section.ignorePaths = toStringList(raw['ignorePaths'], `${label}.ignorePaths`);
  if (raw['failOn'] !== undefined) {
    section.failOn = parseFailOnValue(raw['failOn'], `${label}.failOn`, ['changed', 'never'] as const);
  }
  if (raw['format'] !== undefined) section.format = parseFormat(raw['format'], `${label}.format`, FORMATS);
  if (raw['output'] !== undefined) section.output = String(raw['output']);
  return section;
}

function parseBreakingSection(value: unknown, label: string): BreakingSection {
  const raw = requireMapping(value, label);
  assertKeys(raw, new Set(['failOn', 'ignoreChanges', 'format', 'output']), label);
  const section: BreakingSection = {};
  if (raw['failOn'] !== undefined) {
    section.failOn = parseFailOnValue(
      raw['failOn'],
      `${label}.failOn`,
      ['breaking', 'risky', 'any', 'never'] as const,
    );
  }
  if (raw['ignoreChanges'] !== undefined) {
    section.ignoreChanges = toStringList(raw['ignoreChanges'], `${label}.ignoreChanges`);
  }
  if (raw['format'] !== undefined) section.format = parseFormat(raw['format'], `${label}.format`, FORMATS);
  if (raw['output'] !== undefined) section.output = String(raw['output']);
  return section;
}

function parseCoverageSection(value: unknown, label: string): CoverageSection {
  const raw = requireMapping(value, label);
  assertKeys(raw, new Set(['min', 'failOn', 'format', 'output']), label);
  const section: CoverageSection = {};
  if (raw['min'] !== undefined) {
    const min = raw['min'];
    if (typeof min !== 'number' || !Number.isInteger(min) || min < 0 || min > 100) {
      throw new ConfigError(`${label}.min must be an integer from 0 to 100`);
    }
    section.min = min;
  }
  if (raw['failOn'] !== undefined) {
    section.failOn = parseFailOnValue(raw['failOn'], `${label}.failOn`, ['gap', 'undocumented', 'never'] as const);
  }
  if (raw['format'] !== undefined) section.format = parseFormat(raw['format'], `${label}.format`, FORMATS);
  if (raw['output'] !== undefined) section.output = String(raw['output']);
  return section;
}

function parseMockSection(value: unknown, label: string): MockSection {
  const raw = requireMapping(value, label);
  assertKeys(raw, new Set(['strict', 'strictUnknown', 'cors', 'watch', 'maxBody']), label);
  const section: MockSection = {};
  if (raw['strict'] !== undefined) section.strict = requireBoolean(raw['strict'], `${label}.strict`);
  if (raw['strictUnknown'] !== undefined) {
    section.strictUnknown = requireBoolean(raw['strictUnknown'], `${label}.strictUnknown`);
  }
  if (raw['watch'] !== undefined) section.watch = requireBoolean(raw['watch'], `${label}.watch`);
  if (raw['cors'] !== undefined) {
    if (typeof raw['cors'] === 'boolean') section.cors = raw['cors'];
    else section.cors = toStringList(raw['cors'], `${label}.cors`);
  }
  if (raw['maxBody'] !== undefined) {
    const maxBody = raw['maxBody'];
    if (typeof maxBody !== 'number' || !Number.isInteger(maxBody) || maxBody < 1) {
      throw new ConfigError(`${label}.maxBody must be a positive integer`);
    }
    section.maxBody = maxBody;
  }
  return section;
}

function parseTestSection(value: unknown, label: string): TestSection {
  const raw = requireMapping(value, label);
  assertKeys(raw, new Set(['includeUnsafe', 'failOn', 'format', 'output', 'maxCases']), label);
  const section: TestSection = {};
  if (raw['includeUnsafe'] !== undefined) {
    section.includeUnsafe = requireBoolean(raw['includeUnsafe'], `${label}.includeUnsafe`);
  }
  if (raw['failOn'] !== undefined) {
    section.failOn = parseFailOnValue(raw['failOn'], `${label}.failOn`, ['failure', 'never'] as const);
  }
  if (raw['format'] !== undefined) section.format = parseFormat(raw['format'], `${label}.format`, FORMATS);
  if (raw['output'] !== undefined) section.output = String(raw['output']);
  if (raw['maxCases'] !== undefined) {
    const maxCases = raw['maxCases'];
    if (typeof maxCases !== 'number' || !Number.isInteger(maxCases) || maxCases < 1) {
      throw new ConfigError(`${label}.maxCases must be a positive integer`);
    }
    section.maxCases = maxCases;
  }
  return section;
}

function requireMapping(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) throw new ConfigError(`${label} must be a mapping`);
  return value;
}

function assertKeys(raw: Record<string, unknown>, allowed: Set<string>, label: string): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      throw new ConfigError(`${label}: unknown setting "${key}" (valid settings: ${[...allowed].join(', ')})`);
    }
  }
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new ConfigError(`${label} must be true or false`);
  return value;
}

function parseSeverityValue(value: unknown, label: string): Severity {
  const severity = String(value);
  if (!SEVERITIES.includes(severity as Severity)) {
    throw new ConfigError(`${label} must be one of ${SEVERITIES.join(', ')}`);
  }
  return severity as Severity;
}

function parseFailOnValue<T extends string>(value: unknown, label: string, allowed: readonly T[]): T {
  const mode = String(value);
  if (!allowed.includes(mode as T)) {
    throw new ConfigError(`${label} must be one of ${allowed.join(', ')}`);
  }
  return mode as T;
}

function parseFormat(value: unknown, label: string, allowed: ReportFormat[]): ReportFormat {
  const format = String(value);
  if (!allowed.includes(format as ReportFormat)) {
    throw new ConfigError(`${label} must be one of ${allowed.join(', ')}`);
  }
  return format as ReportFormat;
}

function toStringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new ConfigError(`${label} must be a list of strings`);
  }
  return value.map((entry) => {
    if (typeof entry !== 'string') {
      throw new ConfigError(`${label} must be a list of strings`);
    }
    return entry;
  });
}


const BUILTIN_PRESETS = new Set(['apicovenant:recommended', 'apicovenant:strict']);

/**
 * Presets are applied in order, then the document's own settings override
 * them. "apicovenant:recommended" is the default 43-rule set, so it needs no
 * data; "apicovenant:strict" is reserved for the opt-in rule pack.
 */
async function resolveExtends(
  config: ApicovenantConfig,
  baseDir: string,
  depth = 0,
): Promise<ApicovenantConfig> {
  if (!config.extends || config.extends.length === 0) return config;
  if (depth > 5) throw new ConfigError('"extends" is nested too deeply (limit: 5)');

  let merged: ApicovenantConfig = {};
  const deferred: string[] = [];
  for (const name of config.extends) {
    if (BUILTIN_PRESETS.has(name)) {
      if (name === 'apicovenant:strict') {
        merged = mergeConfigs(merged, { strictRules: true });
      }
      continue;
    }
    const target = path.resolve(baseDir, name);
    let text: string;
    try {
      text = await readTextFile(target);
    } catch (error) {
      // A plugin preset is not a file. When plugins are configured, keep the
      // name for applyPluginPresets(); otherwise it is a missing file preset.
      if (config.plugins && config.plugins.length > 0 && (error as { code?: string }).code === 'ENOENT') {
        deferred.push(name);
        continue;
      }
      throw new ConfigError(`preset not found: ${name} (built-in presets: ${[...BUILTIN_PRESETS].join(', ')})`);
    }
    const preset = await resolveExtends(parseConfigFile(text, name), path.dirname(target), depth + 1);
    merged = mergeConfigs(merged, preset);
  }

  const own: ApicovenantConfig = { ...config };
  delete own.extends;
  const result = mergeConfigs(merged, own);
  if (deferred.length > 0) result.extends = deferred;
  return result;
}

function mergeConfigs(base: ApicovenantConfig, override: ApicovenantConfig): ApicovenantConfig {
  const out: ApicovenantConfig = { ...base, ...override };
  if (base.lint || override.lint) out.lint = { ...base.lint, ...override.lint };
  if (base.diff || override.diff) out.diff = { ...base.diff, ...override.diff };
  if (base.breaking || override.breaking) out.breaking = { ...base.breaking, ...override.breaking };
  if (base.coverage || override.coverage) out.coverage = { ...base.coverage, ...override.coverage };
  if (base.mock || override.mock) out.mock = { ...base.mock, ...override.mock };
  if (base.test || override.test) out.test = { ...base.test, ...override.test };

  if (base.rules || override.rules) {
    const rules: RuleSettings = { ...base.rules, ...override.rules };
    const levels = { ...(base.rules?.levels ?? {}), ...(override.rules?.levels ?? {}) };
    if (Object.keys(levels).length > 0) rules.levels = levels;
    out.rules = rules;
  }
  if (base.lint?.rules || override.lint?.rules) {
    const rules: RuleSettings = { ...base.lint?.rules, ...override.lint?.rules };
    const levels = { ...(base.lint?.rules?.levels ?? {}), ...(override.lint?.rules?.levels ?? {}) };
    if (Object.keys(levels).length > 0) rules.levels = levels;
    out.lint = { ...out.lint, rules };
  }
  return out;
}

/**
 * Applies presets contributed by plugins. resolveExtends() defers names that
 * are not files when the configuration lists plugins; this second pass turns
 * those names into rule settings once the plugins are loaded.
 */
export function applyPluginPresets(
  config: ApicovenantConfig,
  presets: Array<{
    name: string;
    rules?: string[];
    ignore?: string[];
    severity?: Severity;
    levels?: Record<string, 'off' | Severity>;
  }>,
): ApicovenantConfig {
  const names = config.extends ?? [];
  if (names.length === 0) return config;

  let merged: ApicovenantConfig = {};
  const missing: string[] = [];
  for (const name of names) {
    const preset = presets.find((entry) => entry.name === name);
    if (!preset) {
      missing.push(name);
      continue;
    }
    merged = mergeConfigs(merged, {
      lint: {
        severity: preset.severity,
        rules: {
          only: preset.rules,
          ignore: preset.ignore,
          levels: preset.levels,
        },
      },
    });
  }

  if (missing.length > 0) {
    throw new ConfigError(`preset not found: ${missing.join(', ')}`);
  }

  const own: ApicovenantConfig = { ...config };
  delete own.extends;
  return mergeConfigs(merged, own);
}


export async function loadConfig(
  options: { explicitPath?: string; cwd?: string } = {},
): Promise<LoadedConfig> {
  const cwd = options.cwd ?? process.cwd();

  if (options.explicitPath) {
    const target = path.resolve(cwd, options.explicitPath);
    let text: string;
    try {
      text = await readTextFile(target);
    } catch {
      throw new ConfigError(`configuration file not found: ${options.explicitPath}`);
    }
    const parsed = parseConfigFile(text, options.explicitPath);
    const config = await resolveExtends(parsed, path.dirname(target));
    return { config, path: options.explicitPath, legacy: parsed.version !== 2 };
  }

  const discovered = findConfigFile(cwd);
  if (discovered) {
    const text = await readTextFile(discovered);
    const relative = path.relative(cwd, discovered) || discovered;
    const parsed = parseConfigFile(text, relative);
    const config = await resolveExtends(parsed, path.dirname(discovered));
    return { config, path: relative, legacy: parsed.version !== 2 };
  }

  const packageJsonPath = path.join(cwd, 'package.json');
  try {
    const text = await readTextFile(packageJsonPath);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (isPlainObject(parsed['apicovenant'])) {
      const config = validateConfig(parsed['apicovenant'] as Record<string, unknown>, 'package.json');
      const resolved = await resolveExtends(config, cwd);
      return { config: resolved, path: 'package.json', legacy: config.version !== 2 };
    }
  } catch {
    // No package.json, or it is not valid JSON. Not an error.
  }

  return { config: {} };
}


export const DEFAULT_CONFIG: ApicovenantConfig = {
  rules: { ignore: [], only: [] },
  severity: 'info',
  failOn: 'error',
  format: 'text',
};

/**
 * Coerces a v1 document into the v2 layout, used by "apicovenant migrate".
 * Keys the v1 format cannot express stay absent instead of being invented.
 */
export function toConfigV2(config: ApicovenantConfig): ApicovenantConfig {
  if (config.version === 2) return config;
  const lint: LintSection = {};
  if (config.rules) lint.rules = config.rules;
  if (config.severity) lint.severity = config.severity;
  if (config.failOn) lint.failOn = config.failOn;
  if (config.baseline) lint.baseline = config.baseline;
  if (config.format && V1_FORMATS.includes(config.format)) lint.format = config.format as ReportFormat;
  if (config.output) lint.output = config.output;

  const out: ApicovenantConfig = { version: 2 };
  if (Object.keys(lint).length > 0) out.lint = lint;
  return out;
}
