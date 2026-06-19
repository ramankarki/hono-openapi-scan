import { defineConfig } from 'hono-openapi-scan'
import { ErrorSchema } from './src/schemas'

export default defineConfig({
  // ── API metadata ──
  info: {
    title: 'My API',
    version: '1.0.0',
    description:
      'Production-grade REST API built with Hono, Zod, Drizzle ORM, and Better Auth. ' +
      'Features user management, blog posts, authentication with email/password, ' +
      'role-based access control, and cursor pagination.',
  },

  // ── Servers ──
  servers: [
    { url: 'http://localhost:3000', description: 'Local development' },
    { url: 'https://api.example.com', description: 'Production' },
  ],

  // ── Security ──
  security: [{ bearerAuth: [] }],

  securitySchemes: {
    bearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'Better Auth session token. Obtain via POST /auth/sign-in or /auth/sign-up.',
    },
  },

  // ── Tags ──
  tags: [
    { name: 'Auth', description: 'Authentication — sign up, sign in, sign out' },
    { name: 'Users', description: 'User management — CRUD and profile access' },
    { name: 'Posts', description: 'Blog posts — draft/publish workflow' },
    { name: 'Health', description: 'Monitoring and uptime verification' },
  ],

  // ── Error responses ──
  // Pass your Zod schema directly — fully type-safe, no strings.
  errorSchema: ErrorSchema,

  // Auto-generated error responses on every route.
  // true (all: 400, 401, 404, 429, 500) | false (none) | [400, 401, 500] (custom list)
  defaultErrorResponses: true,

  // ── Paths that skip global auth (glob patterns) ──
  excludeAuth: ['/health', '/webhooks/*'],

  // ── Entry & output ──
  entry: 'src/index.ts',
  output: 'openapi.json',
  openapi: '3.1.0',
})
