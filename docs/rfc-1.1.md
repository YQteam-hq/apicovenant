# 1.1 architecture RFCs

Three decisions made the 1.1.0 platform work: a versioned plugin surface, a
command-scoped configuration model, and a report pipeline that can feed GitHub
code scanning and JUnit test reporters. This file records the decisions and the
compatibility boundaries they rely on.

## RFC 1: plugin API

**Status:** accepted for 1.1.0. **API version:** 1.

### Decision

Plugins are local ES modules that export values created by `defineRule`,
`defineReporter` or `definePreset` from `apicovenant/plugin`. Each value carries
`pluginApi: 1` and a `kind`; the loader only accepts values for the current API
version.

```js
export const rule = defineRule({
  id: 'team-no-todo-summary',
  title: 'Summaries must not contain unfinished markers',
  severity: 'warn',
  category: 'operations',
  check({ spec, report }) { /* ... */ },
});
```

- Rules receive the same `RuleContext` as built-in rules, so a plugin can use the
  normalized operation model and report a JSON Pointer.
- Reporters return a string; the core writes it. A reporter cannot choose an
  output path or write files itself.
- Presets are named rule/severity bundles. They can be referenced from
  `extends` after the configured plugins have been loaded.

### Security and failure model

There is **no sandbox**. A plugin runs in the CLI process and can read files,
open sockets and read the environment. Documentation treats a plugin exactly
like a script in the user's repository: only trusted code should be configured.

- Load and resolution failures are usage errors (exit 3) and name the
  specifier and resolved path.
- Duplicate plugin IDs, and IDs that collide with built-in rules, are rejected.
- A rule that throws is rethrown with its plugin path; the CLI exits 3 rather
  than turning a broken plugin into a lint finding.
- `--no-plugins` disables loading without changing the rest of the run.

### Compatibility

`PLUGIN_API_VERSION` is incremented only for a breaking change to the surface.
Additive fields are allowed in 1.x. A future incompatible version must be
released under a new API version, not silently reinterpreted.

## RFC 2: configuration v2

**Status:** accepted for 1.1.0.

### Shape

`version: 2` groups options by command:

```json
{
  "version": 2,
  "extends": ["apicovenant:recommended"],
  "plugins": ["./team-plugin.mjs"],
  "lint": { "rules": { "operation-id-required": "error" } },
  "diff": { "ignoreHeaders": ["x-request-id"] },
  "breaking": { "failOn": "breaking" },
  "coverage": { "min": 80 },
  "mock": { "strict": true, "strictUnknown": true },
  "test": { "failOn": "failure" }
}
```

### Precedence

1. Built-in defaults.
2. `extends` in order; later presets override earlier ones.
3. The local configuration file.
4. CLI flags, which always win.

Arrays are replaced, not appended, so a local configuration can intentionally
remove an inherited ignore list. Rule-level values accept `off`, `info`, `warn`
or `error`. Unknown keys are errors rather than being ignored; this is what
turns a typo such as `severty` into a failed run instead of a silent pass.

### Compatibility

- A v1 configuration is normalized into the v2 layout in memory. Existing v1
  files still load unchanged.
- `init` writes v2 by default; `--config-version 1` keeps the old template.
- `migrate --config` writes a v2 file and supports `--dry-run`, `--output` and
  `--force`.
- Plugin presets are resolved in two passes: once plugins are loaded, names
  that were not built-in presets are applied from the plugin registry.

## RFC 3: report pipeline

**Status:** accepted for 1.1.0.

### Decision

Every command produces a small report model: a summary plus findings. Renderers
are pure functions from that model to a string (or to a stream, for text). The
CLI owns file output and exit codes.

- `text`, `json` and `html` remain the existing formats.
- `sarif` is available for `lint`, `breaking` and `coverage`; it emits SARIF
  2.1.0 with rule metadata and JSON Pointer locations.
- `junit` is available for `apicovenant test`; it represents each generated
  contract case as a test case with skipped cases reported explicitly.
- Plugin reporters extend `--format` without changing the core writer.

`lint --format junit` is intentionally unsupported: lint findings are not
test cases, and pretending they are produces misleading CI output. JUnit is
only for the contract-test command. This is documented in the CLI help and
`docs/contract-testing.md`.

### Output and exit codes

- `--output <file>` writes the rendered report; `-` means stdout.
- Text progress and errors go to stderr; the report goes to stdout or the
  requested file.
- Exit codes: `0` success, `1` a gate failed, `2` usage/configuration error,
  `3` plugin failure. A report is always written before a gate exit when
  possible.

### Test strategy

- Renderer tests assert stable keys and escaping for JSON, SARIF and JUnit.
- CLI tests assert output routing, `--output -`, and gate exit codes.
- The full suite includes strict mock, contract tests, breaking, coverage,
  plugin loading, config v2, golden v1/v2 compatibility and the security limits.
- `scripts/release-check.mjs` checks rule counts and documentation links;
  `scripts/release-audit.mjs` checks the version and shipped files.
