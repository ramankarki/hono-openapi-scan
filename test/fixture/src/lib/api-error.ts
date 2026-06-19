import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { type ErrorCode, type ErrorType, ErrorCodeMap } from './error-codes'

/**
 * Stripe-style API error.
 *
 * Throw in any route handler — the global onError handler catches it
 * and formats the JSON response automatically.
 *
 * @example
 *   throw new ApiError(ErrorCode.USER_NOT_FOUND, 'User profile not found')
 *   throw ApiError.notFound('User profile not found')
 *   throw ApiError.invalidCredentials()
 */
export class ApiError extends HTTPException {
  public readonly code: ErrorCode
  public readonly type: ErrorType

  constructor(code: ErrorCode, message?: string) {
    const mapping = ErrorCodeMap[code]
    const status: ContentfulStatusCode = (mapping?.status || 500) as ContentfulStatusCode
    const type: ErrorType = mapping?.type || 'internal_server_error'

    super(status, { message: message || code })
    this.code = code
    this.type = type
    this.name = 'ApiError'
  }

  // ── Convenience factories ──

  static notFound(message?: string) {
    return new ApiError(ErrorCode.USER_NOT_FOUND, message)
  }

  static invalidCredentials(message?: string) {
    return new ApiError(ErrorCode.AUTH_INVALID_CREDENTIALS, message)
  }

  static notAuthenticated(message?: string) {
    return new ApiError(ErrorCode.AUTH_NOT_AUTHENTICATED, message)
  }

  static insufficientPermissions(message?: string) {
    return new ApiError(ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS, message)
  }

  static validationFailed(message?: string) {
    return new ApiError(ErrorCode.VALIDATION_INVALID_INPUT, message)
  }

  static conflict(message?: string) {
    return new ApiError(ErrorCode.USER_EMAIL_ALREADY_EXISTS, message)
  }

  static internal(message?: string) {
    return new ApiError(ErrorCode.INTERNAL_SERVER_ERROR, message)
  }
}
