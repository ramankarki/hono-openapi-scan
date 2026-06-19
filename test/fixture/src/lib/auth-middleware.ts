import type { MiddlewareHandler } from 'hono'
import { auth } from './auth'

/**
 * Better Auth session middleware.
 * Sets `user` and `session` on Hono context variables.
 * Routes without a valid session get `user: null` and `session: null`.
 */
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
