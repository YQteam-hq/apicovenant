import type { RuleDefinition } from '../lint/types.ts';
import type { Finding, Severity } from '../lint/types.ts';

/** Incremented only on a breaking change to the plugin surface. */
export const PLUGIN_API_VERSION = 1;

export interface PluginRule extends RuleDefinition {
  pluginApi: typeof PLUGIN_API_VERSION;
  kind: 'rule';

  /** Set by the loader to the file that contributed the rule. */
  source?: string;
}

export interface PluginReport {
  summary: {
    total: number;
    error: number;
    warn: number;
    info: number;
  };
  findings: Finding[];
}

export interface PluginReporter {
  pluginApi: typeof PLUGIN_API_VERSION;
  kind: 'reporter';

  id: string;

  /** The value accepted by --format. */
  format: string;
  description?: string;

  /** Returns the rendered report; the core writes it, a plugin never does. */
  render(report: PluginReport): string;

  source?: string;
}

export interface PluginPreset {
  pluginApi: typeof PLUGIN_API_VERSION;
  kind: 'preset';

  name: string;
  description?: string;

  rules?: string[];
  severity?: Severity;
  ignore?: string[];
  levels?: Record<string, 'off' | Severity>;

  source?: string;
}

export type PluginValue = PluginRule | PluginReporter | PluginPreset;

function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._:/-]*$/i.test(value)) {
    throw new Error(`a plugin ${label} needs a non-empty identifier`);
  }
}

/**
 * Declares a lint rule. The rule runs with exactly the same RuleContext as the
 * built-in rules, so a plugin can report paths and hints the same way.
 */
export function defineRule(definition: RuleDefinition): PluginRule {
  assertId(definition.id, 'rule id');
  if (typeof definition.check !== 'function') {
    throw new Error(`plugin rule "${definition.id}" must define check()`);
  }
  return {
    ...definition,
    pluginApi: PLUGIN_API_VERSION,
    kind: 'rule',
  };
}

/**
 * Declares a reporter. "format" becomes a new --format value; the returned
 * string is written by the core so a plugin cannot choose a file path.
 */
export function defineReporter(
  definition: Omit<PluginReporter, 'pluginApi' | 'kind'>,
): PluginReporter {
  assertId(definition.id, 'reporter id');
  assertId(definition.format, 'reporter format');
  if (typeof definition.render !== 'function') {
    throw new Error(`plugin reporter "${definition.id}" must define render()`);
  }
  return {
    ...definition,
    pluginApi: PLUGIN_API_VERSION,
    kind: 'reporter',
  };
}

/** Declares a preset that configuration `extends` entries may reference. */
export function definePreset(
  definition: Omit<PluginPreset, 'pluginApi' | 'kind'>,
): PluginPreset {
  assertId(definition.name, 'preset name');
  return {
    ...definition,
    pluginApi: PLUGIN_API_VERSION,
    kind: 'preset',
  };
}

/** True for a value produced by one of the define* helpers. */
export function isPluginValue(value: unknown): value is PluginValue {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { pluginApi?: unknown; kind?: unknown };
  if (candidate.pluginApi !== PLUGIN_API_VERSION) return false;
  return candidate.kind === 'rule' || candidate.kind === 'reporter' || candidate.kind === 'preset';
}
