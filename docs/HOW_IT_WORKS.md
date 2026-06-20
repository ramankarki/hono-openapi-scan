# How hono-openapi-scan Works — A Beginner's Guide

If you've never worked with ASTs (Abstract Syntax Trees), static analysis, or OpenAPI specs before — this is for you. We'll walk through what the scanner does step by step, in plain English.

---

## The Problem hono-openapi-scan Solves

You built a Hono API. It has routes, validation schemas, auth middleware. You want an OpenAPI spec so tools like Scalar or Swagger UI can show interactive API docs.

Your choices:

1. **Write the spec by hand** — tedious, gets out of sync with code
2. **Use `@hono/zod-openapi`** — requires rewriting all your routes with wrapper functions
3. **Use hono-openapi-scan** — points at your existing code, reads it, generates the spec

The scanner **reads your code without running it**. It understands your routes, your Zod schemas, your JSDoc comments, and produces a valid `openapi.json`.

---

## The Big Picture — Call Tree

When you run `hono-openapi-scan src/index.ts`, here's the full pipeline showing which file and function handles each task:

```
📦 cli.ts
 └─ main()
     ├─ loadConfig()                        ── config.ts
     └─ scan(config)                        ── scanner.ts
          │
          ├─ createProject(entry)           ── project.ts
          │   ├─ new Project(tsconfig)        ts-morph
          │   └─ resolveImportTree()          BFS from entry, follow imports
          │
          ├─ buildAppRegistry(files)        ── routes.ts
          │   ├─ forEachDescendant:            find new Hono()
          │   └─ detectAuthScope():            find app.use('*', authMiddleware)
          │
          ├─ collectKnownSchemaNames()      ── scanner.ts
          │   └─ scan all files for:           exported z.object/enum/array + pgTable
          │
          ├─ walkAppRoutes(entryApp)        ── routes.ts
          │   └─ forEachDescendant:
          │       ├─ .get/.post/.put/.patch/.delete/.on()
          │       │   └─ extractRoute()
          │       │       ├─ extractMiddleware()    → zValidator detection
          │       │       ├─ extractHandlerInfo()   → return type
          │       │       ├─ extractResponsesFromFunction()
          │       │       │   ├─ forEachDescendant (AST walk handler body)
          │       │       │   └─ extractResponseCall()
          │       │       │       ├─ resolveExpressionType()  ── type-walker.ts
          │       │       │       │   └─ typeToSchemaRef()      getType() → JSON Schema
          │       │       │       ├─ c.json()  → schema from data arg
          │       │       │       ├─ c.body()  → application/octet-stream
          │       │       │       ├─ c.text()  → text/plain
          │       │       │       ├─ c.html()  → text/html
          │       │       │       └─ c.redirect() → 302
          │       │       ├─ parseJSDocFromNode()  ── jsdoc.ts
          │       │       ├─ generateSummary()
          │       │       ├─ generateTags()
          │       │       └─ generateOperationId()
          │       └─ .route('/prefix', subApp)
          │           └─ resolveSubApp()         follow imports → recurse
          │
          └─ assembleSpec(routes, config)   ── assemble.ts
               ├─ Phase 1: Collect Zod schemas (from middleware + @returns)
               ├─ Phase 2: Build schemas
               │   ├─ resolveZodSchema()     ── zod-schema.ts
               │   │   └─ convertZodAST()      walk z.object/enum/array/string/…
               │   ├─ findDrizzleTables()    ── drizzle.ts
               │   │   └─ extractColumnInfo()   text match on uuid()/text()/…
               │   ├─ schemaPropertiesMatch()   shape-match for demand-driven
               │   ├─ drizzleTableToSchema() ── drizzle.ts
               │   ├─ inferExample()            auto-generate examples
               │   └─ normalizeResponseRefs()   inline schema → $ref
               ├─ Phase 3: Build routes
               │   ├─ buildParameters()         path/query/header/cookie
               │   ├─ buildRequestBody()        json/form with writeOnly
               │   └─ buildResponses()          handler + auto errors
               └─ writeFileSync(output)
```

Let's go through each phase in detail.

---

## Step 1: Resolve — Find All Files

The scanner starts at your entry file (`src/index.ts`) and follows every `import` statement to build a complete map of your project.

```ts
// src/index.ts
import users from './routes/users'    // → src/routes/users.ts
import { auth } from './lib/auth'     // → src/lib/auth.ts
```

```
src/index.ts
  ├── src/routes/users.ts
  │     └── src/schemas/index.ts
  ├── src/lib/auth.ts
  │     └── src/lib/db.ts
  │           └── src/db/schema.ts
  └── ...
```

**Why this matters:** The scanner only parses files your project actually uses. No dead code, no test files (unless imported). This is fast and precise — a medium project resolves in under a second.

---

