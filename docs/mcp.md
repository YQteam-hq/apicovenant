<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/logo-lockup-mono.svg">
    <source media="(prefers-color-scheme: light)" srcset="../assets/logo-lockup.svg">
    <img src="../assets/logo-lockup.svg" alt="apicovenant" width="440">
  </picture>
</p>

# The Model Context Protocol server

`apicovenant mcp` speaks the [Model Context Protocol](https://modelcontextprotocol.io)
over stdio, so an AI agent can check a contract, understand an API and prove
that a change did not break it — without leaving the conversation.

The protocol is implemented directly against the specification: JSON-RPC 2.0
over stdin and stdout, one message per line. There is **no MCP SDK dependency**,
so the zero-runtime-dependency promise still holds.

## Connecting a client

The server is started as a subprocess. Every MCP client configures that the
same way.

```json
{
  "mcpServers": {
    "apicovenant": {
      "command": "apicovenant",
      "args": ["mcp"]
    }
  }
}
```

Without installing it globally:

```json
{
  "mcpServers": {
    "apicovenant": {
      "command": "npx",
      "args": ["-y", "apicovenant", "mcp"]
    }
  }
}
```

The file name depends on the client: `claude_desktop_config.json` for Claude
Desktop, `mcp.json` for Cursor and Windsurf, and the settings of your editor
for the IDEs that speak MCP.

Paths given to the tools are resolved against the working directory the server
was started in.

## The tools

| Tool | What it does |
| --- | --- |
| `lint_openapi` | Check a document against the design-convention rules. |
| `list_rules` | The rule catalogue, optionally filtered by category. |
| `list_operations` | Every operation with its parameters and documented responses. |
| `example_response` | A response body generated from the documented schema. |
| `check_contract_drift` | Replay a golden file and report every difference. |

### `lint_openapi`

| Argument | Type | Meaning |
| --- | --- | --- |
| `path` | string, required | The OpenAPI document. |
| `severity` | `error` \| `warn` \| `info` | The lowest severity to report. Defaults to `info`. |
| `rules` | string[] | Rule ids to run exclusively. |
| `ignore` | string[] | Rule ids that never run. |
| `baseline` | string | A baseline file; recorded findings are suppressed. |

The result carries the findings as text and as `structuredContent`, with the
counts per severity, the JSON Pointer of every finding and the hint on how to
fix it.

### `list_operations`

| Argument | Type | Meaning |
| --- | --- | --- |
| `path` | string, required | The OpenAPI document. |

### `example_response`

| Argument | Type | Meaning |
| --- | --- | --- |
| `path` | string, required | The OpenAPI document. |
| `method` | string, required | `get`, `post`, `put`, `patch`, `delete` … |
| `operationPath` | string, required | The API path, for example `/users/{userId}`. |
| `status` | number | The response status. Defaults to the first success response. |

The payload is the same one the mock server serves, so it satisfies the schema
it was generated from.

### `check_contract_drift`

| Argument | Type | Meaning |
| --- | --- | --- |
| `goldenFile` | string, required | A golden file written by `apicovenant record`. |
| `spec` | string | An OpenAPI document. A mock is built from it. |
| `target` | string | The base URL of a live API. |

One of `spec` and `target` is required. The report lists the status codes,
headers and body fields that moved, each addressed by JSON Pointer.

## The resources

| URI | Contents |
| --- | --- |
| `apicovenant://rules` | The full rule reference, as markdown. |
| `apicovenant://docs` | An index of the guides that ship with the tool. |

## The protocol

The server implements the `2025-06-18` revision of the specification and
answers `initialize` with the version the client asked for when it is one it
knows.

| Method | Behaviour |
| --- | --- |
| `initialize` | Negotiates the version and announces the capabilities. |
| `ping` | Answers with an empty result. |
| `tools/list` | The five tools, with their input schemas. |
| `tools/call` | Runs a tool. A tool that fails answers with `isError: true`. |
| `resources/list` | The two resources. |
| `resources/read` | The contents of one resource. |

Notifications never get a response, and an unknown method is a JSON-RPC error
with the code `-32601`.

## Talking to it by hand

The transport is plain text, so a shell pipeline is enough to try it:

```console
$ echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{}}}' \
    | apicovenant mcp
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18",...}}
```

## Security

The server reads the files it is asked to read, and it starts a mock server on
localhost to replay a golden file. It writes nothing. Run it in the directory
you are working in, and treat a tool that reads a path as something to check
before it is approved.
