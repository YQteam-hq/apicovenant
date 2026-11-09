# Contract tests

`apicovenant test` generates one request per operation from the document, sends
it, and checks that the response matches what the document promises.

```bash
apicovenant test openapi.yaml
apicovenant test openapi.yaml --include-unsafe
apicovenant test openapi.yaml --target http://127.0.0.1:8080
apicovenant test openapi.yaml --format junit --output report.xml
```

## Where the requests go

Without `--target` the command starts a mock from the same document and tests
that. This proves that the document is self-consistent: the mock's generated
responses must satisfy the documented schemas.

`--target` points the same generated cases at a running API. No mock is started.

## What is generated

For every operation:

- Path parameters are replaced with the parameter's `example`, the schema's
  `default`/`example`, or a deterministic generated value.
- Required query, header and cookie parameters are sent. Optional parameters are
  sent only when they have an example or a default, so the command does not
  invent values a real client would not send.
- The request body uses the first documented media type, preferring JSON. Its
  value comes from the media type example or from the schema.
- The expected statuses are every key in `responses` (exact, `2XX` and
  `default`).

`POST`, `PUT`, `PATCH` and `DELETE` are **skipped by default** because the
command has no fixture data and must not mutate an API during a smoke run. Pass
`--include-unsafe` to run them, ideally against a mock or a disposable
environment.

`--max-cases` (default 200) stops the run after that many operations.

## What is checked

1. The response status is documented.
2. When the matched response has content, `Content-Type` is documented for that
   response.
3. JSON bodies validate against the response schema.

A failure names the first violation; the JSON format keeps one message per
case.

## Formats

| Format | Use |
| --- | --- |
| `text` | Terminal output (default) |
| `json` | Tooling and dashboards |
| `junit` | CI test reporters (Jenkins, GitLab, GitHub) |
| `sarif` | Code scanning |

```bash
apicovenant test openapi.yaml --format junit --output reports/contract.xml
```

`--fail-on failure` (default) exits `1` when a case fails. `--fail-on never`
always exits `0`, which is useful while adopting the command.

## Configuration

```json
{
  "version": 2,
  "test": {
    "includeUnsafe": false,
    "maxCases": 200,
    "failOn": "failure",
    "format": "junit",
    "output": "reports/contract.xml"
  }
}
```

CLI flags win over the section.
