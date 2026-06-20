import type { RouteInfo, ScanConfig, ResponseInfo, ZodSchemaInfo } from './types'
import { resolveZodSchema } from './zod-schema'
import { findDrizzleTables, drizzleTableToSchema } from './drizzle'
import { zodToJsonSchema } from 'zod-to-json-schema'

const DEFAULT_ERROR_RESPONSES: Record<number, string> = {
  400: 'Validation Error',
  401: 'Unauthorized',
  404: 'Not Found',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
}

interface OpenAPISpec {
  openapi: string
  info: {
    title: string
    version: string
    description?: string
  }
  servers?: Array<{ url: string; description?: string }>
  tags?: Array<{ name: string; description?: string }>
  paths: Record<string, Record<string, any>>
  components?: {
    schemas?: Record<string, any>
    securitySchemes?: Record<string, any>
  }
  security?: Array<Record<string, string[]>>
}

/** Default RFC 9457-style error schema */
function buildDefaultErrorSchema(): Record<string, any> {
  return {
    type: 'object',
    required: ['code', 'message'],
    properties: {
      code: {
        type: 'string',
        description: 'Machine-readable error code. Stable across versions. SCREAMING_SNAKE_CASE.',
        example: 'RESOURCE_NOT_FOUND',
      },
      message: {
        type: 'string',
        description: 'Human-readable error message',
        example: 'No resource exists with the given ID',
      },
      status: {
        type: 'integer',
        description: 'HTTP status code (mirrored for convenience)',
        example: 404,
      },
      details: {
        type: 'array',
        description: 'Field-level validation errors (when applicable)',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string', description: 'Path to the invalid field', example: 'body.email' },
            message: { type: 'string', description: "What's wrong with this field", example: 'Invalid email format' },
            code: { type: 'string', description: 'Machine-readable validation code', example: 'INVALID_FORMAT' },
          },
        },
      },
    },
  }
}

