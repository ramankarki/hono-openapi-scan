# `hono-openapi-scan` — Specification v1

> CLI tool. Scans Hono codebase. Outputs OpenAPI 3.1 spec. Zero wrappers.

---

## 1. Core Principle

**Zero-config by default.** Users write standard Hono + Zod + Drizzle + Better Auth code. No wrapper functions, no special file structure, no imports from this package. The only required config is the entry file path. Everything else is inferred from the code itself.

**Scan only. Never modify.** The tool reads source files, extracts routes + schemas + JSDoc, and writes `openapi.json`. No runtime middleware.

```
User code (standard Hono + Zod + Drizzle)  →  CLI scan  →  openapi.json
```

---

## 2. Input: What We Scan

The scanner takes a single **entry file** (e.g., `src/index.ts`) and resolves the full import tree via ts-morph. Only files reachable from the entry are parsed — no glob, no dead code, no test files unless imported.

### 2.1 Routes
```ts
app.get('/users/:id', middleware, handler)
app.post('/users', middleware, handler)
app.put('/users/:id', middleware, handler)
app.patch('/users/:id', middleware, handler)
app.delete('/users/:id', middleware, handler)
// Also: app.on('POST', ...), app.on(['POST','PUT'], ...)  if used
```
Extract: method, path, middleware chain, handler function.

### 2.2 Request schemas (zValidator)
```ts
zValidator('param', schema)    → path parameters
zValidator('query', schema)    → query parameters
zValidator('json', schema)     → request body (application/json)
zValidator('form', schema)     → request body (multipart/form-data)
zValidator('header', schema)   → header parameters
zValidator('cookie', schema)   → cookie parameters
```

### 2.3 Response detection
```ts
c.json(data, 200)              → status code + body
c.json(data, 201)
c.json(error, 400)
c.json(error, 404)
c.json(error, 500)
// Also: c.text(), c.html(), c.body() — mark as string/binary, no schema
// Also: c.redirect(url, 302) — no body schema
```

Multiple `return c.json(...)` in handler → multiple response statuses detected.

### 2.4 Type resolution for response bodies

- **Primary:** AST walks handler body to find `c.json(data, status)` calls, then `getType()` on the data argument → full JSON Schema with properties, types, and nullability.
- **JSDoc `@returns {SchemaName}`:** produces `$ref` when no c.json() schema is resolved.
- **Fallback:** status code only (e.g., when data comes from `c.get()` with unresolved context types).
- Handler return type annotations are NOT used — Hono returns `Promise<JSONRespondReturn<{body,headers,status}>>`, not the data type.

### 2.5 Zod schemas (component registry)
**Demand-driven.** Only Zod schemas actually referenced by endpoints (via zValidator, return type, or JSDoc `@returns`) are registered in `components.schemas`. Unreferenced exports in reachable files are ignored. Schema is registered under its export name.

### 2.6 JSDoc metadata (optional)

All JSDoc annotations are **optional enhancements**. Without them, the scanner auto-generates summary, operationId, and tags from method + path. Add JSDoc only when you want richer descriptions or overrides.

```
@tags {Tag1, Tag2}
@summary {text}
@description {text}         (or first paragraph of JSDoc body)
@public                     (override global auth)
@security {scheme1, scheme2} (explicit per-route auth)
@deprecated                 (mark as deprecated)
@operationId {customId}     (override auto-generated)
@hide                       (exclude from spec)
@returns {TypeName}         (response type hint)
@error {status} {SchemaName} (custom error response)
```

### 2.7 Auth detection
- Global config: `security: [{ bearerAuth: [] }]` → applied to all routes
- `@public` JSDoc → `security: []` for that route
- `@security {scheme1, scheme2}` → explicit per-route
- Better Auth middleware detection: if `app.use('*', authMiddleware)` found, mark routes as authenticated. If `app.use('/api/*', authMiddleware)`, only `/api/*` routes authenticated.

### 2.8 Sub-routers
```ts
app.route('/users', usersRouter)
app.route('/posts', postsRouter)
```
Trace sub-app definition, prefix all its routes with `/users` or `/posts`.

