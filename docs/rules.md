<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/logo-lockup-mono.svg">
    <source media="(prefers-color-scheme: light)" srcset="../assets/logo-lockup.svg">
    <img src="../assets/logo-lockup.svg" alt="apicovenant" width="440">
  </picture>
</p>

# Rule reference

Every rule `apicovenant` ships with. Rules are grouped by category and listed
in the order they are executed.

| Severity | Meaning |
| --- | --- |
| `error` | The contract is broken or self-contradictory. Fix it. |
| `warn` | The contract works but is inconsistent with the rest of the API. |
| `info` | Polish. Worth fixing when there is time. |

Run a subset with `--rules`, silence rules with `--ignore`, and hide low
severities with `--severity`. `apicovenant rules` prints the same catalogue at
runtime.

---

## document

### `openapi-version-supported` · error

The document must declare `openapi: 3.0.x` or `3.1.x`. Other versions are
rejected so that no rule ever misreads the contract.

```yaml
openapi: 3.1.0
```

### `info-contact-required` · info

`info.contact` should name a team, a URL or an email address. It is the only
place consumers can find out who to ask when the API breaks.

### `info-license-required` · info

`info.license` states the terms under which the API may be used. It matters
as soon as the document leaves the team that wrote it.

### `server-https` · warn

Server URLs must use `https://`. Local development hosts (`localhost`,
`127.0.0.1`, `*.local`) are exempt because they never leave the machine.

```yaml
servers:
  - url: https://api.example.com/v1
```

### `tag-declared` · warn

Every tag used by an operation must also appear in the top level `tags` list,
otherwise it shows up in the documentation without a description and in an
unpredictable order.

---

## operations

### `operation-id-required` · error

Every operation needs an `operationId`. It is the stable identity of an
endpoint across releases: generated SDKs, client libraries and documentation
are all keyed by it.

```yaml
get:
  operationId: listUsers
```

### `operation-id-unique` · error

Two operations must never share an `operationId`. Colliding ids produce
colliding client methods in every generated SDK.

### `operation-id-naming` · warn

An `operationId` should be camelCase and start with a verb (`get`, `list`,
`create`, `update`, `delete`, `cancel`, …), so that it reads like a function
call in a generated client.

### `operation-summary-required` · warn

Every operation needs a `summary`: the one-line description shown in API
explorers and generated documentation.

### `operation-description-required` · info

Every operation needs a `description` carrying the context that does not fit
in a summary: side effects, preconditions, rate limits, field semantics.

### `operation-tag-required` · warn

Every operation needs at least one tag. Untagged operations end up in an
"untitled" bucket in the documentation.

### `operation-deprecated-noted` · info

A deprecated operation should say what replaces it, through `x-replacement`,
`x-deprecated-reason`, `x-sunset-date` or a description that mentions the
deprecation.

### `operation-method-semantics` · warn

- `GET` and `HEAD` must not define a request body — they have to be safe. An
  empty, optional body is ignored: it carries no information and is a common
  artefact of form encoded requests.
- `DELETE` must not require a request body.
- `PUT` must require a body, because it replaces the resource.

---

## paths

### `path-kebab-case` · warn

Path segments are lowercase and hyphen separated. Underscores and camelCase in
URLs are handled inconsistently by proxies, CDNs and older clients.

```yaml
paths:
  /user-profiles:      # good
  /user_profiles:      # reported
```

### `path-no-trailing-slash` · error

A trailing slash creates a second, distinct URL for the same resource. Which
one a client hits depends on the framework.

### `path-no-verbs` · warn

The HTTP method already expresses the action. A path like `/createUser` says
it twice and makes the URL space grow combinatorially.

### `path-collection-plural` · info

Collection paths should be plural: `/users` lists, `/users/{id}` addresses one
item. A small allow list (`health`, `status`, `me`, `settings`, …) is
recognised as intentionally singular, and filtered views such as
`/users/active` or `/orders/recent` are exempt because they name a view of a
collection, not a collection of their own.

### `path-parameter-defined` · error

Every `{placeholder}` in a path must be declared as a path parameter, and every
declared path parameter must appear in the template. Parameters declared on
the operation level count as well.

---

## parameters

### `parameter-required-path` · error

