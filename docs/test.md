# Contract testing

The full guide lives in [contract-testing.md](contract-testing.md). This page is
kept as the stable entry point named by the 1.1.0 release plan.

```bash
apicovenant test openapi.yaml
apicovenant test openapi.yaml --target http://127.0.0.1:8080
apicovenant test openapi.yaml --format junit --output contract.xml
```

`apicovenant test` generates one request per operation, starts the built-in mock
unless `--target` is supplied, and validates the documented status, media type
and response schema. Unsafe methods are skipped unless `--include-unsafe` is
given. See [contract-testing.md](contract-testing.md) for case generation,
skipped semantics, JUnit/SARIF output and CI examples.
