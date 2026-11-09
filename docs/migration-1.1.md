# Migrating to 1.1.0

1.1.0 is additive. Existing commands, flags, library exports and v1
configuration/golden files keep working, so an upgrade without migration is
safe. Two file formats gained a v2 layout; migrate only when you want the new
capabilities.

## Before you upgrade

- Node.js 22.18 or newer (unchanged).
- No runtime dependencies (unchanged).
- Keep a copy of every golden file you migrate. Format 2 is one-way: 1.0.x
  cannot read it.

## Configuration v1 → v2

Preview the rewrite:

```bash
apicovenant migrate --config apicovenant.config.json --dry-run
```

Write it to a new file:

```bash
apicovenant migrate --config apicovenant.config.json --output apicovenant.config.v2.json
```

Write it in place (the original is replaced, so commit it first):

```bash
apicovenant migrate --config apicovenant.config.json --output apicovenant.config.json --force
```

A v1 document such as:

```json
{
  "rules": { "ignore": ["schema-example-recommended"] },
  "severity": "warn",
  "failOn": "warn",
  "baseline": ".apicovenant-baseline.json"
}
```

becomes:

```json
{
  "version": 2,
  "lint": {
    "rules": { "ignore": ["schema-example-recommended"] },
    "severity": "warn",
    "failOn": "warn",
    "baseline": ".apicovenant-baseline.json"
  }
}
```

Nothing is invented: keys the v1 format cannot express are left out.

## Golden v1 → v2

Format 2 adds:

- repeated query parameters (`?tag=a&tag=b` is no longer collapsed),
- every `Set-Cookie` value instead of one comma-joined header,
- the request body, so `diff --replay-all` sends what the client sent,
- `bodyEncoding: "base64"` and `bodyType: "binary"` for byte-exact bodies.

Preview and write:

```bash
apicovenant migrate --golden traffic.golden.json --dry-run
apicovenant migrate --golden traffic.golden.json --output traffic.v2.golden.json
```

All 1.1.0 commands read format 1 directly. Migration is only required if another
tool needs format 2, or if you want the golden to be rewritten with the new
fields.

### Rollback

- 1.1.0 still reads format 1, so an untouched v1 file keeps working.
- If you replaced a file in place, restore it from version control.
- Do not downgrade the golden file format while 1.0.x is in use. Regenerate it
  with `apicovenant record` from the 1.0.x release if you no longer have the
  original.

## Known incompatibilities

| Item | Direction | Effect |
| --- | --- | --- |
| Golden format 2 | 1.1.0 → 1.0.x | 1.0.x refuses format 2 with "unsupported golden file format version" |
| v2 configuration | 1.1.0 → 1.0.x | 1.0.x rejects `version` and the command sections as unknown keys |
| Reports | — | `text`/`json`/`html` are unchanged; `sarif` is new |

Everything else is a superset of 1.0.4.

## CI quick start

```yaml
- run: npx apicovenant lint openapi.yaml --fail-on error
- run: npx apicovenant breaking --base main.openapi.yaml --head openapi.yaml --fail-on breaking
- run: npx apicovenant coverage --golden traffic.golden.json --spec openapi.yaml --min 80 --fail-on gap
```
