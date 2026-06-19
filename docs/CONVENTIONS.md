# Scanner Detection Patterns

> **Zero-config philosophy.** Users write normal Hono + Zod + Drizzle + Better Auth code following each tool's own best practices. No wrapper functions. No special structure required. The scanner detects patterns automatically and generates the OpenAPI spec. These are the patterns we look for — not rules users must follow.

---

## 1. Project Structure (Example)

Users can structure their project however they want. As long as the entry file imports route sub-apps (directly or transitively), the scanner follows the import tree. Below is one common layout — not a requirement.

```
src/
├── index.ts              # Entry: create Hono app, mount routers, export
├── app.ts                # Alternative: app factory + middleware
├── lib/
│   ├── db.ts             # Drizzle instance
│   ├── auth.ts           # Better Auth instance
│   └── auth-middleware.ts# Auth middleware
├── db/
│   └── schema.ts         # Drizzle table definitions
├── routes/
│   ├── users.ts          # Hono sub-app for /users
│   ├── posts.ts          # Hono sub-app for /posts
│   └── auth.ts           # Auth routes (if custom)
├── schemas/
│   ├── user.ts           # Zod schemas: UserSchema, CreateUserInput, etc.
│   └── error.ts          # ErrorSchema
└── types/
    └── index.ts          # Inferred types from Drizzle/Zod
```

### Key file: `src/index.ts`

```ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { auth } from './lib/auth'
import { authMiddleware } from './lib/auth-middleware'
import users from './routes/users'
import posts from './routes/posts'

const app = new Hono<{ Variables: { user: typeof auth.$Infer.Session.user | null; session: typeof auth.$Infer.Session.session | null } }>()

// Global middleware
app.use('*', cors({ origin: 'http://localhost:3001', credentials: true }))
app.use('*', authMiddleware)

// Auth endpoints (Better Auth)
app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw))

// Business routes
app.route('/users', users)
app.route('/posts', posts)

export default app
export type AppType = typeof app
```

---

## 2. Route File Pattern

Route files typically export a Hono instance with routes defined via chaining or individual calls. Both are valid and detected automatically.

### Style A: Chaining (recommended for RPC type inference — Hono best practice)
```ts
// routes/users.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

const ParamsSchema = z.object({ id: z.string().uuid() })
const QuerySchema = z.object({
  role: z.enum(['admin', 'user']).optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  cursor: z.string().optional(),
})
const CreateUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['admin', 'user']).default('user'),
})

const app = new Hono()
  .get('/',
    zValidator('query', QuerySchema),
    async (c) => {
      const { role, limit, cursor } = c.req.valid('query')
      const users = await db.query.users.findMany({ ... })
      return c.json({ data: users, cursor: null }, 200)
    }
  )
  .get('/:id',
    zValidator('param', ParamsSchema),
    async (c) => {
      const { id } = c.req.valid('param')
      const user = await db.query.users.findFirst({ where: eq(users.id, id) })
      if (!user) return c.json({ code: 'NOT_FOUND', message: 'Not found' }, 404)
      return c.json(user, 200)
    }
  )
  .post('/',
    zValidator('json', CreateUserSchema),
    async (c) => {
      const body = c.req.valid('json')
      const user = await db.insert(users).values(body).returning().get()
      return c.json(user, 201)
    }
  )

export default app
```

### Style B: Individual calls (also valid)
```ts
const app = new Hono()
app.get('/', zValidator('query', QuerySchema), handler)
app.get('/:id', zValidator('param', ParamsSchema), handler)
app.post('/', zValidator('json', CreateUserSchema), handler)
export default app
```

**Scanner handles both.** ts-morph traces method chaining and individual calls equally.

---

## 3. Request Validation Pattern

Always uses `zValidator` from `@hono/zod-validator`:

```ts
import { zValidator } from '@hono/zod-validator'

// Path params
zValidator('param', z.object({ id: z.string().uuid() }))

// Query params
zValidator('query', z.object({ search: z.string().optional(), page: z.coerce.number().default(1) }))

// JSON body
zValidator('json', z.object({ name: z.string(), email: z.string().email() }))

// Form data
zValidator('form', z.object({ file: z.instanceof(File) }))

// Headers
zValidator('header', z.object({ authorization: z.string() }))

// Cookie
zValidator('cookie', z.object({ session: z.string() }))
```

**Detection:** Find call expressions where callee is `zValidator`, first arg is string literal matching `'param' | 'query' | 'json' | 'form' | 'header' | 'cookie'`, second arg is `z.object(...)` or a reference to a Zod schema.

---

## 4. Response Pattern

Hono handlers return responses via `c.json()`, `c.text()`, `c.html()`, `c.body()`, etc. The most common:

### Standard return
```ts
return c.json(data, 200)       // { data: User[], cursor: string | null }
return c.json(user, 201)        // User (from Drizzle)
return c.json({ error: '...' }, 404)  // Error
```

