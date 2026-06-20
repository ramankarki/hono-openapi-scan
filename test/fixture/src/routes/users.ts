import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { ApiError } from '../lib/api-error'
import { ErrorCode } from '../lib/error-codes'
import { users as usersTable } from '../db/schema'
import {
  CreateUserInput,
  UpdateUserInput,
  UserQuerySchema,
  UserParamsSchema,
  SessionCookieSchema,
  FileUploadSchema,
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
    const items: Array<{ id: string; name: string; email: string }> = []
    const nextCursor = items.length > limit ? items.pop()?.id ?? null : null
    return c.json({ data: items, total: items.length, cursor: nextCursor }, 200)
  }
)

/**
 * Get a single user by ID.
 * @description Returns the full user profile including email, role, avatar,
 *   and timestamps. Does not return sensitive fields like password hash.
 * @tags Users
 * @summary Get user by ID
 * @returns {UserSchema}
 * @error 404
 */
app.get('/:id',
  zValidator('param', UserParamsSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    // Drizzle-inferred type: id/createdAt/updatedAt are readOnly
    const user = {
      id,
      name: 'Test User',
      email: 'test@example.com',
      emailVerified: false,
      image: null,
      role: 'user' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as typeof usersTable.$inferSelect
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
    // Drizzle-inferred type — id/createdAt/updatedAt are readOnly
    const user = {
      id: 'new-id',
      name: body.name,
      email: body.email,
      emailVerified: false,
      image: null,
      role: body.role,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as typeof usersTable.$inferSelect
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
 * @returns {UserSchema}
 */
app.get('/me', async (c) => {
  const user = c.get('user')
  if (!user) throw ApiError.notAuthenticated('Sign in to access your profile')
  return c.json(user, 200)
})

/**
 * Get user preferences.
 * @description Returns user-specific settings like theme, notifications, and
 *   language preferences. Requires a valid session cookie.
 * @tags Users
 * @summary Get user preferences
 */
app.get('/me/settings',
  zValidator('cookie', SessionCookieSchema),
  async (c) => {
    const { session } = c.req.valid('cookie')
    return c.json({
      theme: 'dark' as const,
      notifications: true,
      language: 'en',
    }, 200)
  }
)

/**
 * Upload user avatar.
 * @description Upload a profile picture. Max 5 MB. Supports jpg, png, webp.
 * @tags Users
 * @summary Upload avatar
 */
app.post('/me/avatar',
  zValidator('form', FileUploadSchema),
  async (c) => {
    const { file } = c.req.valid('form')
    return c.json({ url: 'https://cdn.example.com/avatars/user-123.webp' }, 201)
  }
)

/**
 * Export user data.
 * @description Returns a raw binary export of all user data in JSON format.
 * @tags Users
 * @summary Export user data
 */
app.get('/me/export', async (c) => {
  const data = new Uint8Array([123, 34, 110, 97, 109, 101, 34, 58, 34, 84, 101, 115, 116, 34, 125])
  return c.body(data, 200)
})

/**
 * Legacy user lookup by username.
 * @description Use GET /users?search=username instead.
 *   Will be removed in v2.0.0.
 * @tags Users
 * @summary Lookup user by username (legacy)
 * @deprecated
 * @security {bearerAuth, apiKey}
 */
app.get('/legacy/:username', async (c) => {
  const username = c.req.param('username')
  return c.json({ id: 'legacy-id', username }, 200)
})

export default app
