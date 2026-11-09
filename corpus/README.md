# Public-spec corpus

The 1.1.0 compatibility work is checked against five real public OpenAPI
documents. They are downloaded into `corpus/specs/`, which is ignored by git and
is never fetched by CI.

```bash
node scripts/fetch-corpus.mjs
node scripts/fetch-corpus.mjs --force
```

| File | Provider | Version |
| --- | --- | --- |
| `github.openapi.json` | GitHub | 1.1.4 |
| `stripe.openapi.json` | Stripe | 2022-11-15 |
| `slack.openapi.json` | Slack | 1.7.0 |
| `medium.openapi.json` | Medium | 1.0 |
| `httpbin.openapi.json` | httpbin | 0.9.2 |

The documents come from the [APIs.guru](https://apis.guru/) catalogue and remain
the property of their providers. Do not commit them; the manifest records the
exact source URL and version.

## Local checks

```bash
# Parse and lint every corpus document
for f in corpus/specs/*.json; do node bin/apicovenant.mjs lint "$f" --format json >/dev/null; done

# Compatibility noise check: every document compared with itself has no changes
for f in corpus/specs/*.json; do node bin/apicovenant.mjs breaking --base "$f" --head "$f" --fail-on never; done
```

The syntax benchmark (`node scripts/bench.mjs`) uses a generated 10.8 MB
document so it stays deterministic and offline. The corpus is for manual
real-world checks and for investigating a report before opening an issue.
