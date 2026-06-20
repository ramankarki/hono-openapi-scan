import type { SourceFile } from 'ts-morph'
import type { RouteInfo, MiddlewareInfo, HandlerInfo, ResponseInfo, ZodSchemaInfo, JSDocInfo, SchemaRef } from './types'
import { parseJSDocFromNode } from './jsdoc'
import { resolveExpressionType } from './type-walker'

type AnyNode = any

// Patterns that indicate an auth middleware
const AUTH_PATTERNS = [
  'auth.api.getSession',
  'c.set(\'user\'',
  'c.set(\'session\'',
  'getSession',
]

export interface AppRegistry {
  apps: Map<string, { sourceFile: SourceFile; name: string }>
  sourceFiles: SourceFile[]
  authScopes: AuthScope[]
}

export interface AuthScope {
  pathPattern: string  // e.g., '*', '/api/*', '/public/*'
  isAuth: boolean
  sourceFile: SourceFile
}

export function buildAppRegistry(sourceFiles: SourceFile[]): AppRegistry {
  const apps = new Map<string, { sourceFile: SourceFile; name: string }>()
  const authScopes: AuthScope[] = []

  for (const file of sourceFiles) {
    file.forEachDescendant((node: AnyNode) => {
      if (node.getKindName() !== 'NewExpression') {
        // Detect auth middleware: app.use('*', authMiddleware)
        if (node.getKindName() === 'CallExpression') {
          detectAuthScope(node, file, authScopes)
        }
        return
      }
      const typeName = node.getExpression?.()?.getText?.()
      if (typeName !== 'Hono') return

      const parent = node.getParent()
      let name = 'app'

      if (parent?.getKindName() === 'VariableDeclaration') {
        name = parent.getName?.() || 'app'
      } else if (parent?.getKindName() === 'PropertyAssignment') {
        name = parent.getName?.() || 'app'
      } else if (parent?.getKindName() === 'ExportAssignment') {
        name = 'default'
      }

      const filePath = file.getFilePath()
      // Key: sourceFilePath::variableName to avoid collisions
      apps.set(`${filePath}::${name}`, { sourceFile: file, name })
    })
  }

  return { apps, sourceFiles, authScopes }
}

function detectAuthScope(callExpr: AnyNode, file: SourceFile, scopes: AuthScope[]) {
  const propAccess = callExpr.getExpression?.()
  if (!propAccess || propAccess.getKindName() !== 'PropertyAccessExpression') return
  if (propAccess.getName?.() !== 'use') return

  const args = callExpr.getArguments?.() || []
  if (args.length < 2) return

  const pathPattern = extractStringLiteral(args[0])
  if (!pathPattern) return

  // Check if the middleware is an auth middleware
  const middlewareName = args[1]?.getText?.() || ''
  let isAuth = false

  try {
    const symbol = args[1]?.getSymbol?.()
    if (symbol) {
      const realSymbol = symbol.getAliasedSymbol?.() || symbol
      const decls = realSymbol.getDeclarations?.()
      if (decls && decls.length > 0) {
        const declText = decls[0].getText?.() || ''
        isAuth = AUTH_PATTERNS.some(p => declText.includes(p))
      }
    }
  } catch {
    // Symbol resolution failed, rely on name heuristic
    isAuth = /auth/i.test(middlewareName)
  }

  if (isAuth) {
    scopes.push({ pathPattern, isAuth: true, sourceFile: file })
  }
}

