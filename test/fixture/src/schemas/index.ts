import { z } from 'zod'

// ── Error ──

/** Stripe-style error response envelope */
export const ErrorSchema = z.object({
  success: z.literal(false).describe('Always false for error responses'),
  error: z.object({
    type: z.enum([
      'authentication_error',
      'authorization_error',
      'validation_error',
      'not_found_error',
      'conflict_error',
      'internal_server_error',
    ]).describe('Broad error category'),
    code: z.string().describe('Machine-readable error code (e.g. user_not_found)'),
    message: z.string().describe('Human-readable error message'),
  }).describe('Error details'),
})

// ── User ──

export const UserSchema = z.object({
  id: z.string().uuid().describe('Unique identifier'),
  name: z.string().min(1).max(100).describe('Display name'),
  email: z.string().email().describe('Email address'),
  emailVerified: z.boolean().describe('Whether email is verified'),
  image: z.string().url().nullable().describe('Avatar URL'),
  role: z.enum(['admin', 'user', 'moderator']).describe('User role'),
  createdAt: z.date().describe('Creation timestamp'),
  updatedAt: z.date().describe('Last update timestamp'),
})

export const CreateUserInput = z.object({
  name: z.string().min(1).max(100).describe('Display name'),
  email: z.string().email().describe('Email address'),
  password: z.string().min(8).max(128).describe('Account password'),
  role: z.enum(['admin', 'user', 'moderator']).default('user').describe('User role'),
})

export const UpdateUserInput = z.object({
  name: z.string().min(1).max(100).optional().describe('Display name'),
  image: z.string().url().nullable().optional().describe('Avatar URL'),
  role: z.enum(['admin', 'user', 'moderator']).optional().describe('User role'),
})

export const UserListResponse = z.object({
  data: z.array(UserSchema).describe('List of users'),
  total: z.number().int().min(0).describe('Total count'),
  cursor: z.string().nullable().describe('Pagination cursor'),
})

// ── Auth ──

export const SignUpInput = z.object({
  name: z.string().min(1).max(100).describe('Display name'),
  email: z.string().email().describe('Email address'),
  password: z.string().min(8).max(128).describe('Password'),
})

export const SignInInput = z.object({
  email: z.string().email().describe('Email address'),
  password: z.string().min(1).describe('Password'),
})

export const AuthResponse = z.object({
  token: z.string().describe('Session token'),
  user: UserSchema.describe('Authenticated user'),
})

// ── Post ──

export const PostSchema = z.object({
  id: z.string().uuid().describe('Unique identifier'),
  title: z.string().min(1).max(200).describe('Post title'),
  slug: z.string().min(1).max(200).describe('URL-friendly slug'),
  content: z.string().min(1).describe('Post body (markdown)'),
  excerpt: z.string().max(500).nullable().describe('Short description'),
  status: z.enum(['draft', 'published', 'archived']).describe('Publication status'),
  authorId: z.string().uuid().describe('Author user ID'),
  viewCount: z.number().int().min(0).describe('View count'),
  publishedAt: z.date().nullable().describe('Publication date'),
  createdAt: z.date().describe('Creation timestamp'),
  updatedAt: z.date().describe('Last update timestamp'),
})

export const CreatePostInput = z.object({
  title: z.string().min(1).max(200).describe('Post title'),
  slug: z.string().min(1).max(200).describe('URL-friendly slug'),
  content: z.string().min(1).describe('Post body (markdown)'),
  excerpt: z.string().max(500).optional().describe('Short description'),
  status: z.enum(['draft', 'published', 'archived']).default('draft').describe('Publication status'),
})

export const UpdatePostInput = z.object({
  title: z.string().min(1).max(200).optional().describe('Post title'),
  content: z.string().min(1).optional().describe('Post body (markdown)'),
  excerpt: z.string().max(500).nullable().optional().describe('Short description'),
  status: z.enum(['draft', 'published', 'archived']).optional().describe('Publication status'),
  publishedAt: z.date().nullable().optional().describe('Publication date'),
})

export const PostListResponse = z.object({
  data: z.array(PostSchema).describe('List of posts'),
  total: z.number().int().min(0).describe('Total count'),
  cursor: z.string().nullable().describe('Pagination cursor'),
})

// ── Query schemas ──

export const UserQuerySchema = z.object({
  role: z.enum(['admin', 'user', 'moderator']).optional().describe('Filter by role'),
  search: z.string().min(1).optional().describe('Search by name or email'),
  limit: z.coerce.number().int().min(1).max(100).default(20).describe('Items per page'),
  cursor: z.string().optional().describe('Pagination cursor'),
})

export const PostQuerySchema = z.object({
  status: z.enum(['draft', 'published', 'archived']).optional().describe('Filter by status'),
  authorId: z.string().uuid().optional().describe('Filter by author'),
  search: z.string().min(1).optional().describe('Search title/content'),
  limit: z.coerce.number().int().min(1).max(100).default(20).describe('Items per page'),
  cursor: z.string().optional().describe('Pagination cursor'),
})

export const UserParamsSchema = z.object({
  id: z.string().uuid().describe('User unique identifier'),
})

export const PostParamsSchema = z.object({
  id: z.string().uuid().describe('Post unique identifier'),
})

// ── Cookie / Header / Form schemas ──

export const SessionCookieSchema = z.object({
  session: z.string().describe('Better Auth session token'),
})

export const ApiVersionHeaderSchema = z.object({
  'x-api-version': z.string().optional().describe('API version to use'),
  'x-client-id': z.string().describe('Client application identifier'),
})

export const FileUploadSchema = z.object({
  file: z.instanceof(File).describe('File to upload'),
  caption: z.string().optional().describe('Optional caption'),
})