### 2.9 Drizzle schemas
```ts
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  ...
})
```
**Demand-driven + text-based column detection.** Only tables referenced by endpoint response types are registered. Column types are detected by matching the callee text of Drizzle column builders (`uuid()`, `text()`, `integer()`, etc.) with nullability, defaults, and primary keys inferred from chained methods. Registered as `components.schemas.{TableName}`. Unreferenced tables ignored.

---

## 3. Output: OpenAPI 3.1 Spec

### 3.1 Best Practices Compliance Checklist

| Rule | Priority | How |
|---|---|---|
| Every endpoint has `summary` | P0 | Auto from method+path or JSDoc |
| Every endpoint has `operationId` | P0 | Auto from method+path (camelCase) or JSDoc |
| Every param/field has `description` | P0 | From `z.describe()` or JSDoc `@param` |
| Every param/field has `example` | P0 | From `z.openapi({example})` or infer from defaults |
| All error responses documented | P0 | Auto-add 400, 401, 404, 429, 500 |
| `readOnly` on generated fields | P0 | Detect `.default()`, `.readonly()` (Zod) + `.defaultRandom()`, `.primaryKey()`, `serial()` (Drizzle) |
| `writeOnly` on input fields | P0 | In request body schemas (inputs only, not responses) |
| `deprecated` for sunset endpoints | P0 | From JSDoc `@deprecated` |
| `nullable` vs `required` correct | P1 | From `.nullable()`, `.optional()`, `.nullish()` |
| Version in `info` | P1 | Config or `package.json#version` |
| `servers` array | P1 | Config |
| Security schemes + global security | P1 | Config |
| Tags with descriptions | P1 | Config + auto-derived + JSDoc |
| Spec at standard paths | P1 | `/openapi.json`, `/openapi.yaml` |
| Spec committed to source control | P1 | CLI writes file, user commits |
| Custom error codes (SCREAMING_SNAKE) | P1 | Default error schema uses `code` field |
| Plural collection names | P2 | Read from paths, suggest in warnings |
| `externalDocs` link | P2 | Config optional |
| Naming conventions consistent | P2 | operationId: camelCase, schemas: PascalCase, paths: kebab-case |

### 3.2 Generated Spec Structure

```yaml
openapi: 3.1.0
info:
  title: My API
  version: 1.0.0
  description: ...
servers:
  - url: http://localhost:3000
    description: Local
tags:
  - name: Users
    description: User management
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
  schemas:
    User:
      type: object
      properties:
        id: { type: string, format: uuid, readOnly: true }
        name: { type: string }
        email: { type: string, format: email }
        role: { type: string, enum: [admin, user] }
      required: [id, name, email]
    CreateUserInput:
      type: object
      properties:
        name: { type: string, minLength: 1 }
        email: { type: string, format: email, writeOnly: true }  # writeOnly on input schemas
        role: { type: string, enum: [admin, user], default: user }
      required: [name, email]
    Error:
      type: object
      properties:
        code: { type: string, description: Machine-readable error code. SCREAMING_SNAKE_CASE. }
        message: { type: string, description: Human-readable error message }
        details:
          type: array
          items:
            type: object
            properties:
              field: { type: string }
              message: { type: string }
      required: [code, message]
security:
  - bearerAuth: []
paths:
  /users:
    get:
      tags: [Users]
      summary: List all users
      description: Returns paginated list of users with optional role filtering.
      operationId: getUsers
      parameters:
        - name: role
          in: query
          required: false
          schema: { type: string, enum: [admin, user] }
          description: Filter by user role
        - name: limit
          in: query
          required: false
          schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
          description: Maximum number of results
        - name: cursor
          in: query
          required: false
          schema: { type: string }
          description: Pagination cursor
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items:
                      $ref: '#/components/schemas/User'
                  cursor:
                    type: string
                    nullable: true
        '400':
          description: Validation Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '401':
          description: Unauthorized
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '404':
          description: Not Found
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '429':
          description: Too Many Requests
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '500':
          description: Internal Server Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
    post:
      tags: [Users]
      summary: Create a user
      operationId: createUser
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateUserInput'
      responses:
        '201':
          description: Created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/User'
        '400':
          $ref: '#/components/schemas/Error'  # shared response ref
        '401':
          description: Unauthorized
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '500':
          description: Internal Server Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
  /users/{id}:
    get:
      tags: [Users]
      summary: Get user by ID
      operationId: getUserById
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string, format: uuid }
          description: User unique identifier
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/User'
        '400':
          description: Validation Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '401':
          description: Unauthorized
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '404':
          description: Not Found
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '500':
          description: Internal Server Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
```