export function walkAppRoutes(
  sourceFile: SourceFile,
  appName: string,
  registry: AppRegistry,
  pathPrefix = '',
  knownSchemas: Set<string> = new Set(),
): RouteInfo[] {
  const routes: RouteInfo[] = []
  const visitedSubApps = new Set<string>()

  sourceFile.forEachDescendant((node: AnyNode) => {
    if (node.getKindName() !== 'CallExpression') return

    const callExpr = node
    const propAccess = callExpr.getExpression()

    if (!propAccess || propAccess.getKindName() !== 'PropertyAccessExpression') return

    const propertyName: string = propAccess.getName()
    const object = propAccess.getExpression()

    const isOnApp = object?.getText() === appName
    const isChainedNew = object?.getKindName() === 'NewExpression' && object?.getExpression()?.getText() === 'Hono'
    const isChained = object?.getKindName() === 'CallExpression'

    if (!isOnApp && !isChainedNew && !isChained) return

    const method = propertyName.toUpperCase()
    const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ON', 'ROUTE', 'USE']

    if (!validMethods.includes(method)) return

    const args: AnyNode[] = callExpr.getArguments() || []

    // Extract JSDoc from the call expression or its ancestor chain
    let callJSDoc: JSDocInfo | null = null
    try {
      callJSDoc = parseJSDocFromNode(callExpr)
      if (!callJSDoc) {
        // Walk up ancestors to find the ExpressionStatement (handles chained calls)
        let ancestor = callExpr.getParent?.()
        while (ancestor && !callJSDoc) {
          callJSDoc = parseJSDocFromNode(ancestor)
          if (ancestor.getKindName() === 'ExpressionStatement') break
          ancestor = ancestor.getParent?.()
        }
      }
    } catch {
      // Ignore
    }

    if (method === 'ROUTE') {
      if (args.length >= 2) {
        const prefix = extractStringLiteral(args[0])
        const subAppName = args[1]?.getText()
        if (prefix && subAppName) {
          const key = `${subAppName}:${prefix}`
          if (visitedSubApps.has(key)) return
          visitedSubApps.add(key)

          // Try to resolve the sub-app name to another Hono instance
          const resolved = resolveSubApp(subAppName, sourceFile, registry)
          if (resolved) {
            const fullPrefix = normalizePath(pathPrefix + prefix)
            const subRoutes = walkAppRoutes(resolved.sourceFile, resolved.name, registry, fullPrefix)
            routes.push(...subRoutes)
          }
        }
      }
      return
    }

    if (method === 'USE') {
      return
    }

    if (method === 'ON') {
      if (args.length >= 2) {
        const methodsArg = args[0]
        const methods = extractMethodList(methodsArg)
        const path = extractStringLiteral(args[1])
        const middlewareAndHandler = args.slice(2)

        for (const m of methods) {
          const route = extractRoute(sourceFile, m, pathPrefix + (path || ''), middlewareAndHandler, callJSDoc, knownSchemas)
          if (route) routes.push(route)
        }
      }
      return
    }

    if (args.length >= 1) {
      const path = extractStringLiteral(args[0])
      const middlewareAndHandler = args.slice(1)

      const route = extractRoute(sourceFile, method, pathPrefix + (path || ''), middlewareAndHandler, callJSDoc, knownSchemas)
      if (route) routes.push(route)
    }
  })

  return routes
}

function resolveSubApp(
  variableName: string,
  sourceFile: SourceFile,
  registry: AppRegistry
): { sourceFile: SourceFile; name: string } | null {
  const filePath = sourceFile.getFilePath()

  // Check if the variable is a local Hono app (defined in the same file)
  const localKey = `${filePath}::${variableName}`
  const local = registry.apps.get(localKey)
  if (local) return local

  // Check if it's imported from another file (default or named)
  const imp = sourceFile.getImportDeclarations().find(id => {
    const defaultImport = id.getDefaultImport()
    if (defaultImport?.getText() === variableName) return true
    const namedImports = id.getNamedImports()
    return namedImports.some(ni => ni.getName() === variableName)
  })

  if (imp) {
    try {
      const resolved = imp.getModuleSpecifierSourceFile()
      if (resolved) {
        const resolvedPath = resolved.getFilePath()

        // Try to find any Hono app in the resolved file
        for (const [key, app] of registry.apps) {
          if (app.sourceFile.getFilePath() === resolvedPath) {
            return app
          }
        }
      }
    } catch {
      // Skip unresolvable imports
    }
  }

  return null
}

