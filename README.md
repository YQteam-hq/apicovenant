<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-lockup-mono.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/logo-lockup.svg">
    <img src="assets/logo-lockup.svg" alt="apicovenant" width="560">
  </picture>
</p>

<p align="center"><strong>An OpenAPI contract guardian.</strong></p>
<p align="center">Lint the design conventions of your spec, mock it, record real traffic against it, and find out whether your next release changed the contract — with <strong>zero runtime dependencies</strong>.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/apicovenant"><img src="https://img.shields.io/npm/v/apicovenant.svg" alt="npm"></a>
  <a href="https://github.com/YQteam-hq/apicovenant/actions/workflows/ci.yml"><img src="https://github.com/YQteam-hq/apicovenant/actions/workflows/ci.yml/badge.svg" alt="ci"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="license"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22.18-5FA04E.svg" alt="node">
  <img src="https://img.shields.io/badge/runtime%20dependencies-0-success.svg" alt="dependencies">
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

---

## The problem

Most teams own an OpenAPI document. Far fewer teams keep it honest.

The document drifts away from the implementation in three directions at once:

| Drift | What it costs you |
| --- | --- |
| **Design drift** — the spec is valid but inconsistent: four different error shapes, two pagination styles, paths that disagree on casing | Every consumer writes a per-endpoint workaround |
| **Spec drift** — the implementation moved on, the document did not | Clients generate against a contract nobody implements |
| **Behaviour drift** — the API returns something subtly different after a refactor | Production incidents that no test caught |

Existing tools cover one of these each: schema linters check that the document is *valid*, mock servers answer *from* the document, spec differs compare two versions of the document. None of them closes the loop from **spec → mock → recorded real traffic → regression diff**.

`apicovenant` does all four in one CLI.

## What it does

| Command | Purpose |
| --- | --- |
| `apicovenant lint` | Check **43 design-convention rules** that pure schema validators never look at |
| `apicovenant lint --fix` | Repair the safe, mechanical subset (trailing slashes, 3.1 `nullable`) as a reviewable diff |
| `apicovenant mock` | Serve a mock API generated from the spec, with realistic deterministic payloads |
| `apicovenant record` | Put a recording proxy in front of your API and capture traffic as a **golden file** |
| `apicovenant diff` | Replay the golden file against a live API and report **behaviour drift**, field by field |
| `apicovenant breaking` | Compare two specs and classify every change as **breaking, risky, compatible or info** |
| `apicovenant coverage` | Measure recorded traffic against the spec: **unexercised operations, undocumented traffic, status gaps** |
| `apicovenant test` | Generate contract tests from the spec and validate the responses, with **JUnit** output for CI |
| `apicovenant migrate` | Migrate a v1 configuration or golden file to the v2 format |
| `apicovenant rules` | Browse the full rule catalogue |
| `apicovenant init` | Write a starter configuration file |
| `apicovenant mcp` | Serve the contract tools to an AI agent over the Model Context Protocol |

Compatibility and coverage have their own guides:
[docs/breaking.md](docs/breaking.md), [docs/coverage.md](docs/coverage.md),
[docs/contract-testing.md](docs/contract-testing.md),
[docs/strict-mock.md](docs/strict-mock.md), [docs/plugins.md](docs/plugins.md),
[docs/fix.md](docs/fix.md), [docs/openapi-3.1.md](docs/openapi-3.1.md)
and [docs/migration-1.1.md](docs/migration-1.1.md).

## Why zero dependencies

`apicovenant` runs on a bare Node.js installation. There is no `npm install`, no build step, no `node_modules`, and nothing to audit before you let it touch your CI.

That means writing a few things ourselves — a YAML subset parser, a JSON Schema validator, a JSON Pointer diff — but it also means:

- **No supply chain risk.** The whole tool is the code in this repository.
- **No install step.** `node bin/apicovenant.mjs` is the entire setup.
- **Instant startup.** Nothing to compile, nothing to cache.
- **Readable source.** Every line of behaviour is in `src/`, not spread across a dependency tree.

The source is TypeScript and is executed directly by Node's native type stripping, so there is still no build step.

The one exception is the published package. Node refuses to strip types for
files under `node_modules`, so the tarball also carries a compiled `dist/`
and the installed command runs that. A checkout keeps running the sources.

## Install

```bash
# run without installing
npx apicovenant lint openapi.yaml

# or install globally
npm install -g apicovenant
apicovenant lint openapi.yaml
```

