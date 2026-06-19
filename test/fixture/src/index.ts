import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { auth } from './lib/auth'
import { authMiddleware } from './lib/auth-middleware'
import { ApiError } from './lib/api-error'
import { ErrorCode } from './lib/error-codes'
import authRoutes from './routes/auth'
import users from './routes/users'
import posts from './routes/posts'
import health from './routes/health'

const app = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null
    session: typeof auth.$Infer.Session.session | null
  }
}>()
  // ── Global middleware ──
  .use('*', cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  }))
  .use('*', authMiddleware)

  // ── Mount routers ──
  .route('/auth', authRoutes)
  .route('/users', users)
  .route('/posts', posts)
  .route('/', health)

// ── Global error handler (cannot be chained — onError returns void) ──
app.onError((err, c) => {
    console.error(`[${err.name}] ${err.message}`)

    if (err instanceof ApiError) {
      return c.json(
        { success: false, error: { type: err.type, code: err.code, message: err.message } },
        err.status
      )
    }

    if (err instanceof HTTPException) {
      return c.json(
        { success: false, error: { type: 'internal_server_error', code: ErrorCode.INTERNAL_SERVER_ERROR, message: err.message } },
        err.status
      )
    }

    return c.json(
      { success: false, error: { type: 'internal_server_error', code: ErrorCode.INTERNAL_SERVER_ERROR, message: 'An unexpected error occurred' } },
      500
    )
  })

export default app

export type AppType = typeof app
