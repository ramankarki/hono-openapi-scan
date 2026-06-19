import { describe, test, expect } from 'bun:test'
import { parseJSDocRaw } from '../../src/jsdoc'

describe('parseJSDocRaw', () => {
  test('parses @tags', () => {
    const result = parseJSDocRaw('List users\n@tags Users, Admin')
    expect(result.tags).toEqual(['Users', 'Admin'])
  })

  test('parses @public', () => {
    const result = parseJSDocRaw('Health check\n@public')
    expect(result.isPublic).toBe(true)
  })

  test('parses @deprecated', () => {
    const result = parseJSDocRaw('Old endpoint\n@deprecated')
    expect(result.deprecated).toBe(true)
  })

  test('parses @hide', () => {
    const result = parseJSDocRaw('Internal\n@hide')
    expect(result.hidden).toBe(true)
  })

  test('parses @summary', () => {
    const result = parseJSDocRaw('@summary Get all users')
    expect(result.summary).toBe('Get all users')
  })

  test('parses @description', () => {
    const result = parseJSDocRaw('@description Returns a paginated list of users')
    expect(result.description).toBe('Returns a paginated list of users')
  })

  test('parses @operationId', () => {
    const result = parseJSDocRaw('@operationId listAllUsers')
    expect(result.operationId).toBe('listAllUsers')
  })

  test('parses @returns', () => {
    const result = parseJSDocRaw('@returns {AuthResponse}')
    expect(result.returns).toBe('{AuthResponse}')
  })

  test('parses @security', () => {
    const result = parseJSDocRaw('@security {bearerAuth, apiKey}')
    expect(result.security).toEqual(['bearerAuth', 'apiKey'])
  })

  test('parses @error', () => {
    const result = parseJSDocRaw('@error 404')
    expect(result.errors).toEqual([{ status: 404 }])
  })

  test('parses @error with multiple codes', () => {
    const result = parseJSDocRaw('@error 404,403')
    expect(result.errors).toEqual([{ status: 404 }, { status: 403 }])
  })

  test('parses @error none', () => {
    const result = parseJSDocRaw('@error none')
    expect(result.errors).toEqual([])
  })

  test('parses @param', () => {
    const result = parseJSDocRaw('@param id - User unique identifier')
    expect(result.params).toEqual([{ name: 'id', description: 'User unique identifier' }])
  })

  test('parses summary from first sentence', () => {
    const result = parseJSDocRaw('List all users. Returns paginated results.')
    expect(result.summary).toBe('List all users.')
    expect(result.description).toBe('Returns paginated results.')
  })

  test('parses simple summary when no period', () => {
    const result = parseJSDocRaw('List all users with pagination')
    expect(result.summary).toBe('List all users with pagination')
    expect(result.description).toBeUndefined()
  })

  test('handles multi-line body', () => {
    const result = parseJSDocRaw('First sentence. Second sentence.\nThird sentence.')
    expect(result.summary).toBe('First sentence.')
    expect(result.description).toBe('Second sentence. Third sentence.')
  })
})