Requires **Node.js ≥ 22.18** (for native TypeScript execution). The source is plain JavaScript-compatible TypeScript; `npm run typecheck` runs `tsc --noEmit` if you want static analysis.

## Quick start

```bash
# 1. check your contract
apicovenant lint openapi.yaml

# 2. get a mock to develop against
apicovenant mock openapi.yaml --port 4010

# 3. capture how your real API actually behaves
apicovenant record --target http://localhost:3000 --out traffic.golden.json

# 4. before you ship, replay it and see what moved
apicovenant diff --golden traffic.golden.json --target http://localhost:3000
```

## Linting

```console
$ apicovenant lint examples/legacy.openapi.yaml
4 errors · 15 warnings · 17 info

GET /create_stock_item

  error   operation-id-required
          GET /create_stock_item has no operationId
          paths./create_stock_item.get
          → Add a camelCase operationId such as "listUsers" or "createUser".

GET /stock_items

  error   response-status-valid
          "20O" is not a valid HTTP status code in GET /stock_items
          paths./stock_items.get.responses.20O
          → Use a three digit status code or "default".
```

Every finding carries a **JSON Pointer** into the document, so it is directly
actionable — and the same addressing scheme is used by the diff engine.

### The rules

43 rules across 8 categories. The full reference lives in [`docs/rules.md`](docs/rules.md).
Six more opt-in rules ship in the `apicovenant:strict` preset; they never run by
default, so every existing v1 configuration keeps its current behaviour.

| Category | Rules | What it protects |
| --- | --- | --- |
| `document` | 5 | Version, contact, license, HTTPS servers, declared tags |
| `operations` | 8 | `operationId` identity, summaries, tags, HTTP semantics |
| `paths` | 5 | kebab-case, no verbs, no trailing slash, path parameters |
| `parameters` | 4 | Required path parameters, duplicates, documentation |
| `responses` | 8 | Success responses, valid status codes, one error envelope |
| `schemas` | 7 | Naming consistency, unused components, array items |
| `security` | 3 | Declared schemes, scopes, no credentials in query strings |
| `pagination` | 2 | One pagination model, one collection envelope |

Strict mode adds six checks (49 total):

| Rule | Severity | What it catches |
| --- | --- | --- |
| `response-204-no-content` | error | A 204 response that still declares a body |
| `response-201-location` | warn | A 201 without a `Location` header |
| `schema-example-valid` | error | A component example that fails its own schema |
| `parameter-example-valid` | error | A parameter example that fails its schema |
| `request-body-json-content-type` | warn | JSON sent as `text/json` or a vendor JSON type |
| `security-https` | warn | OAuth/OpenID endpoints served over plain HTTP |

```json
{ "version": 2, "extends": ["apicovenant:strict"] }
```

`apicovenant rules --strict` lists all 49. The default `lint` run (and
`apicovenant:recommended`) stays at 43.

Highlights of what a schema validator will *not* tell you:

- `response-error-envelope` — every failure uses the same error schema
- `operation-id-naming` — `operationId` is camelCase and starts with a verb
- `pagination-consistency` — one endpoint pages with `limit/offset`, another with `cursor`
- `schema-property-naming-consistency` — the API does not mix `camelCase` and `snake_case`
- `path-no-verbs` — `/createUser` says the same thing twice
- `security-in-query` — an API key in the query string leaks into your access logs

### Reports

```bash
apicovenant lint openapi.yaml --format json --output report.json
apicovenant lint openapi.yaml --format html --output report.html

# re-run on every save (Ctrl+C to stop)
apicovenant lint openapi.yaml --watch

# preview mechanical fixes as a unified diff, then apply them
apicovenant lint openapi.yaml --fix
apicovenant lint openapi.yaml --fix --write
```

`--fix` only rewrites the low-risk mechanical findings; semantic rules are
never touched. `--fix-aggressive` additionally camelCases `operationId`
values, which can change generated clients. See [docs/fix.md](docs/fix.md).

The HTML report is a **single self-contained file** — no CDN, no external fonts, no scripts from a third party. Attach it to a CI job or commit it to the repository.

Watch mode keeps a report on screen and re-runs after each save; a document that
fails to parse leaves the previous report visible and the watcher running.

### Selecting rules

```bash
# only the rules you care about
apicovenant lint openapi.yaml --rules operation-id-required,response-error-envelope

# silence noisy ones
apicovenant lint openapi.yaml --ignore schema-example-recommended,info-license-required

# only show problems
apicovenant lint openapi.yaml --severity error
```

