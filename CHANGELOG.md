# Changelog

## [1.2.0](https://github.com/ramankarki/hono-openapi-scan/compare/hono-openapi-scan-v1.1.0...hono-openapi-scan-v1.2.0) (2026-06-20)


### Features

* resolve spread from c.req.valid() via zValidator schema, not type-walking ([9ce0ad8](https://github.com/ramankarki/hono-openapi-scan/commit/9ce0ad8692fd565592c1c45eedeb99868c7dba0e))
* static response type resolution, full fixture demo, docs sync ([a9f2c17](https://github.com/ramankarki/hono-openapi-scan/commit/a9f2c1723f80fb7b18029a9ce3fcb4975239994b))


### Bug Fixes

* [@returns](https://github.com/returns) JSDoc overrides fallback schemas from c.get() / unresolved types ([b150e6f](https://github.com/ramankarki/hono-openapi-scan/commit/b150e6f9ce07c9ac4d5a898dfc269dc75e38c674))
* context-aware schema ref matching, plurals disambiguation, lower threshold ([6448619](https://github.com/ramankarki/hono-openapi-scan/commit/6448619e1763edf353e9af4e89c3e2bd096df456))
* filter Zod runtime internals from spread types in response schemas ([8e5edbc](https://github.com/ramankarki/hono-openapi-scan/commit/8e5edbc72dac8c8225d0c961ad24b0cac6bfbcff))
* skip function-typed properties from spread types instead of manual filter ([efeeda6](https://github.com/ramankarki/hono-openapi-scan/commit/efeeda6c717021763882a191258ba9d4b91f97a8))
* skip ZodType wrapper objects from spread types cleanly ([1bea772](https://github.com/ramankarki/hono-openapi-scan/commit/1bea772f104131b79efb3f1f468680cf1db6b746))
* strip quotes from Zod property names with hyphens (x-api-version) ([ca7cf58](https://github.com/ramankarki/hono-openapi-scan/commit/ca7cf58b3e3cb9d007871ff990a620cf28840dc8))
* validate [@security](https://github.com/security) against config.securitySchemes, demo custom defaultErrorResponses ([aa499ec](https://github.com/ramankarki/hono-openapi-scan/commit/aa499ec384f57d73407e8fb45f188c8c4b2e68fd))


### Documentation

* add call-tree diagram to HOW_IT_WORKS.md — file→function pipeline map ([3b91b46](https://github.com/ramankarki/hono-openapi-scan/commit/3b91b46d949a37a7ffa993e251fffbe1bed52e27))
* add limitations section to all docs — satisfies, c.get(), z.preprocess/transform ([f9133d9](https://github.com/ramankarki/hono-openapi-scan/commit/f9133d9feb35719cee5ec15079909f101062e508))
* fix call-tree — writeFileSync is in scanner.ts not assemble.ts ([59e196c](https://github.com/ramankarki/hono-openapi-scan/commit/59e196ccde474665edef9a7a5d4ad42f4a082a63))
* sync AGENTS.md with codebase — type-walker, 8-phase pipeline, fixture features ([32b192b](https://github.com/ramankarki/hono-openapi-scan/commit/32b192b8e6ebfa5156148614a48dbfb0d84e5de6))

## [1.1.0](https://github.com/ramankarki/hono-openapi-scan/compare/hono-openapi-scan-v1.0.0...hono-openapi-scan-v1.1.0) (2026-06-19)


### Features

* initial release — OpenAPI 3.1 scanner for Hono ([928d426](https://github.com/ramankarki/hono-openapi-scan/commit/928d4260dd4aa244593aeb6cefddee81a6391795))

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