A path parameter is part of the URL and can never be optional.

### `parameter-name-required` · error

Every parameter must declare a `name`. The OpenAPI specification requires it,
and a nameless parameter would otherwise be dropped from the model and escape
every other parameter rule.

### `parameter-duplicate` · warn

The same name in the same location must not be declared twice.

### `parameter-description` · info

Parameters should be documented: the accepted format, the default and the
allowed range are the most common source of integration bugs.

### `security-in-query` · warn

An API key in the query string leaks into access logs, browser history and
referrer headers. Use a header instead.

```yaml
securitySchemes:
  apiKey:
    type: apiKey
    in: header          # not: in: query
    name: X-API-Key
```

---

## responses

### `response-success-required` · error

Every operation must document at least one `2xx` response. Without it,
generators omit the return type entirely.

### `response-description-required` · error

Every response needs a `description`. It is required by the OpenAPI
specification and is what tells a consumer when the status code comes back.

### `response-status-valid` · error

Only real HTTP status codes or the `default` key are allowed. A typo such as
`"20O"` silently creates an unreachable branch.

### `response-schema-required` · error

A response must describe its payload with a schema. An example alone cannot be
validated and cannot be turned into a typed client.

### `response-content-type` · warn

Content types must be specific. `*/*` and `text/plain` for a JSON API force
consumers to guess how to parse the payload.

### `response-error-envelope` · warn

All error responses should reference one shared error schema, so clients can
implement error handling once. Inline error schemas and competing error
components are both reported.

```yaml
responses:
  '404':
    description: Not found.
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/Error'
```

### `response-no-default-only` · info

An operation should document its concrete success status code instead of
relying only on `default`.

### `response-example-recommended` · info

Responses should carry an `example`. It makes the contract unambiguous and
lets the mock server answer with something realistic.

---

## schemas

### `component-naming-pascal` · warn

Schemas, responses, parameters and request bodies become types in generated
code, so they use PascalCase. Security schemes are referenced by name inside
security requirements and follow camelCase.

### `component-unused` · info

A component that is never referenced is dead weight: maintained, reviewed and
mocked, but never returned.

### `schema-property-naming-consistency` · warn

The API should use one naming style for properties. The rule reports the
minority style, but only when a clear majority (≥ 80 %) exists — an API that
has no convention yet is left alone.

### `schema-no-nullable` · warn

In OpenAPI 3.0 `nullable: true` is the only way to express a null value, so it is
correct there and is **not** reported. In OpenAPI 3.1 the keyword does not
exist: the value can never be null, whatever the document intended.

```yaml
# OpenAPI 3.1
status:
  type: [string, 'null']
```

### `schema-array-items-required` · error

An array without `items` carries no type information, so clients receive
untyped arrays and validators cannot check the contents.

### `schema-required-property-defined` · error

A property listed in `required` but missing from `properties` is
contradictory: the value can never be validated.

### `schema-example-recommended` · info

Top level component schemas should carry an `example`.

---

## security

### `security-requirement-defined` · warn

An operation should state its security requirement explicitly. Endpoints that
are intentionally public can be marked with `x-public: true`, or use a path
that indicates it (`/health`, `/login`, …).

### `security-scheme-undefined` · error

A security requirement that names a scheme which is not declared in
`components.securitySchemes` cannot be satisfied.

### `security-scopes-declared` · warn

An OAuth scope that the authorization server does not declare leads to a 403
at runtime.

---

## pagination

### `pagination-consistency` · warn

All collection endpoints should page the same way. Mixing `limit/offset` with
`cursor` forces clients to implement two pagination strategies.

### `pagination-envelope` · warn

A collection response should expose the items and the total count in a
predictable shape, so consumers can write one unwrapping helper instead of one
per endpoint.

Collections that page with a **cursor** are exempt: such APIs rarely know the
total number of items, because counting them can be expensive or impossible.
A `cursor`, `starting_after` or `page_token` parameter, or a `has_more` /
`next_cursor` property in the response, marks the collection as cursor based.

```yaml
UserPage:
  type: object
  required: [items, total]
  properties:
    items:
      type: array
      items:
        $ref: '#/components/schemas/User'
    total:
      type: integer
```