export function assembleSpec(routes: RouteInfo[], config: ScanConfig, files?: any[], authScopes?: any[]): OpenAPISpec {
  const paths: Record<string, Record<string, any>> = {}

  const visibleRoutes = routes.filter(r => !r.hidden)

  // Phase 1: Collect all referenced Zod schemas (from middleware + @returns)
  const resolvedSchemas = new Map<string, ZodSchemaInfo>()

  // Pre-populate with ALL exported Zod schemas from reachable files
  // so that $ref cross-referencing works between schemas
  for (const file of (files || [])) {
    // Skip node_modules type definitions
    if (file.getFilePath().includes('node_modules')) continue
    try {
      file.forEachDescendant((node: any) => {
        if (node.getKindName() === 'VariableDeclaration') {
          const name = node.getName?.()
          if (name && !resolvedSchemas.has(name)) {
            const initText = node.getInitializer?.()?.getText?.() || ''
            if (initText.includes('z.object') || initText.includes('z.enum') || initText.includes('z.array')) {
              resolvedSchemas.set(name, {
                name, exportName: name,
                sourceFile: file.getFilePath(),
                schema: { _ref: name } as any,
                isExported: true,
              })
            }
          }
        }
      })
    } catch { /* skip */ }
  }

  for (const route of visibleRoutes) {
    for (const mw of route.middleware) {
      if (mw.schema?.exportName && mw.schema.isExported && mw.schema.sourceFile) {
        if (!resolvedSchemas.has(mw.schema.exportName)) {
          resolvedSchemas.set(mw.schema.exportName, mw.schema)
        }
      }
    }
    // Also collect from JSDoc @returns
    if (route.jsdoc.returns) {
      const returnsName = route.jsdoc.returns.replace(/[{}]/g, '').trim()
      if (returnsName && !resolvedSchemas.has(returnsName)) {
        // Try to find this schema export in the source files
        const found = findExportedSchema(returnsName, files || [])
        if (found) {
          resolvedSchemas.set(returnsName, found)
        }
      }
    }
    // Also collect from JSDoc @error (no schema names anymore — uses config-level errorSchema)
    for (const err of route.jsdoc.errors) {
      // Status codes are handled inline in responses, no schema collection needed
    }
  }

  // Phase 2: Build schemas (resolve Zod → JSON Schema)
  const schemas: Record<string, any> = {}

  if (config.defaultErrorResponses !== false) {
    if (config.errorSchema) {
      // User passed a Zod object or plain JSON schema — use it directly
      const errSchema = config.errorSchema as Record<string, any>
      // If it looks like a Zod schema (has _def), convert to JSON Schema
      if (typeof (errSchema as any)._def !== 'undefined' || typeof (errSchema as any).parse === 'function') {
        try {
          const converted = zodToJsonSchema(errSchema as any, { target: 'openApi3' }) as Record<string, any>
          schemas.Error = converted
        } catch {
          // Fallback to built-in on conversion error
          schemas.Error = buildDefaultErrorSchema()
        }
      } else {
        // Plain JSON schema — use as-is
        schemas.Error = errSchema
      }
    } else {
      schemas.Error = buildDefaultErrorSchema()
    }
  }

  for (const [name, info] of resolvedSchemas) {
    const knownNames = new Set(resolvedSchemas.keys())
    const resolved = resolveZodSchema(info, files || [], knownNames)
    if (resolved && (Object.keys(resolved.properties || {}).length > 0 || resolved.$ref)) {
      schemas[name] = resolved
    } else {
      schemas[name] = {
        type: 'object',
        description: `Schema: ${name}`,
      }
    }
  }

  // Register Drizzle tables as schemas
  // Two-pass: first detect which tables response shapes reference, then register
  if (files && files.length > 0) {
    const drizzleTables = findDrizzleTables(files)
    
    // Pass 1: check response inline schemas against all Drizzle tables
    const matchedDrizzle = new Set<string>()
    for (const [name, table] of drizzleTables) {
      // Shape match: check if any response inline schema matches this table
      const tableSchema = drizzleTableToSchema(table)
      for (const route of visibleRoutes) {
        if (route.handler?.responses) {
          for (const resp of route.handler.responses) {
            if (resp.schema && !resp.schema.$ref && resp.schema.properties) {
              if (schemaPropertiesMatch(resp.schema.properties, tableSchema.properties || {})) {
                matchedDrizzle.add(name)
              }
            }
          }
        }
      }
    }
    
    // Register matched tables
    for (const [name, table] of drizzleTables) {
      if (matchedDrizzle.has(name)) {
        const pascalName = name.charAt(0).toUpperCase() + name.slice(1)
        if (!schemas[pascalName]) {
          schemas[pascalName] = drizzleTableToSchema(table)
        }
      }
    }
  }

  // Phase 2b: Transitive resolution — resolve schemas referenced via $ref
  let changed = true
  while (changed) {
    changed = false
    for (const schema of Object.values(schemas)) {
      const refs = findRefs(schema as Record<string, any>)
      for (const refName of refs) {
        if (!schemas[refName] && !resolvedSchemas.has(refName)) {
          const found = findExportedSchema(refName, files || [])
          if (found) {
            resolvedSchemas.set(refName, found)
            const knownNames = new Set(resolvedSchemas.keys())
            const resolved = resolveZodSchema(found, files || [], knownNames)
            if (resolved && (Object.keys(resolved.properties || {}).length > 0 || resolved.$ref)) {
              schemas[refName] = resolved
              changed = true
            }
          }
        }
      }
    }
  }

  // Phase 2c: Auto-generate examples for fields missing them
  for (const schema of Object.values(schemas)) {
    if (typeof schema !== 'object' || !schema) continue
    const s = schema as Record<string, any>
    if (s.properties) {
      for (const prop of Object.values(s.properties) as any[]) {
        if (prop && typeof prop === 'object' && prop.example === undefined && !prop.$ref) {
          prop.example = inferExample(prop)
        }
      }
    }
  }

  // Phase 2d: Normalize response schemas — replace inline schemas that match
  // component schemas with $ref. This catches Drizzle table types resolved via
  // `as typeof table.$inferSelect` where ts-morph produces anonymous types.
  normalizeResponseRefs(visibleRoutes, schemas)

  // Phase 3: Build routes (now schemas are available for parameter expansion)
  for (const route of visibleRoutes) {
    const pathKey = route.path

    if (!paths[pathKey]) {
      paths[pathKey] = {}
    }

    const methodKey = route.method.toLowerCase()
    const operation: Record<string, any> = {}

    if (route.tags.length > 0) operation.tags = route.tags
    if (route.summary) operation.summary = route.summary
    if (route.description) operation.description = route.description
    if (route.operationId) operation.operationId = route.operationId
    if (route.deprecated) operation.deprecated = true

    // Parameters
    const params = buildParameters(route, schemas)
    if (params.length > 0) operation.parameters = params

    // Request body
    const requestBody = buildRequestBody(route, schemas)
    if (requestBody) operation.requestBody = requestBody

    // Responses
    operation.responses = buildResponses(route, config, authScopes)

    // Security
    const isAuth = isRouteAuthenticated(route, config, authScopes)
    if (isAuth && !route.jsdoc.isPublic) {
      operation.security = config.security && config.security.length > 0
        ? config.security
        : [{ bearerAuth: [] }]
    }
    if (route.security) {
      // Validate @security references against config.securitySchemes
      const definedSchemes = config.securitySchemes ? Object.keys(config.securitySchemes) : []
      for (const secEntry of route.security) {
        for (const schemeName of Object.keys(secEntry)) {
          if (definedSchemes.length > 0 && !definedSchemes.includes(schemeName)) {
            console.warn(`Warning: @security references "${schemeName}" on ${route.method} ${route.path}, but "${schemeName}" is not defined in config.securitySchemes`)
          }
        }
      }
      operation.security = route.security
    }

    paths[pathKey][methodKey] = operation
  }

  // Build components
  const components: OpenAPISpec['components'] = {}

  if (config.securitySchemes && Object.keys(config.securitySchemes).length > 0) {
    components.securitySchemes = config.securitySchemes
  }

  if (Object.keys(schemas).length > 0) {
    components.schemas = schemas
  }

  const spec: OpenAPISpec = {
    openapi: config.openapi || '3.1.0',
    info: {
      title: config.info?.title || 'API',
      version: config.info?.version || '0.0.0',
    },
    paths,
  }

  if (config.info?.description) spec.info.description = config.info.description
  if (config.servers) spec.servers = config.servers
  if (config.tags) spec.tags = config.tags
  if (Object.keys(components).length > 0) spec.components = components
  if (config.security && config.security.length > 0) spec.security = config.security

  return spec
}