### What we can extract:
- **Status code:** second argument to `c.json()` — always a number literal or variable
- **Data shape:** first argument type — resolved via ts-morph from variable or expression
- **Multiple paths:** if/else branches with different `c.json()` calls → multiple response statuses

### Response type detection priority:
1. Handler return type annotation: `async (c): Promise<User> =>`
2. JSDoc `@returns {User}` on handler
3. First arg to `c.json()` traced through ts-morph
4. Fallback: no schema, just status code

---

## 5. Better Auth Integration Pattern

### Auth setup (`lib/auth.ts`)
```ts
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from './db'

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  emailAndPassword: { enabled: true },
  socialProviders: { google: { clientId: '...', clientSecret: '...' } },
})
```

### Auth middleware (`lib/auth-middleware.ts`)
```ts
import type { MiddlewareHandler } from 'hono'
import { auth } from './auth'

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) {
    c.set('user', null)
    c.set('session', null)
    return next()
  }
  c.set('user', session.user)
  c.set('session', session.session)
  await next()
}
```

### What our scanner detects:
- **Auth middleware presence:** finds `app.use('*', authMiddleware)` or `app.use(authMiddleware)` → marks all routes as authenticated
- **Better Auth routes:** `app.on(['POST', 'GET'], '/api/auth/*', ...)` or `app.route('/api/auth', auth.handler())` → auto-excluded from spec (or tagged as "Auth")
- **`@public` override:** route-level JSDoc tag overrides auth requirement
- **Hono Variables type:** `new Hono<{ Variables: { user: ..., session: ... } }>()` → tells us user/session types exist

---

## 6. Drizzle Schema Pattern

```ts
// db/schema.ts
import { pgTable, uuid, text, timestamp, integer, boolean, pgEnum } from 'drizzle-orm/pg-core'

export const roleEnum = pgEnum('role', ['admin', 'user'])

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  role: roleEnum('role').default('user'),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const posts = pgTable('posts', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  authorId: uuid('author_id').references(() => users.id).notNull(),
  published: boolean('published').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
```

### Type mapping Drizzle → JSON Schema:

| Drizzle column | JSON Schema |
|---|---|
| `uuid()` | `{ type: "string", format: "uuid" }` |
| `text()` | `{ type: "string" }` |
| `varchar(n)` | `{ type: "string", maxLength: n }` |
| `integer()` / `serial()` | `{ type: "integer" }` |
| `real()` / `doublePrecision()` | `{ type: "number" }` |
| `boolean()` | `{ type: "boolean" }` |
| `timestamp()` / `date()` | `{ type: "string", format: "date-time" }` |
| `json()` / `jsonb()` | `{ type: "object" }` or inline schema |
| `pgEnum('name', [...])` | `{ type: "string", enum: [...] }` |
| `.notNull()` | Adds to `required` array |
| `.default(val)` | Adds `default` (in output/full schema) |
| `.primaryKey()` | No direct JSON Schema equivalent (informational) |
| `.unique()` | No direct JSON Schema equivalent (informational) |
| `.references(...)` | No direct JSON Schema equivalent (informational) |

### Detection:

Find `pgTable('tableName', { ... })` calls → extract table name from first arg. Use ts-morph `getType()` on the exported const to get the fully-resolved table type → walk properties → build `components.schemas.TableName`.

**Type-inferred, not AST-parsed.** TypeScript resolves column types at compile time. `getType()` gives us the final shape directly. No need to introspect drizzle-orm column builders.

Also: `mysqlTable`, `sqliteTable`, `singlestoreTable`.

---

## 7. Zod Schema Pattern

Zod schemas used for input validation AND sometimes response types:

```ts
// schemas/user.ts
import { z } from 'zod'

export const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  role: z.enum(['admin', 'user']),
  avatarUrl: z.string().url().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export const CreateUserInput = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.enum(['admin', 'user']).default('user'),
})

export const UpdateUserInput = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  role: z.enum(['admin', 'user']).optional(),
})

export const UserListResponse = z.object({
  data: z.array(UserSchema),
  cursor: z.string().nullable(),
})
```

### How schemas get registered:

**Demand-driven.** Only Zod schemas referenced by endpoints (via `zValidator`, handler return type, or JSDoc `@returns`) are registered in `components.schemas`. Unreferenced schemas in reachable files are ignored.

If a schema references another schema (e.g., `z.array(UserSchema)`), we use `$ref` instead of inlining.

```yaml
components:
  schemas:
    UserSchema: { ... }
    CreateUserInput: { ... }
    UpdateUserInput: { ... }
    UserListResponse:
      type: object
      properties:
        data:
          type: array
          items:
            $ref: '#/components/schemas/UserSchema'
        cursor:
          type: string
          nullable: true
```