---

## 4. Configuration

One file at project root. Everything has defaults.

```ts
// openapi.config.ts
import { defineConfig } from 'hono-openapi-scan'

export default defineConfig({
  // ── Required ──
  info: {
    title: 'My API',              // REQUIRED
    // version auto-reads from package.json
    // description auto-reads from README.md
  },

  // ── Optional (sensible defaults) ──
  servers: [
    { url: 'http://localhost:3000', description: 'Local' },
  ],

  // Security: global bearer auth (Better Auth compatible)
  security: [{ bearerAuth: [] }],  // remove or set [] to disable global auth
  securitySchemes: {
    bearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'Better Auth session token',
    },
  },

  // Tag descriptions (for rendered docs)
  tags: [
    { name: 'Users', description: 'User management' },
    { name: 'Posts', description: 'Blog posts' },
  ],

  // Error schema (customize or use default)
  errorSchema: undefined,  // path to custom Zod schema, or inline

  // App export (when multiple Hono apps in import tree)
  appExport: undefined,         // export name to target, e.g. 'app' or 'default'

  // Error responses
  defaultErrorResponses: true,  // false disables all auto error responses
                                // or pass array of statuses: [400, 401, 500]

  // Global overrides
  excludeAuth: ['/health', '/webhooks/*'],  // paths that skip global auth

  // Scanning
  entry: 'src/index.ts',        // entry file — scanner follows imports from here

  // Output
  output: 'openapi.json',       // file path relative to project root

  // Operation ID strategy
  // 'default': auto from method+path
  // (route) => string: custom function
  operationId: 'default',

  // OpenAPI version
  openapi: '3.1.0',             // or '3.0.3' for compatibility
})
```

---

## 5. CLI

```bash
# Generate spec
npx hono-openapi-scan

# Custom config
npx hono-openapi-scan --config openapi.prod.ts

# Validate after generation
npx hono-openapi-scan --validate

# Init config file
npx hono-openapi-scan init
```

Output: `openapi.json` written to project root. Exit code 0 on success, 1 on errors.

---

## 6. Architecture

### Pipeline

```
Entry file (src/index.ts)
  │
  ▼
ts-morph: resolve import tree → only reachable files parsed
  │
  ├─▶ Pass 1: Walk routes (from reachable files)
  │     - Find all Hono app instances
  │     - For each .get/.post/.put/.delete/.patch call:
  │         - Extract method + path
  │         - Walk middleware chain → find zValidator calls → extract schemas
  │         - Find handler function → extract JSDoc
  │         - Analyze handler body → find c.json() calls → extract status + type
  │         - Resolve types via ts-morph
  │     - For each .route(prefix, subApp) call:
  │         - Trace subApp → recurse with path prefix
  │     - For each .use(path, middleware) call:
  │         - Detect auth middleware → mark route scope
  │
  ├─▶ Pass 2: Collect schemas (demand-driven)
  │     - From endpoint analysis: collect all referenced Zod schemas
  │     - From endpoint analysis: collect all referenced Drizzle tables
  │     - Register ONLY referenced schemas/tables in components
  │     - Resolve $ref chains (schema → schema references → register those too)
  │
  ├─▶ Pass 3: Assemble spec
  │     - Apply global security → per-route (respect @public)
  │     - Auto-add error responses (400, 401, 404, 429, 500)
  │     - Generate operationIds
  │     - Resolve $ref links
  │
  ▼
Write openapi.json
```

### Key ts-morph capabilities

| Task | API |
|---|---|
| Find `new Hono()` | `Node.isNewExpression()` → check type |
| Find `.get(path, ...handlers)` | `Node.isCallExpression()` → resolve property access |
| Find `zValidator(target, schema)` | Walk call args, check first arg is string literal |
| Parse JSDoc | `node.getJsDocs()` → `.getTags()`, `.getComment()` |
| Find `c.json(data, status)` in body | Walk return statements, check callee |
| Resolve Zod schema fields | Walk `z.object({...})` property assignments |
| Convert Zod types → JSON Schema | Custom: walk `z.string()`, `z.number()`, etc. |
| Trace import references | `node.getSymbol()` → `.getDeclarations()` |
| Resolve type of variable | `node.getType()` → `.getProperties()` → walk type tree |
| Convert TypeScript type → JSON Schema | Walk type properties: string→string, number→number, Date→date-time, etc. |
| Resolve Drizzle table type | Text match on column builder callee (`uuid()`, `text()`, etc.) + chained method introspection |
| Follow `.route()` to sub-app | Resolve import, find sub-app node, recurse |