## Step 2: Parse — Turn Code Into a Tree

Each file is parsed into an **Abstract Syntax Tree** (AST). Think of an AST as a family tree of your code, where every function call, every variable, every comment has a node.

```ts
// Source code
const app = new Hono()
app.get('/users', handler)
```

```
SourceFile
  └── VariableStatement
        └── VariableDeclaration (name: "app")
              └── NewExpression (Hono)
  └── ExpressionStatement
        └── CallExpression (.get)
              ├── PropertyAccess (.get on app)
              │     └── Identifier (app)
              ├── StringLiteral ("/users")
              └── Identifier (handler)
```

The scanner uses **ts-morph** (a TypeScript compiler wrapper) to build and walk these trees. It can also resolve types — so it knows that `app` is a `Hono` instance, and `handler` is a function that returns a `Response`.

---

## Step 3: Find — Locate the Interesting Bits

Once all files are parsed, the scanner hunts for specific patterns.

### Finding Hono apps

```ts
// Look for: new Hono()
// Found: app (src/index.ts), app (src/routes/users.ts), ...
```

Every `new Hono()` expression is recorded. If multiple apps exist (common with sub-routers), they're all tracked.

### Finding routes

```ts
// Look for: .get(), .post(), .put(), .patch(), .delete() calls on Hono instances
// Found:
//   GET    /users          (users.ts)
//   POST   /users          (users.ts)
//   GET    /users/:id      (users.ts)
//   ...
```

For each route, the scanner extracts:
- **Method** — GET, POST, PUT, PATCH, DELETE
- **Path** — `/users`, `/users/:id` (converts `:id` to `{id}` for OpenAPI)
- **Middleware chain** — all functions between path and handler
- **Handler** — the final function that returns a response

### Finding sub-routers

```ts
// src/index.ts
app.route('/users', users)    // users is imported from ./routes/users

// Scanner follows the import → walks users.ts → prefixes all paths with /users
// Result: /users, /users/:id, etc.
```

### Finding auth middleware

```ts
// Look for: app.use('*', middleware)
// Check if middleware calls auth.api.getSession or sets user/session on context
// If yes → all routes under this scope are marked as authenticated
```

---

## Step 4: Extract — Pull Out Details

### Request schemas (from zValidator)

```ts
// Source
app.post('/users',
  zValidator('json', CreateUserInput),   // ← body schema
  zValidator('query', UserQuerySchema),  // ← query parameters
  async (c) => { ... }
)
```

The scanner finds `zValidator()` calls and extracts:
- **Target** — `'json'`, `'query'`, `'param'`, `'form'`, `'header'`, `'cookie'`
- **Schema** — either inline `z.object({...})` or a reference to an exported schema

For query parameters, the scanner expands the schema into **individual parameters**:

```yaml
# Instead of a single $ref for the whole query object:
parameters:
  - name: role
    in: query
    schema: { type: string, enum: [admin, user] }
  - name: limit
    in: query
    schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
```

### Response schemas (from c.json)

```ts
// Source
return c.json({ data: users, cursor: nextCursor }, 200)
return c.json(user, 201)
if (!user) return c.json({ code: 'NOT_FOUND', message: '...' }, 404)
```

The scanner finds every `c.json()` call in the handler body and records:
- **Status code** — 200, 201, 404, etc.
- **Data shape** — the type of the first argument
- **Multiple paths** — if/else branches produce different status codes

### JSDoc metadata

```ts
/**
 * List all users with pagination.
 * @description Returns a cursor-paginated list with filtering.
 * @tags Users
 * @public
 * @error 404
 */
app.get('/users', handler)
```

The scanner extracts:
- `@tags` → groups endpoints in the docs
- `@summary` / `@description` → operation title and description
- `@public` → skips authentication for this route
- `@deprecated` → marks as sunset
- `@hide` → excludes from the spec entirely
- `@returns {Schema}` → response type reference
- `@error {status}` → document custom error status code

**Without JSDoc**, the scanner auto-generates these from the method + path:
- Summary: `GET /users` → "List users"
- Tags: `/users/{id}` → "Users"
- OperationId: `POST /users` → "createUsers"

---

## Step 5: Convert — Zod & Drizzle → JSON Schema

### Zod schemas

The scanner walks the AST of Zod schema definitions and produces JSON Schema:

```ts
// Zod
z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.enum(['admin', 'user']).default('user'),
})

// ↓ Converts to ↓

// JSON Schema
{
  "type": "object",
  "properties": {
    "name": { "type": "string", "minLength": 1, "maxLength": 100 },
    "email": { "type": "string", "format": "email" },
    "role": { "type": "string", "enum": ["admin", "user"], "default": "user" }
  },
  "required": ["name", "email"]
}
```

