# Configuration v2

A v2 configuration keeps one section per command. The v1 layout still loads
unchanged; `apicovenant migrate --config` rewrites it.

```json
{
  "version": 2,
  "extends": ["apicovenant:recommended"],
  "lint": {
    "rules": {
      "operation-id-required": "error",
      "schema-example-recommended": "off"
    },
    "severity": "info",
    "failOn": "error",
    "baseline": ".apicovenant-baseline.json"
  },
  "diff": {
    "compareHeaders": ["content-type", "location"],
    "ignoreHeaders": ["etag", "date"],
    "ignorePaths": ["/items/*/updatedAt", "/meta/**"]
  },
  "breaking": { "failOn": "breaking", "ignoreChanges": ["deprecated-added"] },
  "coverage": { "min": 80, "failOn": "gap" },
  "mock": { "strict": true, "cors": ["*"] },
  "test": { "includeUnsafe": false, "failOn": "failure" },
  "plugins": []
}
```

## Precedence

```text
CLI flag  >  command section  >  top-level v1 keys  >  built-in defaults
```

The top-level `rules`, `severity`, `failOn`, `format`, `output` and `baseline`
keys are the v1 form. They are still honoured as defaults so that a v1 file keeps
behaving exactly as before; a v2 file should use the `lint` section instead.

## Sections

### `lint`

| Key | Type | Default |
| --- | --- | --- |
| `rules.ignore` | string[] | `[]` |
| `rules.only` | string[] | all rules |
| `rules.<rule-id>` | `off`/`info`/`warn`/`error` | rule default |
| `severity` | `error`/`warn`/`info` | `info` |
| `failOn` | `error`/`warn`/`never` | `error` |
| `baseline` | string | none |
| `format` | `text`/`json`/`html`/`sarif` | `text` |
| `output` | string | stdout |

Rule-level severity overrides the severity declared by the rule. `off` removes
it from the run entirely. `rules.ignore`, `rules.only` and rule-level entries may
be combined; `only` restricts the run to the listed rules.

### `diff`

| Key | Meaning |
| --- | --- |
| `compareHeaders` | Replace the default comparison list (`content-type`, `location`, `etag`, `cache-control`) |
| `ignoreHeaders` | Remove headers from the comparison; wins over `compareHeaders` |
| `ignorePaths` | JSON Pointer patterns treated as noise (`*` one segment, `**` any number) |
| `failOn` | `changed` (default) or `never` |
| `format` | `text`/`json`/`html` |
| `output` | string |

### `breaking`

| Key | Meaning |
| --- | --- |
| `failOn` | `breaking` (default), `risky`, `any`, `never` |
| `ignoreChanges` | Change ids to ignore |
| `format` | `text`/`json`/`sarif` |
| `output` | string |

### `coverage`

| Key | Meaning |
| --- | --- |
| `min` | Integer 0-100; fail below this operation coverage |
| `failOn` | `gap`/`undocumented`/`never` (default `never`) |
| `format` | `text`/`json`/`sarif` |
| `output` | string |

### `mock`

| Key | Meaning |
| --- | --- |
| `strict` | Validate path, query, header, cookie and body parameters |
| `strictUnknown` | Reject query/header/cookie parameters that are not documented |
| `cors` | `true`, `false` or a list of allowed origins |
| `watch` | Reload the document after changes |
| `maxBody` | Request body limit in bytes (default 10485760) |

### `test`

| Key | Meaning |
| --- | --- |
| `includeUnsafe` | Run `POST`/`PUT`/`PATCH`/`DELETE` cases (default `false`) |
| `maxCases` | Stop after this many operations (default 200) |
| `failOn` | `failure` (default) or `never` |
| `format` | `text`/`json`/`junit`/`sarif` |
| `output` | string |

### `plugins`

A list of local paths or package names loaded by `lint` and `rules`;
`--no-plugins` disables them. Plugins run in-process without a sandbox. See
[docs/plugins.md](plugins.md).

```json
{ "version": 2, "plugins": ["./team-plugin.mjs"] }
```

## `extends`

```json
{ "version": 2, "extends": ["apicovenant:recommended"] }
```

Presets are applied in order and the document's own settings win. Supported:

- `apicovenant:recommended` — the default 43-rule set (a no-op marker today).
- A local path to another configuration file. Presets may extend presets up to a
  depth of five; cycles are rejected by the depth limit.
- The name of a preset contributed by a configured plugin, for example
  `{"plugins": ["./team-plugin.mjs"], "extends": ["team"]}`. Plugin presets are
  resolved after the plugins are loaded; an unknown name still fails.
- `apicovenant:strict` — the default 43 rules plus six opt-in checks (49
  total). Rule-level settings from the document still win, so individual strict
  rules can be turned `off`.

## Validation

- Unknown top-level keys are an error.
- With `version: 2`, unknown sections and unknown keys inside every section are
  an error that names the section and the key.
- A section without `version: 2` is rejected with a hint to add the version, so a
  typo cannot silently create a second configuration dialect.
- Unknown rule ids in `only`, `ignore` or rule-level entries are rejected by
  `lint` with a pointer to `apicovenant rules`.

## Discovery

The same file names are used as in v1:

```text
apicovenant.config.json      apicovenant.config.yaml     apicovenant.config.yml
.apicovenantrc.json          .apicovenantrc.yaml         .apicovenantrc.yml
package.json → "apicovenant"
```

`--config <file>` bypasses discovery.