---

## 7. Zod → JSON Schema Mapping

| Zod method | JSON Schema |
|---|---|
| `z.string()` | `{ type: "string" }` |
| `z.string().uuid()` | `{ type: "string", format: "uuid" }` |
| `z.string().email()` | `{ type: "string", format: "email" }` |
| `z.string().url()` | `{ type: "string", format: "uri" }` |
| `z.string().datetime()` | `{ type: "string", format: "date-time" }` |
| `z.string().min(n)` | `{ type: "string", minLength: n }` |
| `z.string().max(n)` | `{ type: "string", maxLength: n }` |
| `z.string().regex(/.../)` | `{ type: "string", pattern: "..." }` |
| `z.number()` | `{ type: "number" }` |
| `z.number().int()` | `{ type: "integer" }` |
| `z.number().min(n)` | `{ type: "number", minimum: n }` |
| `z.number().max(n)` | `{ type: "number", maximum: n }` |
| `z.boolean()` | `{ type: "boolean" }` |
| `z.date()` | `{ type: "string", format: "date-time" }` |
| `z.coerce.number()` | `{ type: "number" }` (coercion runtime-only, schema identical to `z.number()`) |
| `z.coerce.string()` | `{ type: "string" }` |
| `z.coerce.boolean()` | `{ type: "boolean" }` |
| `z.coerce.date()` | `{ type: "string", format: "date-time" }` |
| `z.instanceof(File)` | `{ type: "string", format: "binary" }` (multipart/form-data only) |
| `z.instanceof(Blob)` | `{ type: "string", format: "binary" }` |
| `z.literal(v)` | `{ const: v }` or `{ type: "...", enum: [v] }` |
| `z.enum([a, b])` | `{ type: "string", enum: [a, b] }` |
| `z.nativeEnum(E)` | `{ type: "string", enum: [...] }` |
| `z.array(T)` | `{ type: "array", items: <T> }` |
| `z.object({...})` | `{ type: "object", properties: {...}, required: [...] }` |
| `z.record(K, V)` | `{ type: "object", additionalProperties: <V> }` |
| `z.union([A, B])` | `{ oneOf: [<A>, <B>] }` |
| `z.discriminatedUnion('type', [...])` | `{ oneOf: [...], discriminator: { propertyName: "type" } }` |
| `z.null()` | `{ type: "null" }` or in 3.1: `{ type: ["string", "null"] }` |
| `z.undefined()` | Not represented in JSON Schema (treated as optional) |
| `.optional()` | Removes from `required` array |
| `.nullable()` | Adds `"null"` to type array (3.1) or `nullable: true` (3.0) |
| `.nullish()` | `.optional()` + `.nullable()` |
| `.default(v)` | `{ default: v }` |
| `.describe(s)` | `{ description: s }` |
| `.readonly()` | `{ readOnly: true }` (on output schemas) |
| `.deprecated()` | `{ deprecated: true }` |

### readOnly / writeOnly inference

In response schemas (200, 201):
- Fields with `.default()` or `.readonly()` → `readOnly: true`
- Server-generated database columns: `uuid().defaultRandom()`, `timestamp().defaultNow()`, `serial()` → `readOnly: true`
- Drizzle: any column with `.defaultRandom()`, `.defaultNow()`, or `serial()` → `readOnly: true`

In request body schemas:
- All fields are `writeOnly` by context (input only)
- Fields marked `.readonly()` → excluded from request schema

---

## 8. Error Response Rules

Auto-added error responses per route:

| Status | When added | Description |
|---|---|---|
| `400` | Route has request body or param validation | `Validation Error` |
| `401` | Route is authenticated (global security or `@security`) | `Unauthorized` |
| `404` | Route has path parameters | `Not Found` |
| `429` | Always (global rate limiting is assumed) | `Too Many Requests` |
| `500` | Always | `Internal Server Error` |