function buildParameters(route: RouteInfo, schemasCache: Record<string, any>): any[] {
  const params: any[] = []

  // Path parameters from route path, with schema from zValidator('param')
  const pathParamMatches = route.path.match(/\{(\w+)\}/g)
  if (pathParamMatches) {
    // Try to get schema from zValidator('param')
    const paramMw = route.middleware.find(
      m => m.type === 'zValidator' && m.target === 'param' && m.schema?.exportName
    )
    let paramProperties: Record<string, any> = {}
    if (paramMw?.schema?.exportName) {
      const resolved = schemasCache[paramMw.schema.exportName]
      if (resolved?.properties) {
        paramProperties = resolved.properties
      }
    }

    for (const match of pathParamMatches) {
      const name = match.slice(1, -1)
      const propSchema = paramProperties[name] || { type: 'string' }
      params.push({
        name,
        in: 'path',
        required: true,
        schema: propSchema,
        description: propSchema.description,
      })
    }
  }

  // Query parameters from zValidator middleware — expand individual properties
  for (const mw of route.middleware) {
    if (mw.type === 'zValidator' && mw.target === 'query' && mw.schema?.exportName) {
      // Try to get resolved schema for expansion
      const schemaName = mw.schema.exportName
      const resolved = schemasCache[schemaName]
      if (resolved?.properties) {
        for (const [propName, propSchema] of Object.entries(resolved.properties)) {
          const required = resolved.required?.includes(propName) || false
          params.push({
            name: propName,
            in: 'query',
            required,
            schema: propSchema,
            description: (propSchema as any).description,
          })
        }
      } else {
        // Fallback: single $ref
        params.push({
          name: 'query',
          in: 'query',
          required: false,
          schema: { $ref: `#/components/schemas/${schemaName}` },
        })
      }
    }
    if (mw.type === 'zValidator' && mw.target === 'header' && mw.schema?.exportName) {
      // Expand individual header properties from schema
      const schemaName = mw.schema.exportName
      const resolved = schemasCache[schemaName]
      if (resolved?.properties) {
        for (const [propName, propSchema] of Object.entries(resolved.properties)) {
          const required = resolved.required?.includes(propName) || false
          params.push({
            name: propName,
            in: 'header',
            required,
            schema: propSchema,
            description: (propSchema as any).description,
          })
        }
      } else {
        params.push({
          name: 'header',
          in: 'header',
          required: false,
          schema: { $ref: `#/components/schemas/${schemaName}` },
          description: 'Request headers',
        })
      }
    }
    if (mw.type === 'zValidator' && mw.target === 'cookie' && mw.schema?.exportName) {
      // Expand individual cookie properties from schema
      const schemaName = mw.schema.exportName
      const resolved = schemasCache[schemaName]
      if (resolved?.properties) {
        for (const [propName, propSchema] of Object.entries(resolved.properties)) {
          const required = resolved.required?.includes(propName) || false
          params.push({
            name: propName,
            in: 'cookie',
            required,
            schema: propSchema,
            description: (propSchema as any).description,
          })
        }
      } else {
        params.push({
          name: 'cookie',
          in: 'cookie',
          required: false,
          schema: { $ref: `#/components/schemas/${schemaName}` },
        })
      }
    }
  }

  return params
}

