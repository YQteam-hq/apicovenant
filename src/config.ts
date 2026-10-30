import path from 'node:path';
import { existsSync } from 'node:fs';

import { parseYaml } from './yaml/parser.ts';
import { readTextFile } from './util/fs.ts';
import { isPlainObject } from './util/text.ts';
import type { Severity } from './lint/types.ts';

export type ReportFormat = 'text' | 'json' | 'html';
export type FailOn = 'error' | 'warn' | 'never';

export interface ApicovenantConfig {
  rules?: {

    ignore?: string[];

    only?: string[];
  };

  severity?: Severity;

  failOn?: FailOn;

  format?: ReportFormat;

  output?: string;

  baseline?: string;
}

export interface LoadedConfig {
  config: ApicovenantConfig;

  path?: string;
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

const TOP_LEVEL_KEYS = new Set(['rules', 'severity', 'failOn', 'format', 'output', 'baseline']);
const RULE_KEYS = new Set(['ignore', 'only']);
const SEVERITIES: Severity[] = ['error', 'warn', 'info'];
const FORMATS: ReportFormat[] = ['text', 'json', 'html'];
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
  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      throw new ConfigError(
        `${filePath}: unknown setting "${key}" (valid settings: ${[...TOP_LEVEL_KEYS].join(', ')})`,
      );
    }
  }

  const config: ApicovenantConfig = {};

  if (raw['rules'] !== undefined) {
    const rules = raw['rules'];
    if (!isPlainObject(rules)) {
      throw new ConfigError(`${filePath}: "rules" must be a mapping`);
    }
    for (const key of Object.keys(rules)) {
      if (!RULE_KEYS.has(key)) {
        throw new ConfigError(
          `${filePath}: unknown setting "rules.${key}" (valid settings: ${[...RULE_KEYS].join(', ')})`,
        );
      }
    }
    const section: { ignore?: string[]; only?: string[] } = {};
    if (rules['ignore'] !== undefined) {
      section.ignore = toStringList(rules['ignore'], `${filePath}: "rules.ignore"`);
    }
    if (rules['only'] !== undefined) {
      section.only = toStringList(rules['only'], `${filePath}: "rules.only"`);
    }
    config.rules = section;
  }

  if (raw['severity'] !== undefined) {
    const severity = String(raw['severity']);
    if (!SEVERITIES.includes(severity as Severity)) {
      throw new ConfigError(`${filePath}: "severity" must be one of ${SEVERITIES.join(', ')}`);
    }
    config.severity = severity as Severity;
  }

  if (raw['failOn'] !== undefined) {
    const failOn = String(raw['failOn']);
    if (!FAIL_ON.includes(failOn as FailOn)) {
      throw new ConfigError(`${filePath}: "failOn" must be one of ${FAIL_ON.join(', ')}`);
    }
    config.failOn = failOn as FailOn;
  }

  if (raw['format'] !== undefined) {
    const format = String(raw['format']);
    if (!FORMATS.includes(format as ReportFormat)) {
      throw new ConfigError(`${filePath}: "format" must be one of ${FORMATS.join(', ')}`);
    }
    config.format = format as ReportFormat;
  }

  if (raw['output'] !== undefined) config.output = String(raw['output']);
  if (raw['baseline'] !== undefined) config.baseline = String(raw['baseline']);

  return config;
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
    return { config: parseConfigFile(text, options.explicitPath), path: options.explicitPath };
  }

  const discovered = findConfigFile(cwd);
  if (discovered) {
    const text = await readTextFile(discovered);
    return {
      config: parseConfigFile(text, path.relative(cwd, discovered) || discovered),
      path: path.relative(cwd, discovered) || discovered,
    };
  }

  const packageJsonPath = path.join(cwd, 'package.json');
  try {
    const text = await readTextFile(packageJsonPath);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (isPlainObject(parsed['apicovenant'])) {
      return {
        config: validateConfig(parsed['apicovenant'] as Record<string, unknown>, 'package.json'),
        path: 'package.json',
      };
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
