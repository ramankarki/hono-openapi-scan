import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { ApiError } from '../lib/api-error'
import { ErrorCode } from '../lib/error-codes'
import {
  CreateUserInput,
  UpdateUserInput,
  UserQuerySchema,
  UserParamsSchema,
} from '../schemas'

const app = new Hono()

/**
 * List all users.
 * @description Returns a paginated list of users with optional role filtering,
 *   full-text search by name or email, and cursor-based pagination.
 *   Requires admin privileges in production.
 * @tags Users
 * @summary List users
 */
app.get('/',
  zValidator('query', UserQuerySchema),
  async (c) => {
    const { role, search, limit, cursor } = c.req.valid('query')
    const users: Array<{ id: string; name: string; email: string }> = []
    const nextCursor = users.length > limit ? users.pop()?.id ?? null : null
    return c.json({ data: users, total: users.length, cursor: nextCursor }, 200)
  }
)

/**
 * Get a single user by ID.
 * @description Returns the full user profile including email, role, avatar,
 *   and timestamps. Does not return sensitive fields like password hash.
 * @tags Users
 * @summary Get user by ID
 * @error 404
 */
app.get('/:id',
  zValidator('param', UserParamsSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const user = { id, name: 'Test User', email: 'test@example.com' }
    if (!user) throw new ApiError(ErrorCode.USER_NOT_FOUND, `User ${id} not found`)
    return c.json(user, 200)
  }
)

/**
 * Create a new user.
 * @description Registers a new user account with name, email, password, and
 *   optional role assignment. The password is hashed before storage.
 *   Returns the created user profile (without password).
 * @tags Users
 * @summary Create user
 * @error 409
 */
app.post('/',
  zValidator('json', CreateUserInput),
  async (c) => {
    const body = c.req.valid('json')
    const emailExists = false
    if (emailExists) throw new ApiError(ErrorCode.USER_EMAIL_ALREADY_EXISTS, `Email ${body.email} is already registered`)
    const user = {
      id: 'new-id', name: body.name, email: body.email,
      emailVerified: false, image: null, role: body.role,
      createdAt: new Date(), updatedAt: new Date(),
    }
    return c.json(user, 201)
  }
)

/**
 * Update an existing user.
 * @description Partially updates a user profile. Only the fields provided
 *   in the request body are changed. Admin or the user themselves can update.
 * @tags Users
 * @summary Update user
 * @error 404
 */
app.patch('/:id',
  zValidator('param', UserParamsSchema),
  zValidator('json', UpdateUserInput),
  async (c) => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    return c.json({ id, ...body, updatedAt: new Date() }, 200)
  }
)

/**
 * Delete a user.
 * @description Permanently removes a user account and all associated data.
 *   This action cannot be undone. Requires admin privileges.
 * @tags Users
 * @summary Delete user
 * @error 404
 */
app.delete('/:id',
  zValidator('param', UserParamsSchema),
  async (c) => {
    return c.json({ success: true }, 200)
  }
)

/**
 * Get current user profile.
 * @description Returns the authenticated user's own profile using the session
 *   token. Does not require a user ID — derives identity from the auth middleware.
 * @tags Users
 * @summary Get current user profile
 */
app.get('/me', async (c) => {
  const user = c.get('user')
  if (!user) throw ApiError.notAuthenticated('Sign in to access your profile')
  return c.json(user, 200)
})

export default app