function buildRequestBody(route: RouteInfo, schemasCache: Record<string, any>): any {
  const bodyMw = route.middleware.find(
    m => m.type === 'zValidator' && (m.target === 'json' || m.target === 'form')
  )

  if (!bodyMw) return undefined

  const contentType = bodyMw.target === 'form' ? 'multipart/form-data' : 'application/json'

  let schema: any = { type: 'object' }
  if (bodyMw.schema?.exportName) {
    const resolved = schemasCache[bodyMw.schema.exportName]
    if (resolved && resolved.properties) {
      // Clone and mark all properties writeOnly for input schemas
      schema = JSON.parse(JSON.stringify(resolved))
      for (const prop of Object.values(schema.properties) as any[]) {
        if (prop && typeof prop === 'object') prop.writeOnly = true
      }
    } else {
      schema = { $ref: `#/components/schemas/${bodyMw.schema.exportName}` }
    }
  }

  return {
    required: true,
    content: {
      [contentType]: { schema },
    },
  }
}

function buildResponses(route: RouteInfo, config: ScanConfig, authScopes?: any[]): Record<string, any> {
  const responses: Record<string, any> = {}

  // Add detected responses from handler
  if (route.handler?.responses) {
    for (const resp of route.handler.responses) {
      const key = String(resp.status)
      if (!responses[key]) {
        let respWithSchema = { ...resp }

        // Priority 1: c.json() data type resolved via ts-morph (already in resp.schema from routes.ts)
        // Priority 2: JSDoc @returns (overrides if no c.json schema)
        if (!respWithSchema.schema && route.jsdoc.returns && (resp.status === 200 || resp.status === 201)) {
          const returnsName = route.jsdoc.returns.replace(/[{}]/g, '').trim()
          if (returnsName) {
            respWithSchema.schema = { $ref: `#/components/schemas/${returnsName}` }
          }
        }

        responses[key] = buildSingleResponse(respWithSchema)
      }
    }
  }

  // Add default error responses
  if (config.defaultErrorResponses !== false) {
    const errorStatuses = Array.isArray(config.defaultErrorResponses)
      ? config.defaultErrorResponses
      : Object.keys(DEFAULT_ERROR_RESPONSES).map(Number)

    for (const status of errorStatuses) {
      const key = String(status)
      if (responses[key]) continue

      // Only add 400 if route has request body or params
      if (status === 400) {
        const hasBody = route.middleware.some(m => m.type === 'zValidator' && (m.target === 'json' || m.target === 'form'))
        const hasParams = route.middleware.some(m => m.type === 'zValidator' && m.target === 'param')
        if (!hasBody && !hasParams) continue
      }

      // Only add 401 if route is authenticated
      if (status === 401) {
        if (!isRouteAuthenticated(route, config, authScopes)) continue
      }

      // Only add 404 if path has parameters
      if (status === 404) {
        if (!route.path.includes('{')) continue
      }

      responses[key] = {
        description: DEFAULT_ERROR_RESPONSES[status] || 'Error',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      }
    }
  }

  // Add custom errors from JSDoc (override defaults with same Error schema)
  for (const err of route.jsdoc.errors) {
    const key = String(err.status)
    responses[key] = {
      description: getStatusDescription(err.status),
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/Error' },
        },
      },
    }
  }

  return responses
}