function extractRoute(
  sourceFile: SourceFile,
  method: string,
  fullPath: string,
  args: AnyNode[],
  callJSDoc: JSDocInfo | null,
  knownSchemas: Set<string>,
): RouteInfo | null {
  if (!fullPath) return null

  // Normalize path (remove double slashes, trailing slash)
  fullPath = normalizePath(fullPath)

  const middleware: MiddlewareInfo[] = []
  let handler: HandlerInfo | null = null
  let jsdoc: JSDocInfo = {
    tags: [],
    isPublic: false,
    deprecated: false,
    hidden: false,
    errors: [],
    params: [],
  }

  // Priority: handler JSDoc > call expression JSDoc
  let handlerJSDoc: JSDocInfo | null = null

  for (const arg of args) {
    const kind = arg.getKindName()

    if (kind === 'ArrowFunction' || kind === 'FunctionExpression' || kind === 'FunctionDeclaration') {
      handler = extractHandlerInfo(arg, knownSchemas)
      const doc = parseJSDocFromNode(arg)
      if (doc) handlerJSDoc = doc
    } else if (kind === 'Identifier') {
      const name = arg.getText()
      handler = { name, responses: [], sourceFile: sourceFile.getFilePath() }

      const symbol = arg.getSymbol()
      if (symbol) {
        const decls = symbol.getDeclarations()
        if (decls && decls.length > 0) {
          const decl = decls[0]
          if (decl) {
            const doc = parseJSDocFromNode(decl)
            if (doc) handlerJSDoc = doc
            const responses = extractResponsesFromFunction(decl, knownSchemas, middleware)
            if (responses.length > 0) handler.responses = responses
          }
        }
      }
    } else if (kind === 'CallExpression') {
      const mw = extractMiddleware(arg)
      if (mw) middleware.push(mw)
    }
  }

  // Merge JSDoc: handler takes priority, then call expression
  if (handlerJSDoc) {
    jsdoc = handlerJSDoc
  } else if (callJSDoc) {
    jsdoc = callJSDoc
  }

  // If handler is inline and we haven't extracted responses yet
  if (handler && handler.responses.length === 0 && args.length > 0) {
    const lastArg = args[args.length - 1]
    if (lastArg) {
      const responses = extractResponsesFromFunction(lastArg, knownSchemas, middleware)
      handler.responses = responses
    }
  }



  // Convert path to OpenAPI format: /:id → /{id}
  const openApiPath = extractPathParams(fullPath)

  // Auto-generate from OpenAPI path (not raw path)
  if (!jsdoc.summary) {
    jsdoc.summary = generateSummary(method, openApiPath)
  }

  if (jsdoc.tags.length === 0) {
    jsdoc.tags = generateTags(openApiPath)
  }

  if (!jsdoc.operationId) {
    jsdoc.operationId = generateOperationId(method, openApiPath)
  }

  // Build explicit per-route security from @security JSDoc annotations
  let routeSecurity: Array<Record<string, string[]>> | undefined
  if (jsdoc.security && jsdoc.security.length > 0) {
    routeSecurity = jsdoc.security.map((s: string) => ({ [s]: [] }))
  }

  return {
    method,
    path: openApiPath,
    fullPath,
    middleware,
    handler,
    jsdoc,
    security: routeSecurity,
    tags: jsdoc.tags,
    operationId: jsdoc.operationId,
    summary: jsdoc.summary || '',
    description: jsdoc.description,
    deprecated: jsdoc.deprecated,
    hidden: jsdoc.hidden,
    sourceFile: sourceFile.getFilePath(),
  }
}

function normalizePath(path: string): string {
  // Remove double slashes, ensure trailing slash is consistent
  return path.replace(/\/+/g, '/').replace(/\/$/, '') || '/'
}

function extractPathParams(path: string): string {
  return normalizePath(path).replace(/:(\w+)/g, '{$1}')
}

function extractStringLiteral(node: AnyNode): string | null {
  const kind = node.getKindName()
  if (kind === 'StringLiteral') {
    return node.getText().slice(1, -1)
  }
  return null
}

