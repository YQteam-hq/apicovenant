# Plugin example

`team-plugin.mjs` is a complete plugin with one rule, one reporter and one
preset. Copy this directory into your repository, install `apicovenant`, and
run:

```bash
apicovenant lint ../../examples/shop.openapi.yaml \
  --config apicovenant.config.json --format team
```

The configuration loads the plugin and uses its `team` preset. Remove the
`--format team` argument to use the normal report; the custom rule still runs.

Plugins execute in-process without a sandbox. Only load code you trust.