function buildSingleResponse(resp: ResponseInfo): Record<string, any> {
  const obj: Record<string, any> = {
    description: resp.description,
  }

  // Always include content for JSON responses (with schema if available)
  // For non-JSON, include content with content-type (no schema needed)
  if (resp.schema) {
    obj.content = {
      [resp.contentType]: {
        schema: resp.schema,
      },
    }
  } else if (resp.contentType !== 'application/json') {
    // Non-JSON types still need content declaration (text/plain, application/octet-stream, etc.)
    obj.content = {
      [resp.contentType]: {},
    }
  }

  return obj
}

/**
 * Check if a route is authenticated based on auth scopes and config.
 */
function isRouteAuthenticated(route: RouteInfo, config: ScanConfig, authScopes?: any[]): boolean {
  // Explicit @public → not authenticated
  if (route.jsdoc.isPublic) return false

  // Explicit @security → authenticated
  if (route.jsdoc.security && route.jsdoc.security.length > 0) return true

  // Global security config
  if (config.security && config.security.length > 0) return true

  // Auth middleware scopes
  if (authScopes && authScopes.length > 0) {
    for (const scope of authScopes) {
      if (scope.isAuth && matchesGlob(route.fullPath, scope.pathPattern)) {
        return true
      }
    }
  }

  return false
}

/**
 * Simple glob matching: * matches anything, /api/* matches /api/...
 */
function matchesGlob(path: string, pattern: string): boolean {
  if (pattern === '*') return true
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
  return regex.test(path)
}

/**
 * Walk all route response schemas and replace inline object schemas that match
 * component schemas with $ref. Handles ts-morph anonymous types from Drizzle `as` assertions.
 */
function normalizeResponseRefs(routes: RouteInfo[], schemas: Record<string, any>): void {
  for (const route of routes) {
    if (route.handler?.responses) {
      for (const resp of route.handler.responses) {
        if (resp.schema && !resp.schema.$ref && resp.schema.properties) {
          const matched = findMatchingSchemaRef(resp.schema, schemas, route)
          if (matched) {
            resp.schema = { $ref: `#/components/schemas/${matched}` }
          }
        }
      }
    }
  }
}

/**
 * Check if two sets of schema properties match (same keys).
 */
function schemaPropertiesMatch(a: Record<string, any>, b: Record<string, any>): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length === 0 || bKeys.length === 0) return false
  if (aKeys.length > bKeys.length) return schemaPropertiesMatch(b, a)
  return aKeys.every(k => bKeys.includes(k))
}

/**
 * Check if an inline object schema matches a component schema by property names.
 * Returns the component schema name if matched, null otherwise.
 */