## Configuration

Settings that every command in the project needs can live in a file instead of
being repeated on every invocation.

```bash
apicovenant init          # writes apicovenant.config.json
```

```json
{
  "rules": { "ignore": ["schema-example-recommended"], "only": [] },
  "severity": "error",
  "failOn": "error",
  "format": "text"
}
```

JSON, YAML and an `apicovenant` key in `package.json` are all supported.
Unknown settings are an **error**, so a typo can never silently disable a
check. Command line flags always win over the file.

See [docs/configuration.md](docs/configuration.md) for the full reference of the
v1 layout and [docs/configuration-v2.md](docs/configuration-v2.md) for the v2
layout with one section per command.

Configuration can also load local plugins that add lint rules, reporters and
presets. Plugins run in-process and are not sandboxed; see
[docs/plugins.md](docs/plugins.md).

## Baselines

A linter that reports 400 findings on an existing codebase gets switched off
on day one. A baseline fixes that: record what already exists, and only
**new** findings fail the build.

```bash
# 1. record the current state
apicovenant lint openapi.yaml --update-baseline .apicovenant-baseline.json

# 2. from now on only new findings fail
apicovenant lint openapi.yaml --baseline .apicovenant-baseline.json
```

```
✓ no findings
  Shop API v1.4.0 follows every convention.

  document: openapi.yaml
  37 known findings suppressed by the baseline
```

Commit the baseline, shrink it as the team fixes things. See
[docs/baseline.md](docs/baseline.md).

## Mocking

```console
$ apicovenant mock examples/shop.openapi.yaml --port 4010
▶ Shop API v1.4.0 mocking examples/shop.openapi.yaml

  listening on  http://127.0.0.1:4010
  routes        11 operations
  route table   http://127.0.0.1:4010/_apicovenant/routes

  GET     /users
  GET     /users/{userId}
  POST    /users
  ...
```

Responses come from the documented example when there is one, and from a
**deterministic payload generated from the schema** when there is not — so two
runs of your mock produce byte-identical bodies.

The generated payload **satisfies the schema it was generated from**, including
the awkward parts: required properties are present, enumerated fields hold a
documented value, and a schema nested deeper than the generator descends into
is truncated to a value that still validates instead of an empty one.

```bash
# force a status code
curl 'http://127.0.0.1:4010/users?x-mock-status=404'

# see the route table
curl http://127.0.0.1:4010/_apicovenant/routes
```

Add `--strict` to validate parameters and request bodies (bad input gets
`400`, an undocumented media type `415`, an oversized body `413`), `--cors` for
browser clients and `--watch` to reload the document without a restart. See
[docs/strict-mock.md](docs/strict-mock.md).

## Contract tests

`apicovenant test` turns the document into a smoke suite: one generated request
per operation, checked against the documented status, media type and response
schema.

```console
$ apicovenant test examples/shop.openapi.yaml
  ✓ GET /users (listUsers) 27ms
  ✓ GET /users/{userId} (getUser) 4ms
  ...
  0 failed · 7 passed · 3 skipped · 10 total
```

Without `--target` the cases run against the built-in mock; point them at a
running API with `--target http://127.0.0.1:8080`. Unsafe methods are skipped
unless `--include-unsafe` is given, and `--format junit` produces a CI report.
See [docs/contract-testing.md](docs/contract-testing.md).

## Recording and diffing

This is the part that answers *"did my change break the API?"*.

```console
$ apicovenant record --target http://localhost:3000 --out traffic.golden.json
▶ recording http://localhost:3000

  proxy   http://127.0.0.1:4011
  output  traffic.golden.json

  point your client at the proxy, then press Ctrl+C to stop
```

The golden file is deliberately boring JSON, so it reviews well in a pull request:

```json
{
  "apicovenant": 1,
  "recordedAt": "2026-10-23T18:04:11.204Z",
  "target": "http://localhost:3000",
  "spec": "examples/shop.openapi.yaml",
  "interactions": [
    {
      "method": "GET",
      "path": "/users",
      "query": { "page": "1" },
      "status": 200,
      "bodyType": "json",
      "body": "{\"items\":[...],\"total\":1}"
    }
  ]
}
```

Credentials are **redacted before anything is written to disk**.

Then replay it:

