export const MAIN_HELP = `apicovenant — an OpenAPI contract guardian

Usage:
  apicovenant <command> [options]

Commands:
  init                Write a starter configuration file
  lint <spec>         Check the design conventions of an OpenAPI document
  mock <spec>         Serve a mock API generated from an OpenAPI document
  record              Record real traffic into a golden file
  diff                Replay a golden file against a live API and report drift
  breaking            Detect breaking changes between two OpenAPI documents
  coverage            Measure recorded traffic against an OpenAPI document
  test <spec>         Generate and run contract tests from an OpenAPI document
  migrate             Migrate a v1 configuration or golden file
  rules               Show the catalogue of lint rules
  mcp                 Serve the contract tools over the Model Context Protocol

Options:
  -h, --help          Show this help
  -v, --version       Show the version

Run "apicovenant <command> --help" for command specific options.
`;

export const MCP_HELP = `apicovenant mcp — serve the contract tools over the Model Context Protocol

Usage:
  apicovenant mcp

Options:
  -h, --help          Show this help

Notes:
  The server speaks JSON-RPC 2.0 over stdin and stdout, one message per line.
  Point an MCP client at it:

    {
      "mcpServers": {
        "apicovenant": {
          "command": "apicovenant",
          "args": ["mcp"]
        }
      }
    }

  It exposes lint_openapi, list_rules, list_operations, example_response and
  check_contract_drift. See docs/mcp.md.
`;

export const INIT_HELP = `apicovenant init — write a starter configuration file

Usage:
  apicovenant init [options]

Options:
  --output <file>     Name of the file to create (default: apicovenant.config.json)
  --force             Overwrite an existing file
  --config-version <n>
                      Write a v1 (1) or v2 (2, default) configuration
  -h, --help          Show this help

Notes:
  The generated file is plain JSON. YAML files (apicovenant.config.yaml) are
  supported too, as is an "apicovenant" key in package.json.
`;

export const LINT_HELP = `apicovenant lint — check the design conventions of an OpenAPI document

Usage:
  apicovenant lint <spec> [options]

Arguments:
  <spec>             Path to an OpenAPI document (YAML or JSON). Use "-" to read stdin.

Options:
  --format <fmt>      Report format: text (default), json, html or sarif
  --output <file>     Write the report to a file instead of stdout
  --rules <ids>       Comma separated list of rules to run exclusively
  --ignore <ids>      Comma separated list of rules to skip
  --severity <level>  Minimum severity to report: error, warn or info (default: info)
  --fail-on <level>   Exit with code 1 when findings of this level or worse exist
                       (error, warn or never; default: error)
  --list-rules        Print the rule catalogue instead of running the linter
  --config <file>     Read the configuration from this file
  --baseline <file>   Ignore findings recorded in this baseline file
  --update-baseline <file>
                      Record the current findings as the baseline and exit
  --no-baseline       Ignore the baseline configured in the configuration file
  --no-plugins        Do not load plugins from the configuration file
  --watch             Re-run when the document changes (Ctrl+C to stop)
  --fix               Preview mechanical fixes as a unified diff
  --dry-run           Preview fixes without writing (the default with --fix)
  --write             Apply the fixes (implies --fix)
  --fix-aggressive    Also rename operationId values to camelCase (risky)
  --strict-schema     Warn about unsupported OpenAPI 3.1 schema keywords
  -h, --help          Show this help

Examples:
  apicovenant lint openapi.yaml
  apicovenant lint openapi.yaml --format json --output report.json
  apicovenant lint openapi.yaml --ignore schema-example-recommended
  apicovenant lint openapi.yaml --update-baseline .apicovenant-baseline.json
  apicovenant lint openapi.yaml --baseline .apicovenant-baseline.json
  apicovenant lint openapi.yaml --fix --write
`;

export const MOCK_HELP = `apicovenant mock — serve a mock API generated from an OpenAPI document

Usage:
  apicovenant mock <spec> [options]

Arguments:
  <spec>             Path to an OpenAPI document (YAML or JSON)

Options:
  --port <n>          Port to listen on (default: a free random port)
  --host <host>       Host to bind to (default: 127.0.0.1)
  --latency <ms>      Artificial latency added to every response
  --strict            Validate parameters and the request body; reject bad
                       requests with 400, unsupported media types with 415 and
                       oversized bodies with 413
  --strict-unknown    Reject query, header and cookie parameters that are not
                       documented in the spec
  --cors              Answer CORS preflight requests and allow every origin
  --cors-origin <origin>
                       Allow this origin (repeatable; implies --cors)
  --watch             Reload the document when the file changes
  --max-body <bytes>  Request body limit (default: 10485760)
  --config <file>     Read mock defaults from a configuration file
  -h, --help          Show this help

Notes:
  The mock answers from the documented schemas. Request "?x-mock-status=404"
  to force a specific status code, and GET /_apicovenant/routes for the
  route table.

Examples:
  apicovenant mock openapi.yaml --port 4010
  apicovenant mock openapi.yaml --strict --cors --watch
  apicovenant mock openapi.yaml --cors-origin https://app.example.com
  apicovenant mock openapi.yaml --max-body 1048576
`;

export const RECORD_HELP = `apicovenant record — record real traffic into a golden file

Usage:
  apicovenant record --target <url> --out <file> [options]

Options:
  --target <url>      Base URL of the API to record (required)
  --out <file>        Where to write the golden file (required)
  --spec <file>       OpenAPI document to remember in the golden file
  --port <n>          Port the recording proxy listens on (default: free random port)
  --max-requests <n>  Stop after this many requests
  --duration <sec>    Stop after this many seconds
  --redact-header <name>
                      Also redact this header; repeatable
  --redact-query <name>
                      Also redact this query parameter; repeatable
  -h, --help          Show this help

Notes:
  Credentials are redacted before the exchange is written to disk.

Examples:
  apicovenant record --target http://localhost:3000 --out traffic.golden.json
`;