function findMatchingSchemaRef(inline: Record<string, any>, schemas: Record<string, any>, route?: RouteInfo): string | null {
  if (!inline.properties || typeof inline.properties !== 'object') return null

  const inlineKeys = new Set(Object.keys(inline.properties))
  if (inlineKeys.size === 0) return null

  // Build context hints from route path/tags for disambiguation
  const contextWords = new Set<string>()
  if (route) {
    for (const tag of route.tags) {
      const t = tag.toLowerCase()
      contextWords.add(t)
      // Also add singular form (strip trailing 's')
      if (t.endsWith('s')) contextWords.add(t.slice(0, -1))
    }
    const pathSegs = route.path.replace(/[{}]/g, '').split('/').filter(Boolean)
    for (const seg of pathSegs) {
      const s = seg.toLowerCase()
      contextWords.add(s)
      if (s.endsWith('s')) contextWords.add(s.slice(0, -1))
    }
  }

  let bestMatch: string | null = null
  let bestScore = 0
  let bestContextBonus = 0

  for (const [name, schema] of Object.entries(schemas)) {
    if (!schema.properties || typeof schema.properties !== 'object') continue
    if (name === 'Error') continue // Don't replace with error schema

    const schemaKeys = new Set(Object.keys(schema.properties))
    if (schemaKeys.size === 0) continue

    // Calculate match score: intersection / union (Jaccard)
    let intersection = 0
    for (const k of inlineKeys) {
      if (schemaKeys.has(k)) intersection++
    }
    const union = new Set([...inlineKeys, ...schemaKeys]).size
    const score = intersection / union

    // Context bonus: schema name shares words with route path/tags
    let contextBonus = 0
    for (const word of contextWords) {
      if (name.toLowerCase().includes(word)) contextBonus += 0.1
    }

    const effectiveScore = score + contextBonus

    // Exact match with context tiebreak — prefer higher effectiveScore
    if (score === 1.0 && inlineKeys.size === schemaKeys.size) {
      if (effectiveScore > bestScore + bestContextBonus || bestMatch === null) {
        bestScore = score
        bestContextBonus = contextBonus
        bestMatch = name
      }
      continue
    }

    // Near match (at least 80% overlap, and inline is subset of schema)
    if (effectiveScore >= 0.8 && inlineKeys.size <= schemaKeys.size && effectiveScore > bestScore + bestContextBonus) {
      bestScore = score
      bestContextBonus = contextBonus
      bestMatch = name
    }
  }

  // Only match if inline has at least 2 properties and score >= 0.8
  if (bestMatch && inlineKeys.size >= 2 && bestScore >= 0.8) {
    return bestMatch
  }

  return null
}

/**
 * Recursively find all \$ref target names in a schema object.
 */
function findRefs(schema: Record<string, any>, found: Set<string> = new Set()): Set<string> {
  if (!schema || typeof schema !== 'object') return found
  if (schema.$ref) {
    const name = (schema.$ref as string).replace('#/components/schemas/', '')
    found.add(name)
  }
  for (const value of Object.values(schema)) {
    if (typeof value === 'object' && value !== null) {
      findRefs(value, found)
    }
  }
  return found
}

/**
 * Find an exported Zod schema by name across all reachable source files.
 */
function findExportedSchema(name: string, files: any[]): ZodSchemaInfo | null {
  for (const file of files) {
    let found: ZodSchemaInfo | null = null
    try {
      file.forEachDescendant((node: any) => {
        if (found) return
        if (node.getKindName() === 'VariableDeclaration') {
          if (node.getName?.() === name) {
            // Check if it's exported
            const parent = node.getParent?.()?.getParent?.()
            const isExported = parent?.getKindName?.() === 'VariableStatement' &&
              parent?.isExported?.()
            if (isExported || true) { // Accept even non-exported for now
              found = {
                name,
                exportName: name,
                sourceFile: file.getFilePath(),
                schema: { _ref: name } as any,
                isExported: true,
              }
            }
          }
        }
      })
    } catch {
      // Skip files that cause traversal errors
    }
    if (found) return found
  }
  return null
}

/** Auto-generate example from schema type/format/default */
function inferExample(prop: Record<string, any>): any {
  if (prop.default !== undefined) return prop.default
  if (prop.enum && prop.enum.length > 0) return prop.enum[0]
  const format = prop.format
  if (format === 'uuid') return '550e8400-e29b-41d4-a716-446655440000'
  if (format === 'date-time') return '2026-01-15T10:30:00Z'
  if (format === 'email') return 'user@example.com'
  if (format === 'uri') return 'https://example.com'
  const type = Array.isArray(prop.type) ? prop.type.find((t: string) => t !== 'null') : prop.type
  if (type === 'integer') return 42
  if (type === 'number') return 3.14
  if (type === 'boolean') return true
  return 'string'
}

function getStatusDescription(status: number): string {
  const descriptions: Record<number, string> = {
    200: 'OK', 201: 'Created', 204: 'No Content',
    400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
    404: 'Not Found', 409: 'Conflict', 422: 'Unprocessable Entity',
    429: 'Too Many Requests', 500: 'Internal Server Error',
  }
  return descriptions[status] || 'Response'
}