function extractMethodList(node: AnyNode): string[] {
  const kind = node.getKindName()
  if (kind === 'StringLiteral') {
    return [node.getText().slice(1, -1).toUpperCase()]
  }
  if (kind === 'ArrayLiteralExpression') {
    const elements: AnyNode[] = node.getElements() || []
    return elements
      .map((e: AnyNode) => extractStringLiteral(e))
      .filter((s): s is string => s !== null)
      .map((s: string) => s.toUpperCase())
  }
  return []
}

function extractMiddleware(node: AnyNode): MiddlewareInfo | null {
  if (node.getKindName() !== 'CallExpression') return null

  const callExpr = node
  const callee = callExpr.getExpression()
  const calleeText: string = callee?.getText() || ''

  if (calleeText === 'zValidator' || calleeText.endsWith('.zValidator')) {
    const args: AnyNode[] = callExpr.getArguments() || []
    const target = extractStringLiteral(args[0]) as 'param' | 'query' | 'json' | 'form' | 'header' | 'cookie' | undefined

    return {
      type: 'zValidator',
      target,
      schema: extractZodSchemaFromArg(args[1]),
    }
  }

  return { type: 'unknown' }
}

function extractZodSchemaFromArg(node: AnyNode | undefined): ZodSchemaInfo | undefined {
  if (!node) return undefined

  const kind = node.getKindName()
  const text: string = node.getText() || ''

  if (kind === 'CallExpression') {
    const callee = node.getExpression()
    const calleeText: string = callee?.getText() || ''
    if (calleeText.startsWith('z.')) {
      return {
        sourceFile: node.getSourceFile().getFilePath(),
        schema: { _inline: text } as any,
        isExported: false,
      }
    }
  }

  if (kind === 'Identifier') {
    const name = text
    const symbol = node.getSymbol()
    // Follow aliased symbol (import → actual declaration)
    const realSymbol = symbol?.getAliasedSymbol?.() || symbol
    const decls = realSymbol?.getDeclarations?.()
    const sourceFile = decls?.[0]?.getSourceFile().getFilePath() || ''

    return {
      name,
      exportName: name,
      sourceFile,
      schema: { _ref: name } as any,
      isExported: true,
    }
  }

  return undefined
}

function extractHandlerInfo(node: AnyNode, _knownSchemas: Set<string>): HandlerInfo {
  const sourceFile = node.getSourceFile().getFilePath()
  let returnType: string | undefined

  try {
    returnType = node.getReturnType?.()?.getText?.()
  } catch {
    // Ignore type resolution errors
  }

  return {
    responses: [],
    returnType,
    sourceFile,
  }
}

/**
 * Walk the AST of a function body to find c.json(), c.text(), c.html(), c.body(), and c.redirect() calls.
 * For each call, extract status code and resolve the data type via ts-morph.
 */
function extractResponsesFromFunction(node: AnyNode, knownSchemas: Set<string>, middleware?: MiddlewareInfo[]): ResponseInfo[] {
  const responses: ResponseInfo[] = []
  const seenStatuses = new Set<number>()
  const mw = middleware || []

  // Walk all descendants looking for c.json / c.text / c.html / c.body / c.redirect calls
  try {
    node.forEachDescendant((descendant: AnyNode) => {
      if (descendant.getKindName() !== 'CallExpression') return
      extractResponseCall(descendant, responses, seenStatuses, knownSchemas, mw)
    })
  } catch {
    // Fallback: try regex on text for unresolvable nodes
    return fallbackExtractResponses(node)
  }

  // Check for text/plain and text/html at function level
  if (responses.length === 0) {
    const text = node.getText?.() || ''
    if (text.includes('c.text(') && !responses.some(r => r.contentType === 'text/plain')) {
      responses.push({ status: 200, description: 'OK', contentType: 'text/plain' })
    }
    if (text.includes('c.html(') && !responses.some(r => r.contentType === 'text/html')) {
      responses.push({ status: 200, description: 'OK', contentType: 'text/html' })
    }
    if (text.includes('c.body(') && !responses.some(r => r.contentType === 'application/octet-stream')) {
      responses.push({ status: 200, description: 'OK', contentType: 'application/octet-stream' })
    }
    if (text.includes('c.redirect(') && !responses.some(r => r.status === 302)) {
      responses.push({ status: 302, description: 'Found', contentType: 'text/plain' })
    }
  }

  if (responses.length === 0) {
    responses.push({ status: 200, description: 'OK', contentType: 'application/json' })
  }

  return responses
}

