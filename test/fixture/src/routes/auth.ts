import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { ApiError } from '../lib/api-error'
import { ErrorCode } from '../lib/error-codes'
import { auth } from '../lib/auth'
import { SignUpInput, SignInInput, AuthResponse } from '../schemas'

/**
 * Better Auth handler.
 * @description Proxies all /api/auth/* requests to the Better Auth handler for
 *   built-in flows (OAuth callbacks, email verification, password reset, etc.).
 *   Excluded from OpenAPI spec — documented by Better Auth separately.
 * @hide
 */
const app = new Hono()
  .on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw))
  .post('/sign-up',
    zValidator('json', SignUpInput),
    /**
     * Sign up a new user.
     * @description Creates a new account with email and password. Sends a
     *   verification email if email verification is enabled. Returns a session
     *   token and the user profile on success.
     * @tags Auth
     * @public
     * @error 409
     */
    async (c) => {
      const body = c.req.valid('json')
      return c.json({
        token: 'session-token',
        user: { id: 'new-user-id', name: body.name, email: body.email },
      }, 201)
    }
  )
  .post('/sign-in',
    zValidator('json', SignInInput),
    /**
     * Sign in with email and password.
     * @description Authenticates a user with their email and password credentials.
     *   Returns a session token valid for 7 days and the user profile.
     *   The session token should be sent as a Bearer token in the Authorization header.
     * @tags Auth
     * @public
     * @returns {AuthResponse}
     * @error 401
     */
    async (c): Promise<z.infer<typeof AuthResponse>> => {
      const body = c.req.valid('json')
      return c.json({
        token: 'session-token',
        user: { id: 'user-123', name: 'Test User', email: body.email },
      }, 200)
    }
  )
  .post('/sign-out',
    /**
     * Sign out current session.
     * @description Invalidates the current session token. After signing out,
     *   the token can no longer be used to access protected resources.
     *   Subsequent requests must re-authenticate.
     * @tags Auth
     */
    async (c) => {
      return c.json({ success: true }, 200)
    }
  )

export default app
