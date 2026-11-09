# Traffic coverage

`apicovenant coverage` answers a different question from `lint` and `breaking`:
**does the traffic we recorded actually exercise the document?**

```bash
apicovenant coverage --golden traffic.golden.json --spec openapi.yaml
```

| Option | Meaning |
| --- | --- |
| `--golden <file>` | Golden file recorded by `apicovenant record` (required) |
| `--spec <file>` | OpenAPI document (required) |
| `--format <fmt>` | `text` (default), `json` or `sarif` |
| `--output <file>` | Write the report to a file; `-` means stdout |
| `--min <percent>` | Fail below this operation coverage (0-100) |
| `--fail-on <mode>` | `gap`, `undocumented` or `never` (default) |

## What is measured

- **Operation coverage** — an operation counts as exercised once a recorded
  request matches its method and path template.
- **Unexercised operations** — documented operations that no request touched.
- **Undocumented traffic** — requests whose path is not in the document
  (`path-not-documented`) or whose method is not documented for a known path
  (`method-not-documented`).
- **Status gaps** — a recorded status code that the operation does not document,
  including wildcard responses such as `2XX`. These are reported but do not fail
  the command by default.

Query parameters do not take part in matching. Only the method and the path
template decide which operation a request belongs to.

## Path specificity

Templates and literal paths can overlap. The most specific route wins, so
`GET /users/me` is attributed to the documented `/users/me` operation rather
than to `/users/{id}`. Specificity is ordered by:

1. more literal segments,
2. fewer parameter segments,
3. more literal characters (so `/files/{name}.json` beats `/{name}`),
4. longer path.

## Example output

```text
traffic coverage
  golden  traffic.golden.json
  spec    openapi.yaml
  operations  7/9 exercised (78%)

unexercised operations
  GET     /users/{userId}
  DELETE  /users/{userId}

undocumented traffic
  POST /admin/reset        path-not-documented
  PUT  /users/{userId}     method-not-documented

status gaps
  GET /users               documented 200; observed 200, 500
```

## Gates

- `--fail-on gap` requires 100% coverage, or the value of `--min` when given.
- `--fail-on undocumented` fails when any traffic is not documented.
- `--fail-on never` reports only.

A missing `--min` with `--fail-on gap` therefore means "every documented
operation must be exercised":

```bash
apicovenant coverage --golden traffic.json --spec openapi.yaml --fail-on gap
apicovenant coverage --golden traffic.json --spec openapi.yaml --min 85 --fail-on gap
```

## Golden compatibility

Golden files in format 1 and format 2 both work. Format 2 adds repeated query
parameters, every `Set-Cookie` value, the request body and base64 bodies; the
coverage engine only reads method, path and status, so migration is optional for
this command.