/**
 * Walk an ObjectLiteralExpression, handling spreads from c.req.valid().
 * For spreads, resolves the zValidator schema from middleware (avoids ZodType in ts-morph).
 * For explicit properties, type-walks the value expression.
 */
function walkObjectLiteral(
  objLit: AnyNode,
  knownSchemas: Set<string>,
  middleware: MiddlewareInfo[],
): SchemaRef {
  const schema: SchemaRef = { type: 'object', properties: {} }
  const required: string[] = []
  const spreadRefs: string[] = []

  const props: AnyNode[] = objLit.getProperties?.() || []

  for (const prop of props) {
    const kind = prop.getKindName?.()

    if (kind === 'SpreadAssignment') {
      const spreadExpr = prop.getExpression?.()
      if (spreadExpr) {
        const spreadSchema = resolveSpreadSource(spreadExpr, knownSchemas, middleware)
        if (spreadSchema) {
          if (spreadSchema.$ref) {
            // Defer merge: store $ref for normalizeResponseRefs to resolve later
            const refName = spreadSchema.$ref.replace('#/components/schemas/', '')
            if (!spreadRefs.includes(refName)) spreadRefs.push(refName)
          } else if (spreadSchema.properties) {
            for (const [k, v] of Object.entries(spreadSchema.properties)) {
              schema.properties![k] = v as SchemaRef
            }
            if (spreadSchema.required) {
              for (const r of spreadSchema.required) {
                if (!required.includes(r)) required.push(r)
              }
            }
          }
        }
      }
    } else if (kind === 'PropertyAssignment' || kind === 'ShorthandPropertyAssignment') {
      const propName = prop.getName?.()
      if (!propName) continue

      const valueExpr = prop.getInitializer?.() || prop
      try {
        const resolved = resolveExpressionType(valueExpr, knownSchemas) || undefined
        if (resolved && (resolved.type || resolved.$ref || resolved.properties)) {
          schema.properties![propName] = resolved
          if (resolved.type !== 'undefined' && !resolved.nullable) {
            required.push(propName)
          }
        }
      } catch {
        schema.properties![propName] = { type: 'string' }
      }
    }
  }

  if (required.length > 0) schema.required = required

  // Store deferred spread refs for normalizeResponseRefs to merge
  if (spreadRefs.length > 0) {
    ;(schema as any)._spreadRefs = spreadRefs
    // Make space for merged properties by not claiming this schema is complete
  }

  return schema
}

/**
 * Resolve a spread source expression. If it traces to c.req.valid(),
 * use the zValidator schema from the route's middleware chain.
 */
function resolveSpreadSource(
  expr: AnyNode,
  knownSchemas: Set<string>,
  middleware: MiddlewareInfo[],
): SchemaRef | undefined {
  // Trace Identifier → variable declaration → initializer → c.req.valid() call
  if (expr.getKindName?.() === 'Identifier') {
    const sym = expr.getSymbol?.()
    const decls = sym?.getDeclarations?.()
    if (decls?.[0]) {
      const init = decls[0].getInitializer?.()
      if (init?.getKindName?.() === 'CallExpression') {
        const callee = init.getExpression?.()
        if (callee?.getKindName?.() === 'PropertyAccessExpression') {
          const obj = callee.getExpression?.()?.getText?.()
          const method = callee.getName?.()
          // c.req.valid('json') → target = 'json'
          if (obj === 'c.req' && method === 'valid') {
            const args = init.getArguments?.() || []
            const target = extractStringLiteral(args[0])
            if (target) {
              // Find matching zValidator middleware
              const mw = middleware.find(m => m.type === 'zValidator' && m.target === target && m.schema?.exportName)
              if (mw?.schema?.exportName) {
                // Return a schema that will be resolved later via $ref
                return {
                  $ref: `#/components/schemas/${mw.schema.exportName}`,
                }
              }
            }
          }
        }
      }
    }
  }
  return undefined
}

