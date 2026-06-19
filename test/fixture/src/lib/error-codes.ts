/**
 * Centralized Error Code Registry — Single Source of Truth.
 *
 * Prefix convention (Stripe-style):
 *   AUTH_     — Authentication / authorization errors
 *   USER_     — User resource errors
 *   POST_     — Post resource errors
 *   VALIDATION_ — Input validation errors
 *   INTERNAL_ — Server errors
 */
export const ErrorCode = {
  // ── Auth ──
  AUTH_INVALID_CREDENTIALS: 'auth_invalid_credentials',
  AUTH_TOKEN_EXPIRED: 'auth_token_expired',
  AUTH_INSUFFICIENT_PERMISSIONS: 'auth_insufficient_permissions',
  AUTH_NOT_AUTHENTICATED: 'auth_not_authenticated',

  // ── User ──
  USER_NOT_FOUND: 'user_not_found',
  USER_EMAIL_ALREADY_EXISTS: 'user_email_already_exists',

  // ── Post ──
  POST_NOT_FOUND: 'post_not_found',
  POST_SLUG_ALREADY_EXISTS: 'post_slug_already_exists',

  // ── Validation ──
  VALIDATION_INVALID_INPUT: 'validation_invalid_input',
  VALIDATION_MISSING_FIELD: 'validation_missing_field',

  // ── Internal ──
  INTERNAL_SERVER_ERROR: 'internal_server_error',
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

/**
 * Broad error categories — maps to HTTP status ranges.
 */
export type ErrorType =
  | 'authentication_error'
  | 'authorization_error'
  | 'validation_error'
  | 'not_found_error'
  | 'conflict_error'
  | 'internal_server_error'

/**
 * Every error code maps to an HTTP status and a broad error type.
 * Add new codes here — the ApiError class reads this map automatically.
 */
export const ErrorCodeMap: Record<ErrorCode, { status: number; type: ErrorType }> = {
  [ErrorCode.AUTH_INVALID_CREDENTIALS]: { status: 401, type: 'authentication_error' },
  [ErrorCode.AUTH_TOKEN_EXPIRED]: { status: 401, type: 'authentication_error' },
  [ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS]: { status: 403, type: 'authorization_error' },
  [ErrorCode.AUTH_NOT_AUTHENTICATED]: { status: 401, type: 'authentication_error' },

  [ErrorCode.USER_NOT_FOUND]: { status: 404, type: 'not_found_error' },
  [ErrorCode.USER_EMAIL_ALREADY_EXISTS]: { status: 409, type: 'conflict_error' },

  [ErrorCode.POST_NOT_FOUND]: { status: 404, type: 'not_found_error' },
  [ErrorCode.POST_SLUG_ALREADY_EXISTS]: { status: 409, type: 'conflict_error' },

  [ErrorCode.VALIDATION_INVALID_INPUT]: { status: 400, type: 'validation_error' },
  [ErrorCode.VALIDATION_MISSING_FIELD]: { status: 400, type: 'validation_error' },

  [ErrorCode.INTERNAL_SERVER_ERROR]: { status: 500, type: 'internal_server_error' },
}
