# 1.1.0 release audit and scope record

This document records the T00 scope decision and the T01 audit of the 1.0.4
release claims. It is a project record, not user-facing feature documentation.

## Scope freeze (T00)

- Target version: **1.1.0**. No existing command, flag, library export, v1
  configuration key or v1 golden file is removed in this release.
- Breaking removals are deferred to 2.0.0. New behaviour is additive:
  `breaking`, `coverage`, `test`, `migrate`, config v2, plugin API, golden v2,
  strict mock, SARIF/JUnit and the extra MCP tools.
- Node.js stays at `>=22.18`, the core stays at zero runtime dependencies, and
  plugins are opt-in local code with no sandbox.
- The release gates are `node --test`, `scripts/release-check.mjs`,
  `scripts/release-audit.mjs` and `scripts/bench.mjs --check`.

## 1.0.4 audit (T01)

Baseline: commit `031dbbe` (`chore(release): 1.0.4`), tag `v1.0.4`.

The 1.0.4 changelog announced recorder fixes #13 and #15. They were not present
on the release branch:

```text
$ git merge-base --is-ancestor 7f1f32b HEAD
1
$ git merge-base --is-ancestor 14a3376 HEAD
1
```

`7f1f32b` is the merge commit for the recorder branch and also contains the
#15 multi-value work. The plan allowed either cherry-picking `7f1f32b` or the
pair `771f578` + `14a3376`, but not both.

Decision: cherry-pick `7f1f32b` only.

```text
$ git show -s --format='%H %s' 545ede2
545ede2683e4c3d4f7bdc73ac8a07d92f5ee65cc fix(record): keep bodies byte-exact and replay the request body (#13)
$ git merge-base --is-ancestor 545ede2 HEAD
0
```

1.0.5 was released at commit `09a6afb` while the 1.1.0 work was in progress;
its fixes are merged into the 1.1.0 tree. The changelog keeps both sections
because 1.0.4's published notes had claimed some of those fixes already.

### What the cherry-pick delivers

- Request and response bodies stay byte-exact; non-UTF-8 bodies are stored as
  base64 with `bodyEncoding`.
- Golden format 2 stores `requestBody` separately; `diff --replay-all` sends the
  recorded request body instead of the response body.
- Repeated query parameters and every `Set-Cookie` header survive recording.
- `test/release-1.1.test.ts`, `test/integration.test.ts` and
  `test/defect-fixes.test.ts` cover the behaviour.

### Follow-up

`scripts/release-audit.mjs` now checks the version, changelog section, required
files, CLI version and `release-check` in one command. This is the guard against
publishing release notes that do not match the tree.