function extractResponseCall(
  callNode: AnyNode,
  responses: ResponseInfo[],
  seenStatuses: Set<number>,
  knownSchemas: Set<string>,
  middleware: MiddlewareInfo[],
): void {
  const callee = callNode.getExpression?.()
  if (!callee || callee.getKindName?.() !== 'PropertyAccessExpression') return

  const obj = callee.getExpression?.()
  const method = callee.getName?.()
  if (obj?.getText?.() !== 'c') return

  const args: AnyNode[] = callNode.getArguments?.() || []
  if (args.length < 1) return

  if (method === 'json') {
    const dataArg = args[0]
    const statusArg = args[1]

    let status = 200
    if (statusArg) {
      const statusText = statusArg.getText?.() || ''
      const parsed = parseInt(statusText)
      if (!isNaN(parsed)) status = parsed
    }

    if (!seenStatuses.has(status)) {
      seenStatuses.add(status)

      let schema: SchemaRef | undefined
      try {
        if (dataArg) {
          // Object literals with spreads: walk individual properties.
          // Spread from c.req.valid() uses zValidator schema (avoids ZodType in ts-morph).
          if (dataArg.getKindName?.() === 'ObjectLiteralExpression') {
            schema = walkObjectLiteral(dataArg, knownSchemas, middleware)
          } else {
            // Trace variable references back to their declaration for type walking.
            let typeArg = dataArg
            if (dataArg.getKindName?.() === 'Identifier') {
              const sym = dataArg.getSymbol?.()
              const decls = sym?.getDeclarations?.()
              if (decls?.[0]) {
                const init = decls[0].getInitializer?.()
                if (init) {
                  if (init.getKindName?.() === 'ObjectLiteralExpression') {
                    // Variable assigned an object literal — walk it directly
                    schema = walkObjectLiteral(init, knownSchemas, middleware)
                  } else if (init.getKindName?.() === 'AsExpression') {
                    const expr = init.getExpression?.()
                    if (expr?.getKindName?.() === 'ObjectLiteralExpression') {
                      schema = walkObjectLiteral(expr, knownSchemas, middleware)
                    } else {
                      schema = resolveExpressionType(expr, knownSchemas) || undefined
                    }
                  } else {
                    schema = resolveExpressionType(typeArg, knownSchemas) || undefined
                  }
                }
              }
            } else if (dataArg.getKindName?.() === 'AsExpression') {
              const expr = dataArg.getExpression?.()
              if (expr?.getKindName?.() === 'ObjectLiteralExpression') {
                schema = walkObjectLiteral(expr, knownSchemas, middleware)
              } else {
                schema = resolveExpressionType(expr, knownSchemas) || undefined
              }
            } else {
              schema = resolveExpressionType(typeArg, knownSchemas) || undefined
            }
          }
        }
      } catch { /* type resolution failed, leave schema undefined */ }

      responses.push({
        status,
        description: getStatusDescription(status),
        contentType: 'application/json',
        schema,
      })
    }
  } else if (method === 'text') {
    if (!responses.some(r => r.contentType === 'text/plain')) {
      responses.push({ status: 200, description: 'OK', contentType: 'text/plain' })
    }
  } else if (method === 'html') {
    if (!responses.some(r => r.contentType === 'text/html')) {
      responses.push({ status: 200, description: 'OK', contentType: 'text/html' })
    }
  } else if (method === 'body') {
    if (!responses.some(r => r.contentType === 'application/octet-stream')) {
      responses.push({ status: 200, description: 'OK', contentType: 'application/octet-stream' })
    }
  } else if (method === 'redirect') {
    const statusArg = args[1]
    let status = 302
    if (statusArg) {
      const statusText = statusArg.getText?.() || ''
      const parsed = parseInt(statusText)
      if (!isNaN(parsed)) status = parsed
    }
    if (!seenStatuses.has(status)) {
      seenStatuses.add(status)
      responses.push({ status, description: getStatusDescription(status), contentType: 'text/plain' })
    }
  }
}