**How it works:** The AST for `z.string().min(1).max(100)` is a chain of method calls. The scanner walks this chain:
1. `z.string()` → base type: `{ type: "string" }`
2. `.min(1)` → adds `minLength: 1`
3. `.max(100)` → adds `maxLength: 100`

Each Zod method has a mapping to JSON Schema (see the [Schema Resolution table in README](README.md#zod--json-schema)).

**Cross-references:** When Schema A references Schema B (like `AuthResponse` referencing `UserSchema`), the scanner uses `$ref`:

```yaml
AuthResponse:
  properties:
    user:
      $ref: '#/components/schemas/UserSchema'   # ← instead of inlining all 8 fields
```

### Drizzle tables

The scanner detects `pgTable()` / `mysqlTable()` / `sqliteTable()` calls and extracts column definitions:

```ts
// Drizzle
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ↓ Converts to ↓

// JSON Schema
{
  "type": "object",
  "properties": {
    "id": { "type": "string", "format": "uuid", "readOnly": true },
    "name": { "type": "string" },
    "createdAt": { "type": "string", "format": "date-time", "readOnly": true }
  },
  "required": ["name"]
}
```

**Smart defaults:**
- `uuid()` → `format: "uuid"`
- `timestamp()` → `format: "date-time"`
- `.defaultRandom()` / `.defaultNow()` → `readOnly: true`
- `.notNull()` → added to `required` array

---

## Step 6: Assemble — Build the OpenAPI Object

Now the scanner has all the pieces. It assembles them into an OpenAPI 3.1 structure:

```yaml
openapi: 3.1.0
info:
  title: My API
  version: 1.0.0

servers:                    # From config
  - url: http://localhost:3000

security:                   # From config + auth middleware detection
  - bearerAuth: []

tags:                       # From config + auto-detected
  - name: Users
    description: User management

components:
  securitySchemes:          # From config
    bearerAuth:
      type: http
      scheme: bearer

  schemas:                  # From Zod + Drizzle (demand-driven)
    UserSchema: { ... }
    CreateUserInput: { ... }
    Error:                  # Always included
      type: object
      properties:
        success: { type: boolean, const: false }
        error:
          type: object
          properties:
            type: { type: string }
            code: { type: string }
            message: { type: string }

paths:                      # From route detection
  /users:
    get:
      tags: [Users]
      summary: List users
      operationId: getUsers
      security: [{ bearerAuth: [] }]
      parameters: [ ... ]
      responses:
        '200': { ... }
        '401': { $ref: '#/components/schemas/Error' }
        '500': { $ref: '#/components/schemas/Error' }
```

### Error responses

Every route automatically gets relevant error responses:

| Status | When Added | Why |
|--------|-----------|-----|
| `400` | Route has request body or param validation | Validation errors from Zod |
| `401` | Route is authenticated | Missing/invalid auth token |
| `404` | Route has path parameters | Resource not found |
| `429` | Always | Rate limiting is assumed |
| `500` | Always | Unexpected server errors |

Routes can customize or disable these with `@error` JSDoc:

```ts
/** @error 403 */
/** @error none */  // disables auto-errors
```

---

## Step 7: Write — Output openapi.json

The assembled spec is serialized to JSON and written to disk:

```bash
$ hono-openapi-scan src/index.ts
Scanning entry: src/index.ts
Resolved 182 source files
Found 5 Hono app(s)
  app: 17 route(s)
Total unique routes: 15
Wrote OpenAPI spec to: openapi.json
```

The output file can be served by any OpenAPI-compatible tool:

```bash
# Serve with Scalar (recommended)
bunx @scalar/hono-api-reference openapi.json

# Or serve as a static file
bunx serve openapi.json
```

---

## Glossary

| Term | Plain English |
|------|--------------|
| **AST** | A tree representation of your code — every function, variable, and comment is a node |
| **Static analysis** | Reading code without running it — like a spell-checker for your program |
| **ts-morph** | A TypeScript library that parses code into ASTs and resolves types |
| **$ref** | A pointer to another schema — avoids duplicating the same definition |
| **Demand-driven** | Only include schemas that routes actually reference — no unused schemas |
| **OpenAPI 3.1** | The latest version of the API documentation standard |
| **JSDoc** | Comments above functions that start with `/**` — used for metadata |
| **Bearer token** | A string sent in the `Authorization` header to prove identity |

---

## What the Scanner Does NOT Do

- **Run your code** — it's pure static analysis, no runtime needed
- **Modify your files** — it only reads, never writes to your source
- **Require special structure** — you write normal Hono code, the scanner adapts
- **Replace RPC types** — use `hc<AppType>` for RPC; use the scanner for OpenAPI
- **Handle WebSocket routes** — `upgradeWebSocket()` routes are skipped
- **Detect dynamic routes** — if you generate routes in a loop at runtime, the scanner can't see them
