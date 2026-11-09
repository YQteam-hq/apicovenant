# `lint --fix`

`apicovenant lint --fix` repairs only mechanical findings whose correct rewrite
is unambiguous. It prints a unified diff by default; nothing is written until
`--write` is present.

```bash
apicovenant lint openapi.yaml --fix          # preview
apicovenant lint openapi.yaml --fix --write  # apply
```

## Safe fixes

| Rule | Rewrite |
| --- | --- |
| `path-no-trailing-slash` | Remove the trailing `/` from a path key |
| `schema-no-nullable` | In OpenAPI 3.1, replace `nullable: true` with a `"null"` entry in `type` |

Both fixes preserve the rest of the document. JSON is re-serialized with the
indentation detected in the source; YAML is edited line by line so comments and
ordering outside the changed lines survive. Running `--fix` twice is a no-op.

## Aggressive fixes

`--fix-aggressive` also rewrites underscore, hyphen or dot separated
`operationId` values to camelCase:

```bash
apicovenant lint openapi.yaml --fix --fix-aggressive --write
```

This is opt-in because generated clients may rename methods when the
`operationId` changes.

## What is never fixed

Semantic findings are left alone: missing examples, inconsistent envelopes,
security choices and naming conventions that require a human decision. The
command exits `0` after showing a diff, so it can be used as a review step in CI.