Custom errors via JSDoc:
```ts
/** @error 403 {ForbiddenError} */
/** @error 409 {ConflictError} */
```

Disable auto errors per route:
```ts
/** @error none */
```

Global disable in config:
```ts
defaultErrorResponses: false  // or array of statuses to include
```

---

## 9. Operation ID Generation

Default pattern: `{method}{PathInPascalCase}`

| Method + Path | operationId |
|---|---|
| GET /users | `getUsers` |
| GET /users/{id} | `getUsersById` |
| POST /users | `createUsers` |
| PUT /users/{id} | `updateUsersById` |
| PATCH /users/{id} | `patchUsersById` |
| DELETE /users/{id} | `deleteUsersById` |
| GET /users/{id}/posts | `getUsersByIdPosts` |
| GET /health | `getHealth` |

Special method mapping:
- `POST` → `create` prefix
- Cross-reference: if `GET /users/{id}/posts` exists and `POST /users/{id}/posts` also exists → `createUserPost`

Override: `@operationId customName` JSDoc.

---

## 10. Schema Naming Convention

| Source | Component name |
|---|---|
| `export const UserSchema = z.object({...})` | `UserSchema` |
| `export const CreateUserInput = z.object({...})` | `CreateUserInput` |
| `z.object({...})` inline (not exported) | Inlined, no component |
| `pgTable('users', {...})` | `Users` (PascalCase table name) |

Naming rules:
- Schema names: PascalCase, nouns
- Request schemas: suffix `Input` or `Request`
- Response schemas: suffix `Response` or bare entity name
- Error schema: always `Error`

---

## 11. Type Resolution Strategy

### Response types: ts-morph `getType()` on c.json() data

The scanner walks the handler body AST to find every `c.json(data, status)` call. For each, it calls `getType()` on the data argument and converts the resolved TypeScript type to JSON Schema:

```ts
return c.json({ data: users, cursor: null }, 200)
// → getType() resolves to: { data: User[]; cursor: string | null }
// → JSON Schema: { type: "object", properties: { data: { type: "array", items: ... }, cursor: { type: "string", nullable: true } } }
```

TypeScript type → JSON Schema mapping:

| TypeScript type | JSON Schema |
|---|---|
| `string` | `{ type: "string" }` |
| `number` | `{ type: "number" }` |
| `boolean` | `{ type: "boolean" }` |
| `Date` | `{ type: "string", format: "date-time" }` |
| `string \| null` | `{ type: "string", nullable: true }` |
| `T[]` / `Array<T>` | `{ type: "array", items: <T> }` |
| `{ key: T }` | `{ type: "object", properties: { key: <T> } }` |
| Enum / literal union | `{ type: "string", enum: [...] }` |
| `undefined` (optional) | Property removed from `required` |

Handler return type annotations are NOT used — Hono handlers return `Promise<JSONRespondReturn<{body,headers,status}>>`, not the data type.

### Zod schemas: AST walking (not getType())

The scanner walks Zod AST directly to preserve metadata (`.describe()`, `.min()`, `.email()`, etc.) that would be lost via `getType()`. Zod schema detection uses AST text matching and chained method introspection.

### Request schemas: ALWAYS from zValidator

```ts
zValidator('param', z.object({ id: z.string().uuid() }))
zValidator('query', MyQuerySchema)   // reference → resolved via import
zValidator('json', CreateUserInput)  // reference → $ref in spec
```
If schema is a reference → check if it's an exported Zod schema → use `$ref`. Otherwise inline.

### Drizzle schemas: text-based column detection

Column types detected by matching the callee text of Drizzle column builders (`uuid()`, `text()`, `integer()`, etc.). Nullability, defaults, primary keys, and readOnly inferred from chained methods. Registration is demand-driven — only tables referenced by response types appear in `components.schemas`.

### Response schema fallback chain
For every `c.json(X, status)`:
1. AST-walk handler body → find `c.json()` calls → `getType()` on data arg → walk to JSON Schema
2. If no c.json() found: JSDoc `@returns` → produce `$ref`
3. If neither: status code only, no content schema

---

## 12. Scope & Boundaries

### In scope

