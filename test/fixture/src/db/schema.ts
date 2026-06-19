import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  pgEnum,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const roleEnum = pgEnum('role', ['admin', 'user', 'moderator'])

export const postStatusEnum = pgEnum('post_status', ['draft', 'published', 'archived'])

export const users = pgTable(
  'users',
  {
    // Unique identifier for the user
    id: uuid('id').defaultRandom().primaryKey(),
    // Display name shown in the UI
    name: text('name').notNull(),
    // Email address used for login and notifications
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').default(false).notNull(),
    // URL to the user's avatar image
    image: text('image'),
    role: roleEnum('role').default('user').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('email_idx').on(table.email)]
)

export const posts = pgTable('posts', {
  // Unique identifier for the post
  id: uuid('id').defaultRandom().primaryKey(),
  // Post title displayed in listings and detail pages
  title: text('title').notNull(),
  // URL-friendly unique slug for SEO
  slug: text('slug').notNull().unique(),
  // Full post body in markdown format
  content: text('content').notNull(),
  excerpt: text('excerpt'),
  status: postStatusEnum('status').default('draft').notNull(),
  authorId: uuid('author_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  viewCount: integer('view_count').default(0).notNull(),
  publishedAt: timestamp('published_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Better Auth required tables (auto-detected, not added to OpenAPI schemas)
export const account = pgTable('account', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  providerId: text('provider_id').notNull(),
  accountId: text('account_id').notNull(),
  refreshToken: text('refresh_token'),
  accessToken: text('access_token'),
})

export const session = pgTable('session', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  token: text('token').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
