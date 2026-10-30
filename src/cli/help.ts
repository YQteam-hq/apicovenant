export const MAIN_HELP = `apicovenant — an OpenAPI contract guardian

Usage:
  apicovenant <command> [options]

Commands:
  init                Write a starter configuration file
  lint <spec>         Check the design conventions of an OpenAPI document
  mock <spec>         Serve a mock API generated from an OpenAPI document
  record              Record real traffic into a golden file
  diff                Replay a golden file against a live API and report drift
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
  --format <fmt>      Report format: text (default), json or html
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
  -h, --help          Show this help

Examples:
  apicovenant lint openapi.yaml
  apicovenant lint openapi.yaml --format json --output report.json
  apicovenant lint openapi.yaml --ignore schema-example-recommended
  apicovenant lint openapi.yaml --update-baseline .apicovenant-baseline.json
  apicovenant lint openapi.yaml --baseline .apicovenant-baseline.json
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
  -h, --help          Show this help

Notes:
  The mock answers from the documented schemas. Request "?x-mock-status=404"
  to force a specific status code, and GET /_apicovenant/routes for the
  route table.

Examples:
  apicovenant mock openapi.yaml --port 4010
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
  --fail-on <level>   Exit with code 1 when the contract drifted (changed or never)
  -h, --help          Show this help

Notes:
  By default only safe methods are replayed, so running a diff never creates
  data on the target system.

Examples:
  apicovenant diff --golden traffic.golden.json --target http://localhost:3000
  apicovenant diff --golden traffic.golden.json --spec openapi.yaml --format html --output drift.html
`;

export const RULES_HELP = `apicovenant rules — show the catalogue of lint rules

Usage:
  apicovenant rules [options]

Options:
  --format <fmt>      Output format: text (default) or json
  --category <name>   Only show rules of this category
  -h, --help          Show this help

Examples:
  apicovenant rules
  apicovenant rules --category responses --format json
`;