```console
$ apicovenant diff --golden traffic.golden.json --target http://localhost:3000
contract diff
  golden  traffic.golden.json
  source  http://localhost:3000

1 changed · 4 unchanged

✖ GET /users
  • status changed 200 → 500
  • body changed in 2 places (first: changed /items/0/total)
      total changed 42 → 0
      items changed 1 → 0

✓ GET /users/usr_1001

✖ the contract drifted — 1 changed, 4 unchanged
```

Safety is the default: **only safe methods are replayed**, so running a diff
never creates data on the target system. Pass `--replay-all` if you really
want `POST`, `PUT`, `PATCH` and `DELETE` replayed too.

The recorder redacts credentials (`Authorization`, `Cookie`, `X-Api-Key` and
friends) before writing the golden file. Replay those endpoints by supplying
the header again — recorded `<redacted>` values are dropped, never sent:

```bash
apicovenant diff --golden traffic.golden.json --target https://api.example.com \
  -H "Authorization: Bearer $API_TOKEN"
```

You can also diff against the mock instead of a live server:

```bash
apicovenant diff --golden traffic.golden.json --spec examples/shop.openapi.yaml
```

When a spec is supplied, the new responses are additionally **validated against
the documented schema**, so a response that still parses but no longer matches
the contract is reported as a schema violation.

Against a live API a schema violation *is* contract drift and fails the run.
Against a mock built from that same spec the check would be circular — the mock
is the spec's own rendering, so it can only ever confirm itself. Those findings
are therefore listed separately as generator limitations and never counted as
drift.

## CI integration

```yaml
- name: Check the API contract
  run: |
    npx apicovenant lint openapi.yaml --baseline .apicovenant-baseline.json
    npx apicovenant diff --golden traffic.golden.json --target "$API_URL"
```

For a complete copy-paste workflow with SARIF upload, JUnit results and a
breaking-change gate, see [`examples/github-actions.yml`](examples/github-actions.yml).
The benchmark that tracks the 1.1.0 performance targets is
`node scripts/bench.mjs` (or `npm run bench`); it is non-blocking in CI and
exits non-zero with `--check` at the release gate. On a 10.8 MB / 1,000-operation
document it measures roughly 64 ms parse, 93 ms lint, 35 ms breaking,
81 ms coverage and 17 ms mock cold start with a 126 MB peak RSS — comfortably
inside the targets, so no semantic cache layer is needed (and none is added,
because it would be one more thing to trust, which keeps repeated runs honest).

Five real public specifications (GitHub, Stripe, Slack, Medium and httpbin) can
be downloaded into the ignored `corpus/specs/` directory with
`node scripts/fetch-corpus.mjs`; see [`corpus/README.md`](corpus/README.md).
They are used for local compatibility checks and are never fetched by CI.

On a codebase that is not clean yet, record the existing findings once and
commit the baseline — from then on the build only fails on new problems.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Findings above the threshold, or the contract drifted |
| `2` | Usage error (unknown flag, unknown rule, missing argument) |
| `3` | The document could not be read or parsed |

## Give it to an AI agent

