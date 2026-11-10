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

## Examples

### Basic breaking change detection

```bash
# Compare two versions of your API
apicovenant breaking --base openapi.v1.yaml --head openapi.yaml

# Output:
# 1 breaking change · 0 risky · 2 compatible · 1 info
# 
# GET /users/{userId}
#   error   response-property-removed
#           Response property "email" was removed
#           paths./users~1{userId}/get.responses.200.content.application~1json.schema.properties.email
#           → Clients read the field; keep it or version the endpoint.
```

### Ignore specific change types

```bash
# Ignore breaking changes to response properties (for API cleanup)
apicovenant breaking --base old.yaml --head new.yaml --ignore-change response-property-removed
```

### JSON output for automation

```bash
# Generate JSON report for CI/CD pipelines
apicovenant breaking --base v1.yaml --head v2.yaml --format json --output breaking-report.json

# Output structure:
{
  "apicovenant": 1,
  "base": "v1.yaml",
  "head": "v2.yaml", 
  "summary": { "breaking": 1, "risky": 2, "compatible": 5, "info": 1, "total": 9 },
  "changes": [
    {
      "id": "parameter-required-added",
      "severity": "breaking",
      "operation": "POST /users",
      "location": {
        "base": "/paths/~1users/post/parameters/apiKey",
        "head": "/paths/~1users/post/parameters/apiKey"
      },
      "message": "Required parameter \"apiKey\" was added",
      "hint": "Existing clients don't send this parameter; they will get 400 errors."
    }
  ]
}
```

### SARIF output for GitHub code scanning

```bash
# Generate SARIF report for GitHub security scanning
apicovenant breaking --base main.yaml --head feature.yaml --format sarif --output breaking.sarif

# Upload to GitHub:
# gh code-scanning upload --sarif=breaking.sarif
```

### CI integration with different thresholds

```yaml
# .github/workflows/ci.yml
- name: Check for breaking changes
  run: |
    npx apicovenant breaking --base main.openapi.yaml --head openapi.yaml --fail-on breaking
    # Only fail on actual breaking changes (ignore risky)

- name: Strict mode - fail on risky changes  
  run: |
    npx apicovenant breaking --base main.openapi.yaml --head openapi.yaml --fail-on risky
    # Fail on breaking + risky changes

- name: Paranoia mode - fail on any change
  run: |
    npx apicovenant breaking --base main.openapi.yaml --head openapi.yaml --fail-on any
    # Fail on any change (even compatible ones)
```

### Configuration file usage

```json
// apicovenant.config.json
{
  "version": 2,
  "breaking": {
    "fail-on": "risky",
    "ignore-change": ["response-property-added"]
  }
}
```

```bash
# Use configuration file
apicovenant breaking --base old.yaml --head new.yaml --config apicovenant.config.json
```

### Common scenarios and their severities

#### Breaking changes (require API versioning)

- Removing an operation (`operation-removed`)
- Adding required parameters (`parameter-required-added`) 
- Changing parameter types (`parameter-type-changed`)
- Removing response properties (`response-property-removed`)
- Adding security requirements (`security-requirement-added`)

#### Risky changes (review before release)

- Deprecating operations (`deprecated-added`)
- Removing optional parameters (`parameter-optional-removed`)
- Changing response structure in backwards-incompatible ways (`schema-composition-changed`)

#### Compatible changes (safe to release)

- Adding new operations (`operation-added`)
- Adding optional parameters (`parameter-optional-added`)
- Adding new response properties (`response-property-added`)
- Widening enum values (`schema-enum-widened`)

#### Info changes (documentation only)

- Adding new defaults (`default-changed`)
- Adding new servers (`server-added`)
