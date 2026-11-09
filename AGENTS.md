# AGENTS.md

House rules for automated agents and AI assistants working in this repository.
`CONTRIBUTING.md` explains the project to a human contributor in full; this
file is the short, imperative version - what an agent should do without
asking, and what it must not touch.

## The rule that outranks the others

**Zero runtime dependencies.** `dependencies` and `peerDependencies` stay
empty, always. If you need a capability, implement it in `src/`. Do not add a
runtime dependency, not even a small one, and do not reach for a package to
avoid writing the code. The published tarball is checked for this.

## How the code runs

- Node.js >= 22.18. The source is TypeScript executed **directly** by Node's
  native type stripping. A checkout has no build step and no install step.
- `erasableSyntaxOnly` is on in `tsconfig.json`. The source may not contain
  syntax TypeScript cannot erase: no `enum`, no `namespace`, no `const enum`,
  no parameter properties, no legacy decorators. Use plain objects and
  union types instead of an enum.
- Every relative import carries the `.ts` suffix, type-only ones included:
  `import type { RuleDefinition } from '../types.ts';`
- Strict mode, plus `noUncheckedIndexedAccess` and `noUnusedLocals`. No
  `any` unless there is genuinely no alternative.
- `npm run build` compiles `src/` into `dist/` for the npm tarball only.
  `dist/` is not checked in - never edit it, never commit it.

## Style

- Two spaces per indent, single quotes, semicolons, trailing commas.
- Line endings are LF. Every file ends with a newline. Both are checked.
- **A comment explains why, never what.** The code says what it does; a
  comment earns its place only when it records a decision, a constraint, or a
  hazard that the code cannot show - "the mock keeps a listening socket, so
  a failure while rendering would otherwise leave the process hanging".
  Prose that explains a design belongs in `README.md` or `docs/`, not in the
  source.
- Prefer small functions whose names read like sentences.

## The three gates

Run all three before you open a pull request, and paste their output in the
pull request body:

```bash
node --test
npx tsc --noEmit
node scripts/release-check.mjs
```

`release-check` is stricter than it looks. It fails on:

- a rule in `src/lint/rules/` that `docs/rules.md` does not document, a
  severity that disagrees between code and docs, or a rule count that
  disagrees with the two READMEs
- a link, or a `src/`, `assets/`, `examples/`, `scripts/`, `bin/` path, in
  `README.md`, `README.zh-CN.md`, `docs/rules.md`, `CONTRIBUTING.md` or
  `CHANGELOG.md`, that does not exist
- an exported symbol that nothing uses
- `TODO`, `FIXME` or `XXX` anywhere, and `console.log(` / `console.debug(`
  outside `scripts/`
- CRLF line endings, or a file that does not end with a newline
- a `dependencies` or `peerDependencies` entry, a license other than
  Apache-2.0, or a missing `LICENSE` or `NOTICE`
- a version in `package.json` that differs from the version the CLI reports

## Adding a rule

A rule must be:

- **Explainable.** The message says what is wrong, the hint says what to do.
- **Addressable.** `path` is a JSON Pointer into the document.
- **Quiet by default.** Report a problem once, not once per symptom.
- **Documented.** Add it to `docs/rules.md` **and** to the rule table in both
  `README.md` and `README.zh-CN.md`. The release check compares all three.

`test/rules.test.ts` asserts that every rule fires on at least one of the
three example contracts. Extend a fixture when you add a rule, or the rule
can break silently without any test noticing.

`examples/shop.openapi.yaml` must produce **zero** findings. If a new rule
fires on it, either the rule is wrong or the example needs changing - decide
deliberately and say which in the pull request.
`examples/legacy.openapi.yaml` must keep producing findings from the
categories it was written to exercise.

## Security lines

These are not negotiable, and a pull request that weakens one will not be
merged.

- **An external `$ref` must not read outside its directory.**
  `src/spec/external.ts` resolves a `$ref` that points at another file. It
  checks the resolved path against the directory it was given
  (`isInsideDirectory`) and refuses anything outside it. That check closed a
  path-traversal hole in 1.0.6. Never remove it, never weaken it, and keep
  the file-size limit next to it.
- **A severity is never taken on faith from input.** A finding can come from
  a baseline file, an integration or hand-written JSON, so it may carry a
  value that is not a real severity. Every reporter normalises it through
  `safeSeverity` in `src/report/severity.ts` before using it as a key or
  writing it into markup. Do not bypass it.
- **The mock server binds loopback** (`127.0.0.1`) unless a caller asks for
  another host. Do not widen the default.
- **Never print or log file contents, credentials, tokens or environment
  values**, and never put one into a commit message, a fixture or a test.

## Version and release

**Do not change a version number. Do not create a tag. Do not create a GitHub
Release. Do not publish to npm.** A maintainer does all four.

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which publishes
to npm immediately, with provenance and with no approval step in between. An
npm version cannot be taken back afterwards. Treat "tag" and "publish" as one
irreversible action, and leave it to a person.

- If the work needs a version bump, say so in the pull request and leave
  `package.json` alone.
- `src/version.ts` reads the version from `package.json`; it carries a
  fallback constant, and the two must not drift apart.
- Put a changelog entry under `## [Unreleased]` in `CHANGELOG.md`, unless a
  maintainer asked for a version section. A version section is
  `## [1.2.3] YYYY-MM-DD`, newest first, and the link reference at the bottom
  of the file moves along with it.

## Pull requests

- Branch from `main`, one topic per branch. Do not rebase a branch other
  people have based work on, and never force-push to `main`.
- `main` is protected. It needs three status checks (Node 22.18, Node 24,
  and the self-lint of the examples) and one approving review.
- **Never merge a pull request you did not author, and never enable
  auto-merge.**
- Keep the change focused. An unrelated refactor in the same branch makes
  the review harder and the risk larger.
- Describe what changed and why, and paste the evidence: the three gates and
  their output.
- Update `README.md`, `README.zh-CN.md` and `docs/` whenever behaviour
  changes. The two READMEs are maintained together; a change to one that is
  not in the other is an incomplete change.

## Scope

- Do the task that was asked. Do not widen it, do not narrow it, do not
  reshape it into something more interesting.
- Resolve what you can from the repository itself. For what is genuinely
  undecidable, make the safest reversible choice and say so in the pull
  request instead of stalling.
- A change you cannot finish should not be half-applied. Say what is missing.