An agent that writes an OpenAPI document needs the same answers you do: does
it break a convention, what does this endpoint look like, did the last change
move the contract. `apicovenant mcp` serves them over the
[Model Context Protocol](https://modelcontextprotocol.io).

```bash
apicovenant mcp
```

Point a client at it:

```json
{
  "mcpServers": {
    "apicovenant": {
      "command": "apicovenant",
      "args": ["mcp"]
    }
  }
}
```

The agent gets eight tools — `lint_openapi`, `list_rules`, `list_operations`,
`example_response`, `check_contract_drift`, `check_breaking_changes`,
`check_traffic_coverage` and `run_contract_tests` — plus the rule reference as a
resource. The protocol is implemented directly against the specification, so
there is **no MCP SDK dependency** and the zero-runtime-dependency promise
still holds.

See [docs/mcp.md](docs/mcp.md) for the client configuration of every editor and
the full tool reference.

## Use it as a library
Everything the CLI does is available programmatically:

```ts
import { lint, loadSpecFile, startMockServer, compareGolden } from 'apicovenant';

const spec = await loadSpecFile('openapi.yaml');
const { findings } = lint(spec);

const mock = await startMockServer(spec);
console.log(mock.url);
```

The entry point exports the rule engine, the spec loader and model, the JSON
Schema validator, the mock server, the recorder, the diff engine and the three
reporters.

## New in 1.1.0: Contract Lifecycle Toolkit

The 1.1.0 release turns `apicovenant` into a complete contract lifecycle tool. Beyond linting and mocking, you can now:

### Breaking Change Analysis

```bash
# Compare two OpenAPI specs for breaking changes
apicovenant breaking old-spec.yaml new-spec.yaml

# Classify every change as breaking, risky, compatible, or info
# with a stable 41-class taxonomy and SARIF output
```

### Contract Testing

```bash
# Generate contract tests from your OpenAPI spec
apicovenant test examples/shop.openapi.yaml --target http://localhost:3000

# Validates responses against documented status, media type, and schema
# Built-in mock target, JUnit output for CI, and JSON/SARIF formats
```

### Traffic Coverage Analysis

```bash
# Measure how much of your spec is exercised by recorded traffic
apicovenant coverage traffic.golden.yaml --spec examples/shop.openapi.yaml

# Finds unexercised operations, undocumented traffic, and status gaps
# with configurable minimum thresholds and failure gates
```

### Enhanced Mock Server

```bash
# Strict mode validates requests against the spec
apicovenant mock spec.yaml --strict --strict-unknown

# CORS support, watch mode, and configurable body limits
# All configurable through the v2 mock configuration
```

### Configuration v2

```json
{
  "version": 2,
  "lint": { "extends": ["apicovenant:strict"] },
  "mock": { "strict": true, "cors": true },
  "breaking": { "fail-on": "breaking" }
}
```

### MCP Protocol Integration

Serve `apicovenant` tools to AI agents over the Model Context Protocol:

```bash
apicovenant mcp
```

Enables AI agents to lint documents, list operations, generate examples, and check for contract drift.

### Migration Tools

```bash
# Migrate v1 configuration to v2 format
apicovenant migrate --config apicovenant.config.v1.json

# Migrate golden files from format 1 to format 2
apicovenant migrate --golden traffic.golden.v1.json
```

All existing commands, flags, library exports, and v1 configuration files keep working. Golden files are now written in format 2; format 1 files are read and can be migrated.

## How it is put together

```
src/
  yaml/        YAML 1.2 subset parser (no dependency)
  spec/        loader, $ref resolver, normalized operation model
  lint/        rule engine + the rule catalogue
  mock/        spec driven mock server
  record/      recording proxy + golden file format
  diff/        contract diffing with JSON Pointer paths
  report/      terminal, JSON and standalone HTML reports
  mcp/         the Model Context Protocol server
  cli/         argument parsing and command dispatch
```

The linter, the mock server and the recorder all work against the **same**
normalized model of an OpenAPI document, so they can never disagree about what
an operation is.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the
workflow, the code style and how to add a rule.

```bash
git clone https://github.com/YQteam-hq/apicovenant.git
cd apicovenant
node --test
```

## Support

`apicovenant` is maintained by **YQteam**.

| | |
| --- | --- |
| Maintainer | [YQteam](https://yq-tuandui.xyz) |
| Repository | [github.com/YQteam-hq/apicovenant](https://github.com/YQteam-hq/apicovenant) |
| Issues | [github.com/YQteam-hq/apicovenant/issues](https://github.com/YQteam-hq/apicovenant/issues) |
| Security | see [SECURITY.md](SECURITY.md) |
| Email | [yqteam@yeah.net](mailto:yqteam@yeah.net) |

### Brand

The mark is a square spiral drawn in graphite. The wordmark is set in
[Outfit](https://fonts.google.com/specimen/Outfit) and converted to outlines, so
it renders identically everywhere and needs no font at runtime.

| File | What it is |
| --- | --- |
| `assets/logo.svg` | The mark on its own |
| `assets/logo-mono.svg` | The mark, for dark backgrounds |
| `assets/wordmark.svg` | The wordmark on its own |
| `assets/wordmark-mono.svg` | The wordmark, for dark backgrounds |
| `assets/logo-lockup.svg` | The mark and the wordmark together |
| `assets/logo-lockup-mono.svg` | The lockup, for dark backgrounds |
| `assets/icon.svg` | The mark in a rounded square |

Outfit is licensed under the SIL Open Font License 1.1. The notice travels with
the assets in [assets/FONT-LICENSE.txt](assets/FONT-LICENSE.txt).

## License

[Apache-2.0](LICENSE) © 2026 YQteam (yq-tuandui.xyz)

Released under the Apache License, Version 2.0. You may use, modify and
redistribute this software — including inside closed source and commercial
products — provided that you keep the copyright notice and the license text.
The license also grants an express patent license from every contributor.
