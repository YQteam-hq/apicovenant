import { isAbsolute, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import type { RuleContext } from '../lint/types.ts';
import {
  isPluginValue,
  type PluginPreset,
  type PluginReporter,
  type PluginRule,
} from './api.ts';

export interface LoadedPlugins {
  sources: string[];
  rules: PluginRule[];
  reporters: PluginReporter[];
  presets: PluginPreset[];
}

function resolveSpecifier(specifier: string, cwd: string): string {
  if (isAbsolute(specifier)) return specifier;
  if (specifier.startsWith('.')) return resolve(cwd, specifier);
  // A bare specifier is a package installed next to the configuration file.
  // createRequire resolves it from the project, not from this file.
  const require = createRequire(resolve(cwd, '__apicovenant_plugin_resolver__.cjs'));
  return require.resolve(specifier);
}

function valuesOf(module: Record<string, unknown>): unknown[] {
  const values = Object.values(module);
  const fallback = module['default'];
  if (fallback !== undefined && !values.includes(fallback)) values.push(fallback);
  return values;
}

/**
 * Loads plugin modules from configuration. Plugins run in-process without a
 * sandbox, so callers must only point this at trusted local code.
 */
export async function loadPlugins(
  specifiers: string[],
  options: { cwd?: string } = {},
): Promise<LoadedPlugins> {
  const cwd = options.cwd ?? process.cwd();
  const loaded: LoadedPlugins = { sources: [], rules: [], reporters: [], presets: [] };
  const seen = new Map<string, string>();

  for (const specifier of specifiers) {
    let resolved: string;
    try {
      resolved = resolveSpecifier(specifier, cwd);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`failed to resolve plugin "${specifier}" from ${cwd}: ${message}`);
    }
    let module: Record<string, unknown>;
    try {
      module = (await import(pathToFileURL(resolved).href)) as Record<string, unknown>;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`failed to load plugin "${specifier}" (${resolved}): ${message}`);
    }

    const values = valuesOf(module).filter(isPluginValue);
    if (values.length === 0) {
      throw new Error(
        `plugin "${specifier}" (${resolved}) does not export any defineRule, defineReporter or definePreset value`,
      );
    }
    loaded.sources.push(resolved);

    for (const value of values) {
      const id = value.kind === 'preset' ? value.name : value.id;
      const key = `${value.kind}:${id}`;
      const previous = seen.get(key);
      if (previous !== undefined) {
        throw new Error(
          `plugin "${specifier}" declares ${value.kind} "${id}", which is already provided by ${previous}`,
        );
      }
      seen.set(key, resolved);

      if (value.kind === 'rule') {
        const rule = value;
        loaded.rules.push({
          ...rule,
          source: resolved,
          check(context: RuleContext) {
            try {
              rule.check(context);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              throw new Error(`plugin rule "${rule.id}" (${resolved}) failed: ${message}`);
            }
          },
        });
      } else if (value.kind === 'reporter') {
        loaded.reporters.push({ ...value, source: resolved });
      } else {
        loaded.presets.push({ ...value, source: resolved });
      }
    }
  }

  return loaded;
}

export type { PluginPreset, PluginReporter, PluginRule };
