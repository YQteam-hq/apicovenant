<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/logo-lockup-mono.svg">
    <source media="(prefers-color-scheme: light)" srcset="../assets/logo-lockup.svg">
    <img src="../assets/logo-lockup.svg" alt="apicovenant" width="440">
  </picture>
</p>

# Baselines

A linter that reports 400 findings on an existing codebase is a linter that
gets switched off on day one. A **baseline** solves that: it records the
findings that already exist, so the command only fails on **new** ones.

## The workflow

**1. Record the current state**

```bash
apicovenant lint openapi.yaml --update-baseline .apicovenant-baseline.json
```

This writes every current finding to the baseline file and exits with code 0.

**2. Commit the baseline**

The baseline belongs in version control. It is the agreed starting point, not
a way to hide problems.

**3. From now on, only new findings fail the build**

```bash
apicovenant lint openapi.yaml --baseline .apicovenant-baseline.json
```

Findings that are already in the baseline are suppressed and reported as a
count:

```
✓ no findings
  Shop API v1.4.0 follows every convention.

  document: openapi.yaml
  37 known findings suppressed by the baseline
```

**4. Shrink the baseline**

When a team fixes a problem, remove it from the baseline so it cannot come
back. The baseline should shrink towards zero.

```bash
apicovenant lint openapi.yaml --update-baseline .apicovenant-baseline.json
```

rewrites the file with the findings that are still there.

## Configuring the baseline

Set it once in the configuration file:

```json
{ "baseline": ".apicovenant-baseline.json" }
```

Then plain `apicovenant lint openapi.yaml` uses it. `--baseline <file>` points
at a different file, and `--no-baseline` ignores the configured one entirely.

## How a finding is identified

A finding is the same finding when its **rule**, **document position** and
**message** are all unchanged. The position is the JSON Pointer of the
offending node, for example `/paths/~1users/get`.

That has two consequences worth knowing:

- Moving a problem to a different position counts as a new finding. The
  baseline entry no longer matches.
- Rewording a rule's message counts as a new finding for the same reason.

Both are deliberate: a baseline should never silently hide something that
changed.

## Format

```json
{
  "apicovenant": 1,
  "createdAt": "2026-10-23T19:04:11.204Z",
  "updatedAt": "2026-10-23T19:04:11.204Z",
  "findings": [
    {
      "ruleId": "operation-id-required",
      "path": "/paths/~1create_stock_item/get",
      "message": "GET /create_stock_item has no operationId"
    }
  ]
}
```

The format is versioned. A baseline written by another version is rejected
with a clear error rather than being misread.
