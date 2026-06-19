import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { ApiError } from '../lib/api-error'
import { ErrorCode } from '../lib/error-codes'
import {
  CreatePostInput,
  UpdatePostInput,
  PostQuerySchema,
  PostParamsSchema,
  PostSchema,
} from '../schemas'

const app = new Hono()
  .get('/',
    zValidator('query', PostQuerySchema),
    /**
     * List all posts.
     * @description Returns a paginated list of blog posts with optional filtering
     *   by publication status, author, and full-text search across title and content.
     *   Posts are ordered by creation date (newest first).
     * @tags Posts
     * @summary List posts
     */
    async (c) => {
      const { status, authorId, search, limit, cursor } = c.req.valid('query')
      const posts: z.infer<typeof PostSchema>[] = []
      const nextCursor = posts.length > limit ? posts.pop()?.id ?? null : null
      return c.json({ data: posts, total: posts.length, cursor: nextCursor }, 200)
    }
  )
  .get('/:id',
    zValidator('param', PostParamsSchema),
    /**
     * Get a single post by ID.
     * @description Returns the full post content (markdown body), metadata,
     *   author information, and view count. Increments the view counter on access.
     * @tags Posts
     * @summary Get post by ID
     * @error 404
     */
    async (c) => {
      const { id } = c.req.valid('param')
      const post = {
        id, title: 'Sample Post', slug: 'sample-post', content: '# Hello',
        excerpt: null, status: 'published' as const, authorId: 'author-id',
        viewCount: 42, publishedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
      } satisfies z.infer<typeof PostSchema>
      if (!post) throw new ApiError(ErrorCode.POST_NOT_FOUND, `Post ${id} not found`)
      return c.json(post, 200)
    }
  )
  .post('/',
    zValidator('json', CreatePostInput),
    /**
     * Create a new post.
     * @description Creates a blog post with the authenticated user as the author.
     *   Supports draft and published statuses. Published posts get an automatic
     *   publication timestamp. Slugs must be unique across all posts.
     * @tags Posts
     * @summary Create post
     * @error 409
     */
    async (c) => {
      const body = c.req.valid('json')
      const user = c.get('user')
      if (!user) throw ApiError.notAuthenticated('Sign in to create posts')
      const post = {
        id: 'new-post-id', ...body, excerpt: body.excerpt ?? null,
        authorId: user.id, viewCount: 0,
        publishedAt: body.status === 'published' ? new Date() : null,
        createdAt: new Date(), updatedAt: new Date(),
      }
      return c.json(post, 201)
    }
  )
  .patch('/:id',
    zValidator('param', PostParamsSchema),
    zValidator('json', UpdatePostInput),
    /**
     * Update an existing post.
     * @description Partially updates a post. Only the author or an admin can
     *   modify a post. Updating status to "published" sets the publication date
     *   if it was not previously published.
     * @tags Posts
     * @summary Update post
     * @error 404, 403
     */
    async (c) => {
      const { id } = c.req.valid('param')
      const body = c.req.valid('json')
      const user = c.get('user')
      if (!user) throw ApiError.notAuthenticated()
      const post = { id, authorId: user.id }
      if (!post) throw new ApiError(ErrorCode.POST_NOT_FOUND, `Post ${id} not found`)
      if (post.authorId !== user.id) throw ApiError.insufficientPermissions()
      return c.json({ id, ...body, updatedAt: new Date() }, 200)
    }
  )
  .delete('/:id',
    zValidator('param', PostParamsSchema),
    /**
     * Delete a post.
     * @description Permanently removes a blog post and all associated metadata
     *   (view counts, comments, etc.). Only the author or an admin can delete.
     *   This action cannot be undone.
     * @tags Posts
     * @summary Delete post
     * @error 404, 403
     */
    async (c) => {
      const { id } = c.req.valid('param')
      const user = c.get('user')
      if (!user) throw ApiError.notAuthenticated()
      return c.json({ success: true }, 200)
    }
  )

export default app