/** Fallback: regex-based extraction for when AST walking fails */
function fallbackExtractResponses(node: AnyNode): ResponseInfo[] {
  const responses: ResponseInfo[] = []
  const text: string = node.getText?.() || ''

  const jsonPattern = /c\.json\(\s*([\s\S]+?)\s*,\s*(\d+)\s*\)/g
  let match

  while ((match = jsonPattern.exec(text)) !== null) {
    const status = parseInt(match[2]!)
    if (!isNaN(status) && !responses.find(r => r.status === status)) {
      responses.push({
        status,
        description: getStatusDescription(status),
        contentType: 'application/json',
        schema: { type: 'object', description: 'Response object' },
      })
    }
  }

  if (text.includes('c.text(')) responses.push({ status: 200, description: 'OK', contentType: 'text/plain' })
  if (text.includes('c.html(')) responses.push({ status: 200, description: 'OK', contentType: 'text/html' })
  if (text.includes('c.body(')) responses.push({ status: 200, description: 'OK', contentType: 'application/octet-stream' })
  if (text.includes('c.redirect(')) responses.push({ status: 302, description: 'Found', contentType: 'text/plain' })

  if (responses.length === 0) {
    responses.push({ status: 200, description: 'OK', contentType: 'application/json' })
  }

  return responses
}

function generateSummary(method: string, path: string): string {
  // Remove path params {id} to get resource segments
  const parts = path.replace(/\{[^}]+\}/g, '').split('/').filter(Boolean)
  const resource = parts[parts.length - 1] || parts[0] || 'resource'
  const hasParams = path.includes('{')

  switch (method) {
    case 'GET':
      if (hasParams && parts.length > 0) return `Get ${singularize(resource)} by ID`
      return `List ${resource}`
    case 'POST':
      return `Create ${singularize(resource)}`
    case 'PUT':
      return `Update ${singularize(resource)}`
    case 'PATCH':
      return `Patch ${singularize(resource)}`
    case 'DELETE':
      return `Delete ${singularize(resource)}`
    default:
      return `${method} ${path}`
  }
}

function singularize(word: string): string {
  if (word.endsWith('ses') || word.endsWith('xes') || word.endsWith('ches') || word.endsWith('shes')) {
    return word.slice(0, -2)
  }
  if (word.endsWith('s') && !word.endsWith('ss')) {
    return word.slice(0, -1)
  }
  return word
}

function generateTags(path: string): string[] {
  const parts = path.replace(/[{}]/g, '').split('/').filter(Boolean)
  if (parts.length > 0 && parts[0]) {
    return [parts[0].charAt(0).toUpperCase() + parts[0].slice(1)]
  }
  return ['Default']
}

function generateOperationId(method: string, path: string): string {
  const parts = path.replace(/[{}]/g, '').replace(/\/$/, '').split('/').filter(Boolean)

  let prefix = method.toLowerCase()
  if (method === 'POST') prefix = 'create'
  else if (method === 'PUT') prefix = 'update'
  else if (method === 'PATCH') prefix = 'patch'
  else if (method === 'DELETE') prefix = 'delete'

  const partsPascal = parts.map(p =>
    p.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')
  )
  return prefix + partsPascal.join('')
}

function getStatusDescription(status: number): string {
  const descriptions: Record<number, string> = {
    200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content',
    301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
    400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
    404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict',
    410: 'Gone', 422: 'Unprocessable Entity', 429: 'Too Many Requests',
    500: 'Internal Server Error',
  }
  return descriptions[status] || 'Response'
}
