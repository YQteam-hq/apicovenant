# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

From 1.0.0 onwards the public API, the CLI flags and the file formats are
stable. Anything that changes them will be announced here under a heading that
says so.

## [Unreleased]

## [1.0.2] — 2026-10-24

Seven correctness fixes across replay, mock generation, specification loading,
recording and YAML parsing. No public API, CLI flag or file format changes.

Released by **YQteam** (<https://yq-tuandui.xyz>), Apache-2.0.

### Fixed

- **`diff --replay-all` no longer fails on requests with a body.** The replayer
  forwarded recorded transport headers such as `content-length` to `fetch()`,
  which rejects them for a request that also carries a body. Those headers are
  now stripped before replaying, matching what the recorder already did.
- **The mock generator honours the constraints it is given.** Arrays respect
  `minItems`/`maxItems` and `uniqueItems`, integers and numbers are clamped to
  `minimum`/`maximum` and the exclusive bounds, and common regular expressions
  are reverse-filled instead of falling through to a placeholder string.
- **Dangling local `$ref` values are rejected when a specification loads.** A
  reference to a missing component used to make `lint` report no problems and
  make `mock` serve placeholder data; it is now an error at load time.
  External references are still out of scope.
- **The recorder redacts credentials carried in the query string.** Only
  headers were redacted before, so `?api_key=…` and similar values were written
  to the golden file verbatim.
- **Arrays that only changed order are reported once.** A reordered array used
  to produce a cascade of positional differences; it is now a single
  `[reordered]` difference. Array items are compared key-order-insensitively.
- **YAML merge keys, multi-line flow collections and document markers are
  handled.** `<<: *anchor` is expanded, flow collections may span several
  lines, and a document that contains more than one YAML document is rejected
  instead of being silently merged.
- **`diff` rejects `--spec` together with `--target`.** Passing both is now a
  usage error rather than one of the two silently winning.

## [1.0.1] — 2026-10-24

The published package could not run. `apicovenant@1.0.0` installed without
errors and then failed on the first command, because the tarball shipped
TypeScript sources and Node refuses to strip types for files under
`node_modules`.

Released by **YQteam** (<https://yq-tuandui.xyz>), Apache-2.0.

### Fixed

- **The published package now runs.** The tarball ships a compiled `dist/`
  alongside the sources, and the command line entry point loads the compiled
  output when it is installed. A checkout still runs the sources directly.
- **The package entry point resolves to the compiled build.** `apicovenant` is
  now importable as a library, and the type declarations are published
  alongside the JavaScript.
- **The packaging is covered by a test.** The suite packs the tarball,
  installs it into a throwaway project and runs the installed command, so a
  broken package cannot be published again.

## [1.0.0] — 2026-10-23

The first stable release. One CLI, four commands, zero runtime dependencies.

Released by **YQteam** (<https://yq-tuandui.xyz>), Apache-2.0.

### Added

- **`apicovenant lint`** — 42 design-convention rules across 8 categories
  (document, operations, paths, parameters, responses, schemas, security,
  pagination). Every finding carries a JSON Pointer into the document and a
  hint on how to fix it.
  - Reports in `text`, `json` and a self-contained `html` format.
  - `--rules`, `--ignore`, `--severity`, `--fail-on` and `--output` for
  - fine-grained control.
- **`apicovenant mock`** — a mock server generated from the OpenAPI document.
  Payloads come from the documented example when there is one and are derived
  deterministically from the schema otherwise, so repeated runs are identical.
  `?x-mock-status=` forces a status code and `/_apicovenant/routes` returns the
  route table.
- **`apicovenant record`** — a recording proxy that captures real traffic into
  a golden file. Credentials are redacted before anything is written to disk.
- **`apicovenant diff`** — replays a golden file against a live API or a mock
  and reports behaviour drift: status codes, headers and body differences
  addressed by JSON Pointer. Only safe methods are replayed unless
  `--replay-all` is given. With `--spec`, responses are additionally validated
  against the documented schema. The report can be written as `html`. A mock
  built from that spec can only confirm itself, so its own schema problems are
  listed separately and never counted as drift.
- **`apicovenant rules`** — the rule catalogue, as text or JSON.
- **`apicovenant init`** — writes a starter configuration file.
- **A wordmark and a lockup** — the brand had a mark but no type. The wordmark is
  set in [Outfit](https://fonts.google.com/specimen/Outfit) and converted to
  outlines, so it renders identically everywhere and needs no font at runtime.
  `assets/wordmark.svg` is the type on its own, `assets/logo-lockup.svg` is the
  mark and the type together, and both ship a mono variant for dark
  backgrounds. The font notice travels with them in
  `assets/FONT-LICENSE.txt`. Both READMEs and all four pages under `docs/`
  now lead with the lockup.
- **`apicovenant mcp`** — serves the contract tools over the Model Context
  Protocol, so an AI agent can lint a document, read the rule catalogue, list
  the operations of an API, ask for an example payload and check for contract
  drift. The protocol is implemented directly against the specification, so no
  MCP SDK is pulled in and the runtime dependency count stays at zero. See
  [docs/mcp.md](docs/mcp.md).
- **Configuration files** — `apicovenant.config.json`, the YAML equivalents,
  `.apicovenantrc.*`, or an `apicovenant` key in `package.json`. Unknown
  settings are an error, so a typo can never silently disable a check. See
  [docs/configuration.md](docs/configuration.md).
- **Baselines** — record the findings that already exist so the command only
  fails on new ones. This is what makes the linter adoptable on an existing
  codebase. See [docs/baseline.md](docs/baseline.md).
- A YAML 1.2 subset parser, a JSON Schema validator and an example generator,
  so that the tool runs on a bare Node.js installation with nothing to install.
- OpenAPI 3.0 and 3.1 support, including `$ref` resolution with cycle
  detection.
- A reference contract (`examples/shop.openapi.yaml`) that passes the linter
  with zero findings, a deliberately inconsistent one
  (`examples/legacy.openapi.yaml`) and a fixture that breaks every convention
  at once (`examples/violations.openapi.yaml`).
- `src/index.ts` exports the whole tool, so it can be used as a library.
- `npm run release-check` runs the checks a release depends on: the rule
  catalogue against `docs/rules.md`, the README claims against reality, every
  relative link, the published file list, unused exports and leftover debug
  markers.

### Fixed

- The mock payload could violate the schema it was generated from. A schema
  nested deeper than the generator descends into was truncated to an empty
  object or an empty string, which broke `required` properties and enum
  members. The truncated value now keeps the required properties, an allowed
  enum value and the numeric bounds, so a mock always satisfies its own spec.
- The example generator matched keywords as substrings, so `country` and
  `discount` were answered with `"3"`. Keywords are matched on whole words
  now, and camel case is understood.
- The mock server closed idle keep-alive connections while the diff was
  validating the previous response, and the next request reused the dead
  socket and failed with `ECONNRESET`. Safe requests are retried once and the
  mock keeps its connections open.
- The global `Response` type resolved to an empty interface under
  `@types/node` without the DOM lib, so `fetch` responses had no `status`,
  `headers` or `text`. `lib` now includes `DOM`.
- The YAML parser registered an anchor under an `undefined` name when the
  capture group was missing.
- The HTML report read the severity out of the class list, so a row hidden by
  one filter could not be shown again by another. Every row now carries
  `data-severity`.
- `typescript` is declared as `^5.8.0`: the `erasableSyntaxOnly` compiler
  option used by the project does not exist in 5.6.

[Unreleased]: https://github.com/YQteam-hq/apicovenant/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/YQteam-hq/apicovenant/releases/tag/v1.0.1
[1.0.0]: https://github.com/YQteam-hq/apicovenant/releases/tag/v1.0.0
