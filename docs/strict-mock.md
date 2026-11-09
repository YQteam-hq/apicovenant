# Strict mock

`apicovenant mock` serves deterministic responses from an OpenAPI document.
With `--strict` it also becomes a test double that rejects requests the document
does not allow.

```bash
apicovenant mock openapi.yaml --strict
apicovenant mock openapi.yaml --strict --cors --watch --max-body 1048576
```

## Validation

The request is matched to an operation first, then validated:

| Location | Checked |
| --- | --- |
| Path | Required, type coercion, enum, pattern and the schema constraints |
| Query | Required, type coercion (including arrays), enum and schema constraints |
| Header | Required, type coercion, enum and schema constraints |
| Cookie | Required, type coercion and schema constraints |
| Body | Required body, `Content-Type`, JSON syntax, schema validation |

A request that fails validation is answered with one of:

| Status | `error` | Cause |
| --- | --- | --- |
| `400` | `invalid_request` | Missing/invalid parameter, invalid JSON or a schema violation |
| `413` | `payload_too_large` | Body above `--max-body` |
| `415` | `unsupported_media_type` | A body whose `Content-Type` is not documented |

```json
{
  "error": "invalid_request",
  "violations": [
    { "in": "query", "name": "page", "path": "/page", "message": "must be an integer" }
  ]
}
```

Unknown query parameters and headers are accepted by default: clients often
send tracing headers, and rejecting them would make the mock unusable behind a
gateway. Add `--strict-unknown` (or `mock.strictUnknown` in configuration) to
reject undocumented query, header and cookie names as well. Transport headers
(`host`, `connection`, `content-type`, `accept*`, `authorization`, `cookie`,
`origin`, `referer`, `user-agent`, `content-length`, `transfer-encoding`),
`sec-*`/`x-forwarded-*`/`x-real-*` and `x-mock-*` headers are always accepted.
`x-mock-status` remains a mock control parameter and is never treated as an
undocumented query parameter.

## CORS

`--cors` answers preflight requests and adds `Access-Control-Allow-Origin: *` to
every response. `--cors-origin <origin>` may be repeated to allow specific
origins; the matching origin is echoed and credentials are allowed.

```bash
apicovenant mock openapi.yaml --cors-origin https://app.example.com
```

A preflight receives `204` with the methods documented for the path, the
requested headers and `Access-Control-Max-Age: 600`.

## Watching the document

`--watch` listens for changes to the document and rebuilds the route table after
a 300 ms debounce. A document that fails to parse is reported on stderr and the
previous routes stay in service, so a broken edit does not stop the mock.

## Limits

`--max-body` defaults to `10485760` bytes (10 MB). A larger request receives
`413` and the connection is closed. The HTTP server also keeps bounded header
and request timeouts (60 s and 300 s); keep-alive is disabled to avoid
`ECONNRESET` on reused test connections.

## Configuration

```json
{
  "version": 2,
  "mock": {
    "strict": true,
    "strictUnknown": true,
    "cors": ["https://app.example.com"],
    "watch": true,
    "maxBody": 1048576
  }
}
```

CLI flags win over the section. `cors` accepts `true`, `false` or a list of
origins.

## Differences from a production server

- The mock is stateless: writes do not change later reads.
- Authentication is not enforced; security schemes are documentation only.
- Body validation covers JSON media types. Other media types are checked for
  `Content-Type` but not decoded.
