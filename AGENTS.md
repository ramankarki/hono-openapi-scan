# AGENTS.md — hono-openapi-scan

## Project Overview

**What it is:** CLI tool that scans Hono TypeScript codebases and generates OpenAPI 3.1 specs. Pure static analysis using ts-morph — never runs user code.

**One-liner:** `hono-openapi-scan src/index.ts` → `openapi.json`

**Repo:** [github.com/ramankarki/hono-openapi-scan](https://github.com/ramankarki/hono-openapi-scan)
**npm:** `hono-openapi-scan`
**Package manager:** bun

---

## Architecture

```
src/
├── cli.ts          # Commander CLI entry: `hono-openapi-scan [entry] [--config]`, `init`
├── index.ts        # Public API re-exports (scan, loadConfig, defineConfig)
├── config.ts       # Config loading + defaults (package.json, README.md fallbacks)
├── scanner.ts      # Orchestrates pipeline: project → registry → routes → assemble → write
├── project.ts      # ts-morph Project setup + import tree resolution
├── routes.ts       # Walk AST to find Hono apps, routes, middleware, responses
├── type-walker.ts  # Convert ts-morph Type → JSON Schema for response bodies
├── assemble.ts     # Build OpenAPI 3.1 spec from RouteInfo[]. normalizeResponseRefs.
├── zod-schema.ts   # Walk Zod AST → JSON Schema (z.object, z.string, chained methods)
├── drizzle.ts      # Detect pgTable/mysqlTable/sqliteTable → JSON Schema (text-based)
├── jsdoc.ts        # Parse JSDoc → JSDocInfo (@tags, @public, @returns, @security, etc.)
└── types.ts        # All TypeScript interfaces (RouteInfo, ScanConfig, SchemaRef, etc.)
```

### Pipeline (8 phases)

1. **Resolve** (`project.ts`): Start at entry file, follow all imports transitively via ts-morph. Only reachable files parsed.
2. **Find apps** (`routes.ts::buildAppRegistry`): Find all `new Hono()` expressions + auth middleware scopes (`app.use('*', authMiddleware)`). Collect known schema names for $ref resolution.
3. **Walk routes** (`routes.ts::walkAppRoutes`): For each Hono app, find `.get()/.post()/.put()/.patch()/.delete()/.on()` calls. Extract middleware chain, handler, JSDoc. Follow `.route()` to sub-apps recursively. For each handler, AST-walk body to find `c.json()`/`c.body()`/etc. calls. Resolve data types via `type-walker.ts::getType()`.
4. **Collect Zod schemas** (`assemble.ts`): Demand-driven — only Zod schemas referenced by endpoints (via zValidator or @returns) are registered.
5. **Build schemas** (`assemble.ts`): Resolve Zod AST → JSON Schema. Detect Drizzle tables matching response shapes → register with readOnly. Transitive $ref resolution. Auto-generate examples.
6. **Normalize refs** (`assemble.ts::normalizeResponseRefs`): Replace inline response schemas that match component schemas with $ref. Handles anonymous types from `as` assertions.
7. **Assemble** (`assemble.ts::assembleSpec`): Build full OpenAPI 3.1 object — paths, parameters, request bodies, responses, error schemas, security, tags, components.
8. **Write** (`scanner.ts`): JSON.stringify + writeFileSync.

### Key Design Decisions

- **Demand-driven schemas:** Only schemas actually referenced by routes are in `components/schemas`. Unreferenced exports are ignored.
- **Zod AST, not `zod-to-json-schema`:** Custom AST walker (`zod-schema.ts`) converts Zod definitions to JSON Schema. Handles chained methods (`.min()`, `.email()`, `.describe()`), cross-schema `$ref`, and type constructors. `zod-to-json-schema` only used for user-provided `config.errorSchema` Zod objects.
- **Response type resolution:** `type-walker.ts` converts ts-morph `getType()` results to JSON Schema. AST walks handler bodies to find `c.json(data, status)` calls, resolves data types to full schemas with properties, nullability, and nested objects. Also handles `c.body()`, `c.text()`, `c.html()`, `c.redirect()`.
- **Drizzle via text patterns:** Column type detection uses callee text matching (`calleeText.includes('uuid')`), not ts-morph `getType()`. Simple and works for all Drizzle dialects. Registration is demand-driven via shape matching — tables only appear in components when response schemas match their property set.
- **Schema ref normalization:** `normalizeResponseRefs` matches inline response schemas against component schemas by property names. Handles anonymous types from `as typeof table.$inferSelect` assertions where ts-morph produces synthetic types without declarations.
- **No runtime deps for scanning:** ts-morph does all the work. User's code is never executed.
- **Query/header/cookie param expansion:** `zValidator('query/header/cookie', schema)` → individual parameters expanded from schema properties (not a single `$ref`).
- **Default error schema:** RFC 9457 format — `{ code, message, status, details[] }` with SCREAMING_SNAKE_CASE codes. Overridable via `config.errorSchema`.
- **Error responses auto-generated:** 400 (has validation), 401 (route is auth), 404 (has path params), 429, 500. Disable with `@error none` or `config.defaultErrorResponses: false`.
- **Auth detection:** Looks for `app.use('*', middleware)` where middleware body contains patterns like `auth.api.getSession`, `c.set('user'`, `c.set('session'`. Routes can override with `@public` or explicit `@security {scheme1, scheme2}`.

---

## Coding Conventions

### Language
- TypeScript only. Target: `tsconfig.json` with strict mode.
- Runtime: Bun. Tests use `bun test`. Build uses `bun build`.

### Commits
- **Conventional Commits** enforced by commitlint + husky.
- Format: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`
- Husky hooks: `commit-msg` (commitlint), `pre-commit` (bun test).

### Code Style
- Prettier with default config (`.prettierrc`: `{}` with `.prettierignore`).
- No ESLint configured. TypeScript compiler handles type safety.
- Type-safe config: `defineConfig()` identity function for user config.

### File Conventions
- Source: `src/` — one file per concern. No barrel files beyond `index.ts`.
- Tests: `test/unit/` — unit tests (bun test). Test fixture: `test/fixture/` — complete mock Hono project.
- Docs: `docs/` — markdown only. README.md at root.
- Output: `dist/` — built files (gitignored).

### Naming
- Functions: camelCase (`walkAppRoutes`, `buildAppRegistry`)
- Types/interfaces: PascalCase (`RouteInfo`, `ScanConfig`)
- Exported schemas (user code): PascalCase (`UserSchema`, `CreateUserInput`)
- Table names (Drizzle → schemas): PascalCase (`Users`, `Posts`)
- File names: kebab-case (`zod-schema.ts`, `auth-middleware.ts`)

### Adding Features
1. Types go in `types.ts`.
2. New concern → new file in `src/`.
3. If it affects OpenAPI output → add to `assemble.ts` pipeline.
4. If it detects new patterns → add to `routes.ts` or new detector file.
5. Test fixture lives in `test/fixture/` — add routes/schemas/tables there.
6. Unit tests in `test/unit/` using bun test.

### Key Dependencies
| Package | Why |
|---------|-----|
| `ts-morph` | AST parsing, type resolution, JSDoc, import tree traversal |
| `zod` | Peer dependency on user's project. Our `zod-schema.ts` walks Zod AST. |
| `zod-to-json-schema` | Used only for user-provided `errorSchema` Zod objects in config. |
| `openapi-types` | TypeScript types for OpenAPI 3.1 (no runtime). |
| `commander` | CLI argument parsing. |

### Do NOT
- Add runtime middleware — this is a build-time tool.
- Use `ts-morph.getType()` for Zod/Drizzle schema building — AST text-based detection is simpler and more reliable for these patterns. (Response type resolution DOES use `getType()` — that's for runtime data shapes, not schema definitions.)
- Add new dependencies without strong justification.
- Change `dist/` files by hand — build pipeline handles it.
- Modify test fixture without updating expected output (`test/fixture/openapi.json`).

---

## Test Fixture

`test/fixture/` is a complete mock Hono project exercising all scanner features:
- `src/index.ts` — Entry: 3 Hono apps mounted via `.route()`, Better Auth middleware, CORS
- `src/routes/users.ts` — GET/POST/PATCH/DELETE + cookie zValidator + form upload + c.body() + deprecated legacy route + @security per-route
- `src/routes/posts.ts` — GET/POST/PATCH/DELETE with zValidator, JSDoc on chained handlers
- `src/routes/auth.ts` — Better Auth handler routes (@hide)
- `src/routes/health.ts` — Public health + system info with header zValidator
- `src/schemas/index.ts` — 23 Zod schema exports (User, Post, Auth, Query, Params, Cookie, Header, Form)
- `src/db/schema.ts` — Drizzle pgTable definitions (users, posts) with comments → readOnly detection
- `src/lib/auth-middleware.ts` — Better Auth middleware (auto-detected)
- `src/lib/auth.ts` — betterAuth instance
- `src/lib/db.ts` — Drizzle instance
- `hono-openapi-scan.config.ts` — Config with custom ErrorSchema, servers, security
- `openapi.json` — Golden file: 22 operations, 22 component schemas, 86 $ref refs

Running tests: `bun test` (from project root). 54 tests total (4 test files).

---

## Docs

- `docs/CONVENTIONS.md` — Scanner detection patterns (Zod, Drizzle, Better Auth, JSDoc). Linked from README.
- `docs/SPEC.md` — Full specification v1. Scopes, boundaries, Zod→JSON Schema mapping, error rules, operationId generation.
- `docs/HOW_IT_WORKS.md` — Beginner-friendly walkthrough of the scan pipeline. Linked from README.

---

## Release Process

- **release-please** manages version bumps and changelog.
- CI: typecheck → test → build on PRs to `main`.
- Release CI: release-please creates release PR, auto-publishes to npm on merge.
- `bun run publish:dry` for local verification.
