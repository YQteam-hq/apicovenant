# OpenAPI 3.1 keyword support

The built-in validator evaluates the JSON Schema 2020-12 keywords that matter
for request and response contracts. It does not require a schema validator
dependency.

## Evaluated keywords

| Keyword | Behaviour |
| --- | --- |
| `unevaluatedProperties` | Rejects (or validates) properties not evaluated by `properties`, composition branches, `if`/`then`/`else` or `dependentSchemas` when `additionalProperties` is absent |
| `dependentRequired` | When a property is present, its dependent properties must also be present |
| `dependentSchemas` | When a property is present, the whole instance is validated against the dependent schema |
| `if` / `then` / `else` | The `if` schema selects exactly one branch |
| `$dynamicRef` | Local JSON Pointer targets (`#/$defs/...`) are resolved statically; anchors and remote dynamic scopes are not |

`type` arrays, `const`, `prefixItems`, `examples` and the existing validation
keywords continue to work.

## Unsupported keywords

Keywords that this build does not evaluate are reported as warnings when
`--strict-schema` is used:

```bash
apicovenant lint openapi.yaml --strict-schema
```

The warning has rule id `schema-unsupported-keyword` and points at the exact
JSON Pointer. Without the flag the validator stays silent, preserving the
default rule set and all v1 results.

`$dynamicRef` is resolved only when it points at a local JSON Pointer. A dynamic
anchor such as `#meta` needs the caller's dynamic scope, so it is left in place;
use `--strict-schema` to surface other unsupported constructs explicitly. The
1.1.0 line intentionally does not claim OpenAPI 3.2 support.
