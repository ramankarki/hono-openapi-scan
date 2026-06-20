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
├── scanner.ts      # Orchestrates the pipeline: project → registry → routes → assemble → write
├── project.ts      # ts-morph Project setup + import tree resolution
├── routes.ts       # Walk AST to find Hono apps, routes, middleware, responses
├── assemble.ts     # Build OpenAPI 3.1 spec object from RouteInfo[]
├── zod-schema.ts   # Walk Zod AST → JSON Schema (z.object, z.string, chained methods)
├── drizzle.ts      # Detect pgTable/mysqlTable/sqliteTable → JSON Schema
├── jsdoc.ts        # Parse JSDoc comments → JSDocInfo (@tags, @public, @returns, etc.)
└── types.ts        # All TypeScript interfaces (RouteInfo, ScanConfig, SchemaRef, etc.)
```

### Pipeline (6 passes)

1. **Resolve** (`project.ts`): Start at entry file, follow all imports transitively via ts-morph. Only reachable files parsed.
2. **Find apps** (`routes.ts::buildAppRegistry`): Find all `new Hono()` expressions + auth middleware scopes (`app.use('*', authMiddleware)`).
3. **Walk routes** (`routes.ts::walkAppRoutes`): For each Hono app, find `.get()/.post()/.put()/.patch()/.delete()/.on()` calls. Extract middleware chain, handler, JSDoc. Follow `.route()` to sub-apps recursively.
4. **Collect schemas** (`assemble.ts`): Demand-driven — only Zod/Drizzle schemas referenced by endpoints are registered. Transitive `$ref` resolution loop.
5. **Assemble** (`assemble.ts::assembleSpec`): Build full OpenAPI 3.1 object — paths, parameters, request bodies, responses, error schemas, security, tags, components.
6. **Write** (`scanner.ts`): JSON.stringify + writeFileSync.

### Key Design Decisions

- **Demand-driven schemas:** Only schemas actually referenced by routes are in `components/schemas`. Unreferenced exports are ignored.
- **Zod AST, not `zod-to-json-schema`:** Custom AST walker (`zod-schema.ts`) converts Zod definitions to JSON Schema. Handles chained methods (`.min()`, `.email()`, `.describe()`), cross-schema `$ref`, and type constructors. `zod-to-json-schema` only used for user-provided `config.errorSchema` Zod objects.
- **Drizzle via text patterns:** Column type detection uses callee text matching (`calleeText.includes('uuid')`), not ts-morph `getType()`. Simple and works for all Drizzle dialects.
- **No runtime deps for scanning:** ts-morph does all the work. User's code is never executed.
- **Query parameter expansion:** `zValidator('query', schema)` → individual parameters expanded from schema properties (not a single `$ref`).
- **Error responses auto-generated:** 400 (has validation), 401 (route is auth), 404 (has path params), 429, 500. Disable with `@error none` or `config.defaultErrorResponses: false`.
- **Auth detection:** Looks for `app.use('*', middleware)` where middleware body contains patterns like `auth.api.getSession`, `c.set('user'`, `c.set('session'`. Routes can override with `@public`.

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
- Use `ts-morph.getType()` for Zod/Drizzle mapping — AST text-based detection is simpler and more reliable for these patterns.
- Add new dependencies without strong justification.
- Change `dist/` files by hand — build pipeline handles it.
- Modify test fixture without updating expected output (`test/fixture/openapi.json`).

---

## Test Fixture

`test/fixture/` is a complete mock Hono project:
- `src/index.ts` — 3 Hono apps (main, auth, health), Better Auth middleware, routes
- `src/routes/users.ts` — GET/POST routes with zValidator
- `src/routes/posts.ts` — GET/POST routes
- `src/routes/auth.ts` — Better Auth handler routes
- `src/routes/health.ts` — public health endpoint
- `src/schemas/index.ts` — Zod schemas (UserSchema, CreateUserInput, etc.)
- `src/db/schema.ts` — Drizzle pgTable definitions
- `src/lib/auth-middleware.ts` — Better Auth middleware
- `src/lib/auth.ts` — betterAuth instance
- `src/lib/db.ts` — Drizzle instance
- `src/lib/api-error.ts` — Custom error class
- `src/lib/error-codes.ts` — Error code constants
- `hono-openapi-scan.config.ts` — Config for the fixture
- `openapi.json` — Expected output (golden file)

Running tests: `bun test` (from project root). 42 tests total.

---

## Docs Not In README

The following docs exist but are **not linked from README.md**:

- `docs/CONVENTIONS.md` — Scanner detection patterns (Zod, Drizzle, Better Auth, JSDoc conventions). Internal reference for what the scanner looks for.
- `docs/SPEC.md` — Full specification v1. Scopes, boundaries, Zod→JSON Schema mapping table, error response rules, operationId generation, edge cases.

README links: `docs/HOW_IT_WORKS.md` (also links to `README.md#zod--json-schema`).

---

## Release Process

- **release-please** manages version bumps and changelog.
- CI: typecheck → test → build on PRs to `main`.
- Release CI: release-please creates release PR, auto-publishes to npm on merge.
- `bun run publish:dry` for local verification.
