<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/logo-lockup-mono.svg">
    <source media="(prefers-color-scheme: light)" srcset="../assets/logo-lockup.svg">
    <img src="../assets/logo-lockup.svg" alt="apicovenant" width="440">
  </picture>
</p>

# Configuration

A project can keep its apicovenant settings in a file instead of repeating the
same flags in every CI step.

```bash
apicovenant init
```

writes `apicovenant.config.json`:

```json
{
  "rules": {
    "ignore": [],
    "only": []
  },
  "severity": "info",
  "failOn": "error",
  "format": "text"
}
```

## Where the file is looked up

The first file that exists wins:

1. `apicovenant.config.json`
2. `apicovenant.config.yaml` / `apicovenant.config.yml`
3. `.apicovenantrc.json`
4. `.apicovenantrc.yaml` / `.apicovenantrc.yml`
5. the `apicovenant` key in `package.json`

```json
{
  "name": "my-service",
  "apicovenant": {
    "failOn": "warn",
    "rules": { "ignore": ["schema-example-recommended"] }
  }
}
```

A specific file can always be named with `--config <file>`.

## Settings

| Setting | Type | Meaning |
| --- | --- | --- |
| `rules.ignore` | string[] | Rules that never run. |
| `rules.only` | string[] | Rules that run exclusively. Everything else is skipped. |
| `severity` | `error` \| `warn` \| `info` | The lowest severity that is reported. |
| `failOn` | `error` \| `warn` \| `never` | The severity at which the command exits with code 1. |
| `format` | `text` \| `json` \| `html` | The report format. |
| `output` | string | Where the report is written. |
| `baseline` | string | A baseline file. See [baseline.md](baseline.md). |

Unknown settings are an **error**, not a warning. A typo like `severty` would
otherwise be silently ignored and the lint would pass for the wrong reason.

## Precedence

Command line flags beat the configuration file, which beats the built-in
defaults:

```
apicovenant lint openapi.yaml --fail-on warn
```

overrides `failOn` from the file.

## Examples

Only report errors, and fail the build on them:

```json
{ "severity": "error", "failOn": "error" }
```

Never fail the build, but still print everything:

```json
{ "failOn": "never" }
```

Run a single rule and write an HTML report:

```json
{ "rules": { "only": ["response-error-envelope"] }, "format": "html", "output": "report.html" }
```
