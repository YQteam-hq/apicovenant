# Breaking-change detection

`apicovenant breaking` compares two OpenAPI documents and answers one question:
**will a client written against the old document still work against the new one?**

```bash
apicovenant breaking --base openapi.v1.yaml --head openapi.yaml
```

| Option | Meaning |
| --- | --- |
| `--base <file>` | The old document (required) |
| `--head <file>` | The new document (required) |
| `--format <fmt>` | `text` (default), `json` or `sarif` |
| `--output <file>` | Write the report to a file; `-` means stdout |
| `--fail-on <level>` | `breaking` (default), `risky`, `any` or `never` |
| `--ignore-change <id>` | Ignore a change class; repeatable |
| `--config <file>` | Read the `breaking` section of a v2 configuration |

Exit codes: `0` no change at or above the threshold, `1` the threshold was hit,
`2` invalid usage, `3` the document could not be read or parsed.

## Severities

- **breaking** — an existing client is expected to fail.
- **risky** — behaviour changes for some clients; review it.
- **compatible** — additive or relaxing; old clients keep working.
- **info** — a note, not a compatibility judgement (for example a new default).

`--fail-on breaking` only fails on breaking changes; `risky` fails on breaking
and risky changes; `any` fails on any change at all.

## Change classes

The ids are stable and are what `--ignore-change` accepts.

### Operations

| Id | Severity |
| --- | --- |
| `operation-removed` | breaking |
| `operation-added` | compatible |
| `operation-id-changed` | risky |
| `deprecated-added` | info |

### Parameters

| Id | Severity |
| --- | --- |
| `parameter-required-added` | breaking |
| `parameter-required-removed` | breaking |
| `parameter-optional-removed` | risky |
| `parameter-optional-added` | compatible |
| `parameter-type-changed` | breaking |
| `parameter-location-changed` | breaking |

### Request bodies

| Id | Severity |
| --- | --- |
| `request-body-required-added` | breaking |
| `request-body-removed` | risky |
| `request-body-added` | compatible |
| `request-media-type-removed` | breaking |
| `request-media-type-added` | compatible |
| `request-property-required-added` | breaking |
| `request-property-removed` | risky |
| `request-property-added` | compatible |
| `request-property-type-changed` | breaking |

### Responses

| Id | Severity |
| --- | --- |
| `response-status-removed` | breaking |
| `response-status-added` | compatible |
| `response-media-type-removed` | breaking |
| `response-media-type-added` | compatible |
| `response-property-removed` | breaking |
| `response-property-added` | compatible |
| `response-property-required-added` | risky |
| `response-property-type-changed` | breaking |
| `response-property-type-widened` | compatible |
| `response-header-removed` | risky |
| `response-header-added` | compatible |

### Schemas

| Id | Severity |
| --- | --- |
| `schema-composition-changed` | risky |
| `schema-enum-narrowed` | breaking (request direction) |
| `schema-enum-widened` | compatible (request direction) |
| `schema-additional-properties-forbidden` | breaking |
| `schema-additional-properties-allowed` | compatible |
| `default-changed` | info |

### Security and servers

| Id | Severity |
| --- | --- |
| `security-requirement-added` | breaking |
| `security-scope-added` | breaking |
| `security-requirement-removed` | compatible |
| `server-removed` | risky |
| `server-added` | compatible |

## JSON report

```json
{
  "apicovenant": 1,
  "base": "openapi.v1.yaml",
  "head": "openapi.yaml",
  "summary": { "breaking": 1, "risky": 0, "compatible": 0, "info": 0, "total": 1 },
  "changes": [
    {
      "id": "response-property-removed",
      "severity": "breaking",
      "operation": "GET /users/{userId}",
      "location": {
        "base": "/paths/~1users~1{userId}/get/responses/200/content/application~1json/schema/properties/email",
        "head": null
      },
      "message": "Response property \"email\" was removed",
      "hint": "Clients read the field; keep it or version the endpoint."
    }
  ]
}
```

`location.base` and `location.head` are JSON Pointers when the node exists on
that side and `null` when it does not.

## CI

```yaml
- run: npx apicovenant breaking --base main.openapi.yaml --head openapi.yaml --fail-on risky
```

SARIF can be uploaded to GitHub code scanning:

```bash
apicovenant breaking --base old.yaml --head new.yaml --format sarif --output breaking.sarif
```

## Limitations

- `oneOf`/`anyOf` variants are not paired; a changed composition is reported
  once as `schema-composition-changed` instead of guessing which variant
  replaced which.
- External `$ref` files are bundled before comparison, so split documents work.
- Recursive schemas are compared up to a bounded depth to avoid cycles.
- A change that cannot be classified confidently is reported as `risky`.