export const DIFF_HELP = `apicovenant diff — replay a golden file and report contract drift

Usage:
  apicovenant diff --golden <file> [--target <url> | --spec <file>] [options]

Options:
  --golden <file>     Golden file to replay (required)
  --target <url>      Base URL of the live API to compare against
  --spec <file>       Compare against a mock generated from this OpenAPI document
  --format <fmt>      Report format: text (default), json or html
  --output <file>     Write the report to a file instead of stdout
  --config <file>     Read the configuration from this file
  --replay-all        Also replay unsafe methods (POST, PUT, PATCH, DELETE)
  --compare-header <name>
                      Compare only this response header; repeatable. Replaces the
                      default list (content-type, location, etag, cache-control).
  --ignore-header <name>
                      Never compare this response header; repeatable. Wins over
                      --compare-header.
  --ignore-path <ptr> Ignore body changes at this JSON Pointer pattern; repeatable.
                      A single star matches one segment, a double star any number.
  -H, --header <h>    Send this header on every request ("Name: value"), repeatable.
                      Overrides the recorded value, which is useful for re-adding
                      credentials the recorder redacted.
  --query <n=v>       Override or add a query parameter, repeatable. The recorder
                      redacts credential-like query keys; this re-adds them.
  --fail-on <level>   Exit with code 1 when the contract drifted (changed or never)
  -h, --help          Show this help

Notes:
  By default only safe methods are replayed, so running a diff never creates
  data on the target system.

Examples:
  apicovenant diff --golden traffic.golden.json --target http://localhost:3000
  apicovenant diff --golden traffic.golden.json --spec openapi.yaml --format html --output drift.html
  apicovenant diff --golden traffic.golden.json --target http://localhost:3000 \
    -H "Authorization: Bearer $TOKEN" 
  apicovenant diff --golden traffic.golden.json --target http://localhost:3000 \
    --query "api_key=$API_KEY"
`;

export const RULES_HELP = `apicovenant rules — show the catalogue of lint rules

Usage:
  apicovenant rules [options]

Options:
  --format <fmt>      Output format: text (default) or json
  --category <name>   Only show rules of this category
  --strict            Include the six opt-in strict rules (49 total)
  -h, --help          Show this help

Examples:
  apicovenant rules
  apicovenant rules --category responses --format json
`;

export const BREAKING_HELP = `apicovenant breaking — detect breaking changes between two OpenAPI documents

Usage:
  apicovenant breaking --base <old> --head <new> [options]

Options:
  --base <file>        Old OpenAPI document (required)
  --head <file>        New OpenAPI document (required)
  --format <fmt>       text (default), json or sarif
  --output <file>      Write to a file, or "-" for stdout
  --fail-on <level>    breaking (default), risky, any or never
  --ignore-change <id> Ignore a change id; repeatable
  --config <file>      Read the configuration from this file

Examples:
  apicovenant breaking --base openapi.v1.yaml --head openapi.yaml
  apicovenant breaking --base old.yaml --head new.yaml --format sarif --output breaking.sarif
  apicovenant breaking --base old.yaml --head new.yaml --ignore-change deprecated-added
`;

export const COVERAGE_HELP = `apicovenant coverage — measure recorded traffic against an OpenAPI document

Usage:
  apicovenant coverage --golden <file> --spec <file> [options]

Options:
  --golden <file>      Golden file (required)
  --spec <file>        OpenAPI document (required)
  --format <fmt>       text (default), json or sarif
  --output <file>      Write to a file, or "-" for stdout
  --min <percent>      Fail below this operation coverage (0-100)
  --fail-on <mode>     gap, undocumented or never (default: never)
  --config <file>      Read the configuration from this file

Examples:
  apicovenant coverage --golden traffic.golden.json --spec openapi.yaml
  apicovenant coverage --golden traffic.golden.json --spec openapi.yaml --min 90 --fail-on gap
`;

export const MIGRATE_HELP = `apicovenant migrate — migrate a v1 configuration or golden file

Usage:
  apicovenant migrate (--config <file> | --golden <file>) [options]

Options:
  --config <file>      Migrate a v1 configuration to the v2 layout
  --golden <file>      Migrate a v1 golden file to format 2
  --output <file>      Write to a file; by default the result goes to stdout
  --dry-run            Print a unified diff instead of the migrated document
  --force              Overwrite an existing --output file
  -h, --help           Show this help

Notes:
  Migrating a golden file to format 2 is one-way: apicovenant 1.0.x cannot
  read format 2. Keep a copy of the v1 file for rollback.
`;

export const TEST_HELP = `apicovenant test — run generated contract tests against a mock or a live API

Usage:
  apicovenant test <spec> [options]

Arguments:
  <spec>             Path to an OpenAPI document (YAML or JSON)

Options:
  --target <url>     Test a running API instead of the built-in mock
  --include-unsafe   Also send POST, PUT, PATCH and DELETE requests
  --max-cases <n>    Stop after this many operations (default: 200)
  --fail-on <level>  Exit with code 1 on failure or never (default: failure)
  --format <format>  text, json, junit or sarif (default: text)
  --output <file>    Write the report to a file; "-" means stdout
  --config <file>    Read test defaults from a configuration file
  -h, --help         Show this help

Notes:
  Without --target the command starts a mock from the same document and tests
  the documented success responses. Unsafe methods are skipped unless
  --include-unsafe is given, because the command has no fixture data.

Examples:
  apicovenant test openapi.yaml
  apicovenant test openapi.yaml --include-unsafe --format junit --output report.xml
  apicovenant test openapi.yaml --target http://127.0.0.1:4010
`;
