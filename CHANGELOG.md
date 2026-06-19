# Changelog

## 1.0.0 (2026-06-19)

### Features

- Initial release
- Scan Hono codebase and generate OpenAPI 3.1 specs
- Zero-config: detects routes, Zod schemas, Drizzle tables, JSDoc automatically
- Stripe-style error schema with `success` / `error { type, code, message }`
- Better Auth integration: detects auth middleware, marks routes as authenticated
- Cross-schema `$ref` resolution for Zod schemas
- Drizzle ORM table detection → JSON Schema with readOnly/writeOnly
- Query parameter expansion from Zod validation schemas
- JSDoc support: `@tags`, `@summary`, `@description`, `@public`, `@deprecated`, `@hide`, `@returns`, `@error`, `@security`
- Config file: `hono-openapi-scan.config.ts` with full type safety
- CLI: `hono-openapi-scan init`, `--config`, `--output`, `--title`