- [ ] CLI: `hono-openapi-jsdoc` command
- [ ] Scan: resolve import tree from entry file, find all routes
- [ ] Routes: `app.get/post/put/patch/delete` + `app.on(method, ...)` + `app.on([methods], ...)`
- [ ] Request schemas: detect zValidator (param/query/json/form/header/cookie) → map to OpenAPI params/body
- [ ] Response: detect `c.json()` / `c.text()` / `c.html()` / `c.body()` / `c.redirect()` calls, extract status codes
- [ ] Response types (Tier 1): AST-walk handler body for `c.json()` calls → `getType()` on data arg → JSON Schema
- [ ] Response types (Tier 2): JSDoc `@returns` → `$ref` fallback
- [ ] Response types (Tier 3): status code only (fallback)
- [ ] JSDoc: `@tags`, `@summary`, `@description`, `@public`, `@security`, `@deprecated`, `@hide`, `@operationId`, `@returns`, `@error`, `@param`, `@header`
- [ ] Schema registry: demand-driven Zod schemas → `components.schemas` (only schemas referenced by endpoints)
- [ ] Drizzle: `pgTable`/`mysqlTable`/`sqliteTable`/`singlestoreTable` → JSON Schema (demand-driven, from endpoints)
- [ ] Security: global bearer auth + `@public` override + `@security` per-route
- [ ] Better Auth: detect auth middleware → auto-mark routes
- [ ] Error responses: auto-add 400/401/404/429/500 + custom via `@error`
- [ ] operationId: auto-generate from method+path
- [ ] Tags: auto from path segment
- [ ] Summary: auto from method+path when no JSDoc
- [ ] readOnly/writeOnly: from `.readonly()`, `.default()`, `.defaultRandom()`, `.defaultNow()`, context
- [ ] Config: `openapi.config.ts` with defaults
- [ ] Output: `openapi.json` (3.1.0) + optional `openapi.yaml`
- [ ] Sub-routers: `.route(prefix, subApp)`

### Out of scope (never)

- Runtime middleware (use `@scalar/hono-api-reference` to serve the generated file)
- Route wrapping (`createRoute`, `describeRoute`)
- RPC client generation
- Request validation (that's what zValidator does)
- WebSocket routes

---

## 13. Dependencies

| Package | Purpose |
|---|---|
| `ts-morph` | AST parsing, type resolution, JSDoc extraction |
| `zod` | Parse Zod schema definitions from source (peer dep of user's project) |
| `zod-to-json-schema` | Convert Zod schemas to JSON Schema (for registered schemas) |
| `openapi-types` | TypeScript types for OpenAPI 3.1 |


No runtime deps. CLI only.

---

## 14. Edge Cases & Error Handling

| Scenario | Behavior |
|---|---|
| No Hono app found | Error: "No Hono app instance found in scanned files" |
| Multiple Hono apps | Merge all (config: `appExport` to target one) |
| Handler has no return type | Fall through response strategies 2-5 |
| `c.json()` with variable status code | Can't determine status → omit status, warn |
| `c.json()` in try/catch | Detect all branches, collect all status codes |
| Dynamic routes (loop, condition) | Can't detect → skip, warn |
| Import fails to resolve | Skip that import, warn |
| Zod schema has circular ref | Detect cycle → use inline schema with `description: "circular reference"` |
| `z.lazy()` | Can't resolve → skip, warn |
| `z.custom()` / `z.preprocess()` / `z.transform()` | Can't convert to JSON Schema → `{ type: "object", description: "custom validation" }` |
| `satisfies` operator (`const x = {...} satisfies Type`) | ts-morph resolves to `any` — inline schema incomplete | Use type annotation `const x: Type = {...}` or `as Type` |
| `c.get('user')` / `c.get('session')` | Hono context generics not resolvable → empty object | Add `@returns {SchemaName}` JSDoc |
| Non-JSON response (`c.text()`, `c.html()`) | Mark as `text/plain` or `text/html`, no schema |
| `c.redirect()` | Mark as 302/301, no body |
| Better Auth route (`/api/auth/*`) | Auto-exclude from spec (or mark as `@hide`) |
| Route with no path params but 404 added | 404 only added if path has `:param` or `{param}` |
| Empty middleware chain | Only handler, no validation → no request schema |
| `app.on()` with array methods | Expand to individual operations per method |
