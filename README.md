# hono-openapi-scan

[![CI](https://github.com/ramankarki/hono-openapi-scan/actions/workflows/ci.yml/badge.svg)](https://github.com/ramankarki/hono-openapi-scan/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/hono-openapi-scan)](https://www.npmjs.com/package/hono-openapi-scan)
[![license](https://img.shields.io/npm/l/hono-openapi-scan)](https://github.com/ramankarki/hono-openapi-scan/blob/main/LICENSE)

**Scan your Hono codebase. Get an OpenAPI 3.1 spec.** No wrapper functions. No runtime middleware. No migration.

```bash
bun add -D hono-openapi-scan
bunx hono-openapi-scan init   # create config
bunx hono-openapi-scan        # generate openapi.json
```

## Contents

- [Walkthrough — Your First Spec](#walkthrough--your-first-spec)
- [How It Works](#how-it-works)
- [Why hono-openapi-scan?](#why-hono-openapi-scan)
- [What Gets Detected](#what-gets-detected)
- [Writing Good Code](#writing-good-code)
- [Config Reference](#config-reference)
- [Library API](#library-api)
- [Development](#development)

## Walkthrough — Your First Spec

### 1. Install

```bash
bun add -D hono-openapi-scan
```

### 2. Initialize config

```bash
bunx hono-openapi-scan init
```

This creates `hono-openapi-scan.config.ts` at your project root:

```ts
import { defineConfig } from 'hono-openapi-scan'

export default defineConfig({
  info: {
    title: 'My API',            // defaults to package.json#name
    // version: '1.0.0',        // defaults to package.json#version
    // description: '...',      // defaults to first line of README.md
  },

  // servers: [{ url: 'http://localhost:3000', description: 'Local' }],
  // security: [{ bearerAuth: [] }],
  // securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
  // tags: [{ name: 'Users', description: 'User management' }],

  entry: 'src/index.ts',        // where your Hono app lives
  output: 'openapi.json',       // where the spec is written
})
```

> See [test/fixture/hono-openapi-scan.config.ts](test/fixture/hono-openapi-scan.config.ts) for a full production example with all supported fields.

### 3. Scan

```bash
bunx hono-openapi-scan
```

```
Scanning entry: src/index.ts
Resolved 182 source files
Found 3 Hono app(s)
  app: 17 route(s)
Total unique routes: 15
Wrote OpenAPI spec to: openapi.json
```

### 4. Serve

Serve the spec with any OpenAPI-compatible tool:

```bash
# Scalar (recommended)
bunx @scalar/cli openapi.json

# Swagger UI
bunx swagger-ui-watcher openapi.json

# Or just commit it — CI can validate it
```

### 5. (Optional) Add to CI

```json
// package.json
{
  "scripts": {
    "openapi": "hono-openapi-scan",
    "openapi:check": "hono-openapi-scan && git diff --exit-code openapi.json"
  }
}
```

## How It Works

The scanner reads your source code with **ts-morph** (a TypeScript compiler wrapper). It never runs your code — pure static analysis.

```
Your Hono project
  │
  ├─ src/index.ts          ← Entry: new Hono(), .use(), .route()
  ├─ src/routes/users.ts   ← .get() / .post() + zValidator
  ├─ src/schemas/index.ts  ← Zod schemas with .describe()
  └─ src/db/schema.ts      ← Drizzle tables with // comments
  │
  ▼  ts-morph reads the AST
  │
  ├─ Finds every .get/.post/.put/.patch/.delete
  ├─ Resolves .route() sub-routers across files
  ├─ Extracts zValidator → request body + query params
  ├─ Detects c.json() → response status codes
  ├─ Walks Zod AST → full JSON Schema with $ref
  ├─ Reads Drizzle columns → JSON Schema with readOnly
  ├─ Detects Better Auth middleware → security + 401
  └─ Parses JSDoc → tags, summaries, @public, @returns
  │
  ▼
openapi.json  ← valid OpenAPI 3.1
```

For a deep dive, read [How It Works](docs/HOW_IT_WORKS.md).

## Why hono-openapi-scan?

|                      | hono-openapi-scan | @hono/zod-openapi | hono-openapi |
| -------------------- | ----------------- | ----------------- | ------------ |
| **Approach**         | Static analysis — reads your source | Runtime — wraps routes | Runtime — wraps routes |
| **Zero wrappers**    | ✅ No `createRoute`, no `describeRoute` | ❌ Must wrap every route | ❌ Must wrap every route |
| **Existing code**    | ✅ Works on any Hono project as-is | ❌ Requires migration | ❌ Requires migration |
| **Zod → JSON Schema**| ✅ Walks Zod AST automatically | ✅ From `createRoute` config | ✅ From wrapper config |
| **Drizzle tables**   | ✅ Detects `pgTable` → JSON Schema | ❌ | ❌ |
| **Better Auth**      | ✅ Detects auth middleware → security | ❌ | ❌ |
| **JSDoc metadata**   | ✅ `@tags`, `@public`, `@returns`, etc. | ❌ Must use `route.description` | ❌ |
| **\$ref cross-refs**  | ✅ Automatic between schemas | ✅ Manual via `createRoute` | ✅ Manual |
| **No runtime cost**  | ✅ Build/CI only — no middleware added | ❌ Adds middleware to every request | ❌ Adds middleware |
| **Works with RPC**   | ✅ Side-by-side, no conflicts | ❌ `hc<AppType>` breaks with wrappers | ❌ Similar conflicts |
| **Error docs**       | ✅ Auto 400/401/404/429/500 per route | ❌ Manual | ❌ Manual |
| **Beginner friendly**| ✅ One command, no code changes | ❌ Must learn `createRoute` API | ❌ Must learn wrapper API |

**When to use each:**

- **hono-openapi-scan** — You have an existing Hono app. You want OpenAPI docs without touching your routes. You use Zod, Drizzle, Better Auth. One command.
- **@hono/zod-openapi** — You're starting fresh. You want OpenAPI integrated from day one. You're OK wrapping every route with `createRoute()`. You need runtime validation tied to the spec.
- **hono-openapi** — Similar to `@hono/zod-openapi` with a different API surface. Community maintained.

## What Gets Detected

| Pattern | Detected As | Example |
|---------|------------|---------|
| `app.get('/users', handler)` | GET /users operation | Route with method + path |
| `app.route('/prefix', subApp)` | Prefixed sub-router | Cross-file resolution |
| `zValidator('json', schema)` | `requestBody` with `\$ref` | JSON request body |
| `zValidator('query', schema)` | Query parameters (expanded) | Per-field query params |
| `zValidator('param', schema)` | Path parameters with schemas | `{id}` with `uuid` format |
| `zValidator('form', schema)` | `multipart/form-data` | File uploads |
| `c.json(data, 200)` | Response status codes | 200, 201, etc. |
| `export const X = z.object({...})` | `components.schemas.X` | Zod → JSON Schema |
| `pgTable('users', {...})` | `components.schemas.Users` | Drizzle → JSON Schema |
| `app.use('*', authMiddleware)` | Global auth scope | `security: bearerAuth` |
| JSDoc `@public` | No security on route | Override global auth |
| JSDoc `@tags Users` | Tag grouping in docs | OpenAPI tags |
| JSDoc `@returns {Schema}` | Response `\$ref` | Typed responses |
| JSDoc `@error 404` | Custom error response | Per-route error docs |

## Writing Good Code

The scanner extracts everything it can automatically. But the quality of your spec depends on the quality of your code. Here's how to get the best output.

### Zod Schemas

Every field should have `.describe()`. The scanner uses it for `description` in the JSON Schema.

```ts
// ✅ Good — scanner picks up descriptions
export const CreateUserInput = z.object({
  name: z.string().min(1).max(100).describe('Display name'),
  email: z.string().email().describe('Email address'),
  role: z.enum(['admin', 'user']).default('user').describe('User role'),
})

// ❌ Bad — missing descriptions
export const CreateUserInput = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.enum(['admin', 'user']).default('user'),
})
```

**Result:**

```json
{
  "name": { "type": "string", "minLength": 1, "maxLength": 100, "description": "Display name" },
  "email": { "type": "string", "format": "email", "description": "Email address" },
  "role": { "type": "string", "enum": ["admin", "user"], "default": "user", "description": "User role" }
}
```

Schema cross-references are automatically resolved with `$ref`:

```ts
export const AuthResponse = z.object({
  token: z.string().describe('Session token'),
  user: UserSchema.describe('Authenticated user'),  // ← references UserSchema
})
// → "user": { "$ref": "#/components/schemas/UserSchema" }
```

### Drizzle Tables

Add `// comments` above columns. The scanner uses them for `description`.

```ts
export const users = pgTable('users', {
  // Unique identifier for the user
  id: uuid('id').defaultRandom().primaryKey(),
  // Display name shown in the UI
  name: text('name').notNull(),
  // Email address used for login and notifications
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(), // no comment → uses "Created at"
})
```

**Result:**

```json
{
  "id": { "type": "string", "format": "uuid", "readOnly": true, "description": "Unique identifier for the user", "example": "550e8400-e29b-41d4-a716-446655440000" },
  "name": { "type": "string", "description": "Display name shown in the UI", "example": "string" },
  "email": { "type": "string", "description": "Email address used for login and notifications", "example": "string" },
  "createdAt": { "type": "string", "format": "date-time", "readOnly": true, "description": "Created at", "example": "2026-01-15T10:30:00Z" }
}
```

Columns without comments get auto-generated descriptions from the camelCase name (`createdAt` → `"Created at"`). Generated columns (`.defaultRandom()`, `.defaultNow()`, `serial()`) automatically get `readOnly: true`.

### JSDoc on Routes

Add JSDoc above your route handlers for metadata. All annotations are optional — the scanner auto-generates sensible defaults.

```ts
/**
 * List all users with pagination.
 * @description Returns a cursor-paginated list with optional role filtering
 *   and full-text search. Requires admin privileges in production.
 * @tags Users
 * @summary List users
 * @error 404
 */
app.get('/users',
  zValidator('query', UserQuerySchema),
  async (c) => { /* ... */ }
)

/**
 * Health check — no authentication required.
 * @tags Health
 * @public
 */
app.get('/health', (c) => c.json({ status: 'ok' }))
```

| Annotation | Purpose |
|-----------|---------|
| `@tags {Name}` | Group endpoints in docs |
| `@summary {text}` | Short title shown in UI |
| `@description {text}` | Full description (multi-line supported) |
| `@public` | Skip authentication for this route |
| `@deprecated` | Mark as sunset |
| `@hide` | Exclude from spec entirely |
| `@returns {SchemaName}` | Response type — generates `$ref` |
| `@error {status}` | Document custom error status code |
| `@error none` | Disable auto-generated errors for this route |
| `@operationId {name}` | Custom operationId |

### Error Responses

Every route automatically gets context-aware error responses:

| Status | When | Description |
|--------|------|-------------|
| `400` | Route has `zValidator` for body or params | Validation Error |
| `401` | Route is authenticated | Unauthorized |
| `404` | Path contains `{param}` | Not Found |
| `429` | Always | Too Many Requests |
| `500` | Always | Internal Server Error |

The error schema follows a Stripe-style format by default:

```json
{
  "success": false,
  "error": {
    "type": "validation_error",
    "code": "validation_invalid_input",
    "message": "Email is required"
  }
}
```

To customize the error shape, reference your own Zod schema:

```ts
// hono-openapi-scan.config.ts
export default defineConfig({
  errorSchema: ErrorSchema,  // import and pass your Zod object directly
})
```

To disable auto-errors for a specific route:

```ts
/** @error none */
app.get('/internal', (c) => c.json({}))
```

### Better Auth

The scanner detects Better Auth middleware automatically:

```ts
// lib/auth-middleware.ts
export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  // ... sets c.set('user', session.user)
}
```

```ts
// src/index.ts
app.use('*', authMiddleware)  // ← scanner detects this
```

**Result:** Every route under this scope gets `security: [{ bearerAuth: [] }]` and a `401` response. Use `@public` to override:

```ts
/** @public */
app.get('/health', (c) => c.json({ status: 'ok' }))
```

Better Auth handler routes should be hidden from the spec:

```ts
/** @hide */
app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw))
```

## Schema Resolution

### Zod → JSON Schema

The scanner walks Zod AST to produce full JSON Schema:

```ts
// Source
export const CreateUserInput = z.object({
  name: z.string().min(1).max(100).describe('Display name'),
  email: z.string().email(),
  role: z.enum(['admin', 'user']).default('user'),
})
```

```json
// Generated
{
  "type": "object",
  "properties": {
    "name": { "type": "string", "minLength": 1, "maxLength": 100, "description": "Display name" },
    "email": { "type": "string", "format": "email" },
    "role": { "type": "string", "enum": ["admin", "user"], "default": "user" }
  },
  "required": ["name", "email"]
}
```

**Supported Zod methods:** `.string()`, `.number()`, `.boolean()`, `.date()`, `.enum()`, `.array()`, `.object()`, `.nullable()`, `.optional()`, `.nullish()`, `.default()`, `.describe()`, `.min()`, `.max()`, `.email()`, `.url()`, `.uuid()`, `.regex()`, `.int()`, `.coerce.*()`, `.readonly()`, `.deprecated()`

### Drizzle → JSON Schema

Drizzle table definitions are mapped automatically:

| Drizzle | JSON Schema |
|---------|------------|
| `uuid()` | `type: string, format: uuid` |
| `text()` | `type: string` |
| `varchar(n)` | `type: string, maxLength: n` |
| `integer()` / `serial()` | `type: integer` |
| `real()` / `doublePrecision()` | `type: number` |
| `boolean()` | `type: boolean` |
| `timestamp()` / `date()` | `type: string, format: date-time` |
| `pgEnum('name', [...])` | `type: string, enum: [...]` |
| `.notNull()` | Added to `required` |
| `.defaultRandom()` / `.defaultNow()` | `readOnly: true` |

## Output

See [test/fixture/openapi.json](test/fixture/openapi.json) for the complete spec generated from the test fixture — a production-grade Hono + Zod + Drizzle + Better Auth project.

## Config Reference

All fields are optional. Run `hono-openapi-scan init` to generate a config file.

> Full production example: [test/fixture/hono-openapi-scan.config.ts](test/fixture/hono-openapi-scan.config.ts)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `info.title` | `string` | `package.json#name` or `"API"` | API title |
| `info.version` | `string` | `package.json#version` or `"0.0.0"` | API version |
| `info.description` | `string` | First paragraph of `README.md` | API description |
| `servers` | `Array<{url, description?}>` | `[{url:'http://localhost:3000'}]` | Server URLs |
| `security` | `Array<Record<string,string[]>>` | `[]` | Global security requirement |
| `securitySchemes` | `Record<string, SecurityScheme>` | none | Auth scheme definitions |
| `tags` | `Array<{name, description?}>` | auto from paths | Tag groups for endpoints |
| `errorSchema` | `ZodObject` | built-in Stripe-style | Pass your Zod schema object directly |
| `defaultErrorResponses` | `boolean \| number[]` | `true` | Auto error responses |
| `excludeAuth` | `string[]` | `[]` | Paths that skip auth (glob patterns) |
| `entry` | `string` | `"src/index.ts"` | Entry file to scan |
| `output` | `string` | `"openapi.json"` | Output file path |

## Library API

Use the scanner programmatically:

```ts
import { scan, defineConfig } from 'hono-openapi-scan'

// Scan and write to file
const json = await scan({
  entry: 'src/index.ts',
  output: 'openapi.json',
  info: { title: 'My API' },
})

// Or load config from file (handles defaults + package.json + README.md)
import { loadConfig } from 'hono-openapi-scan'
const config = await loadConfig('hono-openapi-scan.config.ts')
const spec = await scan(config)
```

## Development

```bash
bun install
bun run build
bun test              # 42 tests
bun run typecheck     # tsc --noEmit
bun run publish:dry   # preview npm package
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). Enforced via `commitlint` + `husky`.

## Contributing

```bash
git checkout -b feat/my-feature
# ... write code (pre-commit runs bun test)
git commit -m "feat: add my feature"
git push → open PR → CI runs (typecheck + test + build + commitlint)
```

## License

MIT © Raman Karki