### Linking schemas to responses:

When a handler return type or `c.json()` arg references a Zod schema export, we link via `$ref`:

```ts
// If handler returns: c.json({ data: users, cursor: nextCursor }, 200)
// and ts-morph resolves the type to match UserListResponse's shape,
// or the handler has type annotation: async (c): Promise<z.infer<typeof UserListResponse>>
// → response uses $ref: '#/components/schemas/UserListResponse'
```

---

## 8. JSDoc Convention Pattern

JSDoc on handler functions (inline or arrow):

```ts
/**
 * List all users with optional role filtering and cursor pagination.
 * @tags Users
 */
app.get('/users', zValidator('query', QuerySchema), async (c) => { ... })
```

Or on named handler functions (alternative pattern, less common but valid):

```ts
/**
 * Get a single user by ID.
 * @tags Users
 * @public
 */
async function getUser(c: Context) { ... }

app.get('/users/:id', zValidator('param', ParamsSchema), getUser)
```

**Scanner handles both:**
1. JSDoc on arrow function directly in `app.get()` call
2. JSDoc on named function referenced in `app.get()` call

---

## 9. Common Patterns to Detect

### Pattern: Middleware that injects auth context
```ts
app.use('*', authMiddleware)         // → all routes authenticated
app.use('/api/*', authMiddleware)    // → /api/* authenticated
```

### Pattern: Mixed auth (most routes protected, some public)
```ts
app.use('*', authMiddleware)         // global auth check

/** @public */
app.get('/health', (c) => c.json({ ok: true }))

/** @public */
app.get('/webhooks/stripe', stripeHandler)
```

### Pattern: Route groups with different auth
```ts
const publicApp = new Hono()
  .get('/health', healthHandler)
  .get('/docs', docsHandler)

const protectedApp = new Hono()
  .use('*', authMiddleware)
  .get('/profile', profileHandler)

app.route('/', publicApp)
app.route('/api', protectedApp)
```

Detection: if a sub-app has `app.use('*', authMiddleware)`, all its routes are authenticated. `@public` on individual routes overrides.

### Pattern: File uploads
```ts
app.post('/upload',
  zValidator('form', z.object({
    file: z.instanceof(File),
    caption: z.string().optional(),
  })),
  async (c) => { ... }
)
```

Detection: `zValidator('form', ...)` → `requestBody.content["multipart/form-data"]`

---

## 10. What We Do NOT Support (Out of Scope)

- **RPC client generation** — this package generates OpenAPI spec, not client types (use `hc<AppType>` for that)
- **WebSocket routes** — `app.get('/ws', upgradeWebSocket(...))` — skip in spec
- **Middleware-only routes** — `app.use(path, middleware)` without handler — skip
- **`app.all()` routes** — could map to all methods but ambiguous. Skip or configurable.
- **Dynamic route registration** — if routes are generated at runtime (loop/condition), ts-morph can't see them. Skip.
- **Streaming responses** — `c.stream()` / `c.streamText()` — mark as `application/octet-stream` without schema
- **Redirect responses** — `c.redirect()` → 302/301 response without body schema

---

## 11. Convention Summary (For Scanner Design)

| What | Convention | How we detect |
|---|---|---|
| App entry | `export default app` or `export const app` | ts-morph: find `new Hono()` assigned to export |
| Route definition | `.get(path, ...middleware, handler)` | Walk call expressions, resolve path + method |
| Path params | `zValidator('param', z.object({...}))` | Find in middleware array, extract schema |
| Query params | `zValidator('query', z.object({...}))` | Find in middleware array, extract schema |
| Request body | `zValidator('json', z.object({...}))` | Find in middleware array, extract schema |
| Form data | `zValidator('form', z.object({...}))` | Find in middleware array, extract schema |
| Headers | `zValidator('header', z.object({...}))` | Find in middleware array, extract schema |
| Response | `c.json(data, status)` | Find return statements in handler body |
| Response type | Handler return annotation or type tracing | ts-morph type resolution |
| Auth | `app.use('*', authMiddleware)` | Trace middleware to auth check |
| Public route | `@public` JSDoc | Parse JSDoc on handler |
| Tags | `@tags` JSDoc or auto from path | Parse JSDoc or path segment |
| Summary | `@summary` JSDoc or auto | Parse JSDoc or method+path |
| Schema registry | Referenced Zod schemas only | Collect Zod schemas referenced by endpoints (zValidator, return type, @returns) |
| Drizzle types | Referenced `pgTable(...)` calls only | Find table definitions referenced by endpoints, map to JSON Schema |
| Sub-routers | `app.route('/prefix', subApp)` | Trace subApp definition, prefix paths |
| Better Auth | `app.on(['POST','GET'], '/api/auth/*', cb)` | Auto-exclude or tag as "Auth" |
