import { describe, test, expect } from 'bun:test'
import { assembleSpec } from '../../src/assemble'
import type { RouteInfo, ScanConfig } from '../../src/types'

function makeRoute(overrides: Partial<RouteInfo>): RouteInfo {
  return {
    method: 'GET',
    path: '/users',
    fullPath: '/users',
    middleware: [],
    handler: { responses: [{ status: 200, description: 'OK', contentType: 'application/json' }], sourceFile: '' },
    jsdoc: { tags: [], isPublic: false, deprecated: false, hidden: false, errors: [], params: [] },
    tags: ['Users'],
    operationId: 'getUsers',
    summary: 'List users',
    sourceFile: '',
    ...overrides,
  }
}

const baseConfig: ScanConfig = {
  entry: 'src/index.ts',
  output: 'openapi.json',
  info: { title: 'Test API', version: '1.0.0' },
  openapi: '3.1.0',
  defaultErrorResponses: true,
  operationId: 'default',
}

describe('assembleSpec', () => {
  test('generates basic spec structure', () => {
    const spec = assembleSpec([makeRoute({})], baseConfig)
    expect(spec.openapi).toBe('3.1.0')
    expect(spec.info.title).toBe('Test API')
    expect(spec.paths['/users']).toBeDefined()
    expect(spec.paths['/users']!.get).toBeDefined()
  })

  test('includes tags from route', () => {
    const spec = assembleSpec([makeRoute({ tags: ['Users'] })], baseConfig)
    expect(spec.paths['/users']!.get!.tags).toEqual(['Users'])
  })

  test('includes summary', () => {
    const spec = assembleSpec([makeRoute({ summary: 'List all users' })], baseConfig)
    expect(spec.paths['/users']!.get!.summary).toBe('List all users')
  })

  test('includes description from jsdoc', () => {
    const spec = assembleSpec([makeRoute({ description: 'Returns paginated users' })], baseConfig)
    expect(spec.paths['/users']!.get!.description).toBe('Returns paginated users')
  })

  test('includes operationId', () => {
    const spec = assembleSpec([makeRoute({ operationId: 'listUsers' })], baseConfig)
    expect(spec.paths['/users']!.get!.operationId).toBe('listUsers')
  })

  test('marks deprecated routes', () => {
    const spec = assembleSpec([makeRoute({ deprecated: true })], baseConfig)
    expect(spec.paths['/users']!.get!.deprecated).toBe(true)
  })

  test('filters hidden routes', () => {
    const spec = assembleSpec([makeRoute({ hidden: true })], baseConfig)
    expect(spec.paths['/users']).toBeUndefined()
  })

  test('adds path parameters', () => {
    const route = makeRoute({ path: '/users/{id}', fullPath: '/users/{id}' })
    const spec = assembleSpec([route], baseConfig)
    const params = spec.paths['/users/{id}']!.get!.parameters
    expect(params).toBeDefined()
    expect(params!.length).toBe(1)
    expect(params![0]!.name).toBe('id')
    expect(params![0]!.in).toBe('path')
  })

  test('adds request body from json middleware', () => {
    const route = makeRoute({
      method: 'POST',
      middleware: [{
        type: 'zValidator',
        target: 'json',
        schema: { name: 'CreateUser', exportName: 'CreateUserInput', sourceFile: '', schema: { _ref: 'CreateUserInput' }, isExported: true },
      }],
    })
    const spec = assembleSpec([route], baseConfig)
    const rb = spec.paths['/users']!.post!.requestBody
    expect(rb).toBeDefined()
    expect(rb!.content['application/json']).toBeDefined()
  })

  test('applies security from config', () => {
    const config = { ...baseConfig, security: [{ bearerAuth: [] }] }
    const spec = assembleSpec([makeRoute({})], config)
    expect(spec.paths['/users']!.get!.security).toEqual([{ bearerAuth: [] }])
  })

  test('@public overrides security', () => {
    const config = { ...baseConfig, security: [{ bearerAuth: [] }] }
    const route = makeRoute({ jsdoc: { ...makeRoute({}).jsdoc, isPublic: true } })
    const spec = assembleSpec([route], config)
    expect(spec.paths['/users']!.get!.security).toBeUndefined()
  })

  test('always includes 500 error', () => {
    const spec = assembleSpec([makeRoute({})], baseConfig)
    const responses = spec.paths['/users']!.get!.responses
    expect(responses['500']).toBeDefined()
  })

  test('always includes 429 error', () => {
    const spec = assembleSpec([makeRoute({})], baseConfig)
    const responses = spec.paths['/users']!.get!.responses
    expect(responses['429']).toBeDefined()
  })

  test('includes 400 when has body', () => {
    const route = makeRoute({
      method: 'POST',
      middleware: [{
        type: 'zValidator',
        target: 'json',
        schema: { name: 'Input', exportName: 'Input', sourceFile: '', schema: {}, isExported: true },
      }],
    })
    const spec = assembleSpec([route], baseConfig)
    expect(spec.paths['/users']!.post!.responses['400']).toBeDefined()
  })

  test('includes 404 when has path params', () => {
    const route = makeRoute({ path: '/users/{id}', fullPath: '/users/{id}' })
    const spec = assembleSpec([route], baseConfig)
    expect(spec.paths['/users/{id}']!.get!.responses['404']).toBeDefined()
  })

  test('includes 401 when authenticated', () => {
    const config = { ...baseConfig, security: [{ bearerAuth: [] }] }
    const spec = assembleSpec([makeRoute({})], config)
    expect(spec.paths['/users']!.get!.responses['401']).toBeDefined()
  })

  test('skips 401 for @public routes', () => {
    const config = { ...baseConfig, security: [{ bearerAuth: [] }] }
    const route = makeRoute({ jsdoc: { ...makeRoute({}).jsdoc, isPublic: true } })
    const spec = assembleSpec([route], config)
    expect(spec.paths['/users']!.get!.responses['401']).toBeUndefined()
  })

  test('includes custom @error responses', () => {
    const route = makeRoute({
      jsdoc: { ...makeRoute({}).jsdoc, errors: [{ status: 403, schema: 'ErrorSchema' }] },
    })
    const spec = assembleSpec([route], baseConfig)
    expect(spec.paths['/users']!.get!.responses['403']).toBeDefined()
  })

  test('includes servers from config', () => {
    const config = {
      ...baseConfig,
      servers: [{ url: 'https://api.example.com', description: 'Production' }],
    }
    const spec = assembleSpec([makeRoute({})], config)
    expect(spec.servers).toEqual([{ url: 'https://api.example.com', description: 'Production' }])
  })

  test('includes security schemes from config', () => {
    const config = {
      ...baseConfig,
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
    }
    const spec = assembleSpec([makeRoute({})], config)
    expect(spec.components!.securitySchemes).toBeDefined()
  })

  test('multiple methods on same path', () => {
    const getRoute = makeRoute({ method: 'GET', path: '/users', operationId: 'getUsers' })
    const postRoute = makeRoute({ method: 'POST', path: '/users', operationId: 'createUser' })
    const spec = assembleSpec([getRoute, postRoute], baseConfig)
    expect(spec.paths['/users']!.get).toBeDefined()
    expect(spec.paths['/users']!.post).toBeDefined()
  })

  test('error schema has correct structure', () => {
    const spec = assembleSpec([makeRoute({})], baseConfig)
    const errorSchema = spec.components!.schemas!.Error as any
    expect(errorSchema.type).toBe('object')
    expect(errorSchema.properties.code).toBeDefined()
    expect(errorSchema.properties.message).toBeDefined()
    expect(errorSchema.properties.details).toBeDefined()
    expect(errorSchema.required).toContain('code')
    expect(errorSchema.required).toContain('message')
  })
})
