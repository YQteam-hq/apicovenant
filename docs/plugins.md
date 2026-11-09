# Plugins

Plugins add lint rules, reporters and presets without changing the core. They
are local JavaScript modules, run in the same process, and are loaded only when
the configuration names them.

> **Security:** plugins have no sandbox. They can read files, open sockets and
> access the environment. Only load code you trust, exactly as you would a
> script in your own repository.

## Writing a plugin

```ts
// team-plugin.mjs
import { defineRule, defineReporter, definePreset } from 'apicovenant/plugin';

export const noTodoSummary = defineRule({
  id: 'team-no-todo-summary',
  title: 'Summaries must not contain TODO',
  description: 'A TODO summary ships unfinished documentation.',
  severity: 'warn',
  category: 'operations',
  check({ spec, report }) {
    for (const operation of spec.operations) {
      if (operation.summary?.includes('TODO')) {
        report({
          message: `${operation.key} summary contains TODO`,
          path: operation.pointer,
          hint: 'Replace the TODO with the final summary.',
        });
      }
    }
  },
});

export const teamReporter = defineReporter({
  id: 'team-reporter',
  format: 'team',
  render(report) {
    return `team report: ${report.summary.total} findings\n`;
  },
});

export const teamPreset = definePreset({
  name: 'team',
  rules: ['team-no-todo-summary'],
  severity: 'warn',
});
```

`defineRule` receives the same `RuleContext` as the built-in rules:
`spec` is the normalized model and `report()` accepts a message, a JSON Pointer,
an optional operation and a hint. The rule's severity can be overridden per
project with rule-level configuration.

`defineReporter` registers a new `--format` value. `render(report)` receives:

```ts
{
  summary: { total: number; error: number; warn: number; info: number };
  findings: Array<{ ruleId; severity; message; path; operation?; hint? }>;
}
```

A reporter returns a string; the core writes it, so a plugin cannot choose a
file path or overwrite an unrelated file.

`definePreset` groups rules, severity, ignore entries and rule levels. A preset
name can be referenced from `extends` when the plugin is configured.

## Loading

```json
{
  "version": 2,
  "plugins": ["./team-plugin.mjs"],
  "extends": ["apicovenant:recommended", "team"]
}
```

Entries are local paths (absolute or relative to the working directory) or
installed package names. Remote installation is deliberately not supported.
`--no-plugins` disables the loader for a single command.

## Catalogue

`apicovenant rules` lists plugin rules with their `plugin:` source, and
`apicovenant rules --format json` adds a `source` field (`builtin` or the file
that contributed the rule).

## Errors

| Situation | Result |
| --- | --- |
| Module cannot be resolved or imported | Exit `3`; message names the specifier and resolved path |
| Module exports no `define*` value | Exit `3` |
| Rule id collides with a built-in rule | Exit `2`; no rule is overridden |
| Two plugins declare the same id/preset | Exit `3`; message names both |
| A rule or reporter throws | Exit `3`; message names the plugin file |

## Versioning

The API version is `pluginApi: 1`, exported as `PLUGIN_API_VERSION`. Additive
changes keep the version; an incompatible change moves it and is announced in
the changelog.
