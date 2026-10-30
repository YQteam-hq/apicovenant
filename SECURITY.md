# Security Policy

## Supported versions

apicovenant is pre-1.0 in the sense that it has just reached its first stable
release. Security fixes land on the latest release line only.

| Version | Supported |
| --- | --- |
| 1.0.x | ✅ |
| < 1.0 | ❌ |

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Write to [yqteam@yeah.net](mailto:yqteam@yeah.net) with:

- what the problem is, and how to reproduce it
- the affected version, the Node.js version and the platform
- what an attacker could do with it

You will get an acknowledgement within a few days, and a fix or an
explanation of why the report does not qualify. Please give the maintainers
a reasonable amount of time to ship a fix before disclosing it publicly.

## What the tool handles

The tool is a local CLI. It reads OpenAPI documents and talks to HTTP servers
you point it at. Two areas are worth knowing about:

- **The recorder.** `apicovenant record` sits in front of an API and writes
  every exchange to a golden file. Authorization headers, cookies and API key
  headers are redacted before anything is written to disk, but **the request
  and response bodies are not** — a body can still contain a token. Review
  the golden file before you commit it.
- **The mock server.** `apicovenant mock` serves generated payloads on
  localhost. It binds to `127.0.0.1` by default; `--host` makes it reachable
  from other machines, so do not use that on an untrusted network.
