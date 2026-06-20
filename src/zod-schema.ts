import type { SourceFile } from 'ts-morph'
import type { ZodSchemaInfo } from './types'

type AnyNode = any

export interface ResolvedSchema {
  type?: string | string[]
  properties?: Record<string, any>
  required?: string[]
  [key: string]: any
}

/**
 * Resolve a Zod schema definition from its source file and export name.
 * Walks the AST to extract property types, validations, and metadata.
 */
export function resolveZodSchema(
  schemaInfo: ZodSchemaInfo,
  files: SourceFile[],
  knownSchemas?: Set<string>
): ResolvedSchema | null {
  const { exportName, sourceFile: schemaFilePath } = schemaInfo

  // Find the source file where this schema is defined
  const file = files.find(f => f.getFilePath() === schemaFilePath)
  if (!file) return null

  // Find the exported variable/const declaration
  let schemaCall: AnyNode | null = null

  file.forEachDescendant((node: AnyNode) => {
    if (schemaCall) return // already found

    // Look for variable declarations: export const Name = z.object(...)
    if (node.getKindName() === 'VariableDeclaration') {
      const name = node.getName?.()
      if (name === exportName) {
        const initializer = node.getInitializer?.()
        if (initializer) {
          schemaCall = initializer
        }
      }
    }
  })

  if (!schemaCall) return null

  return convertZodAST(schemaCall, files, knownSchemas || new Set())
}

/**
 * Walk a Zod chain AST and produce JSON Schema.
 */
function convertZodAST(node: AnyNode, files: SourceFile[], knownSchemas: Set<string>): ResolvedSchema | null {
  const kind = node.getKindName()

  if (kind === 'CallExpression') {
    const callee = node.getExpression?.()
    const calleeText = callee?.getText?.() || ''

    // z.object({...})
    if (calleeText === 'z.object' || calleeText.endsWith('.object')) {
      return convertZodObject(node, files, knownSchemas)
    }

    // z.array(...)
    if (calleeText === 'z.array' || calleeText.endsWith('.array')) {
      const args = node.getArguments?.() || []
      if (args[0]) {
        const items = convertZodAST(args[0], files, knownSchemas)
        return { type: 'array', items: items || {} }
      }
    }

    // z.enum([...])
    if (calleeText === 'z.enum' || calleeText.endsWith('.enum')) {
      const args = node.getArguments?.() || []
      if (args[0]?.getKindName() === 'ArrayLiteralExpression') {
        const elements: AnyNode[] = args[0].getElements?.() || []
        const values = elements
          .map((e: AnyNode) => extractLiteralValue(e))
          .filter((v: any) => v !== undefined)
        return { type: 'string', enum: values }
      }
    }

    // z.literal(...) - keep as enum on the parent
    if (calleeText === 'z.literal' || calleeText.endsWith('.literal')) {
      const args = node.getArguments?.() || []
      const val = extractLiteralValue(args[0])
      if (val !== undefined) {
        return { const: val }
      }
    }

    // Check if the full callee is a known type constructor: z.string, z.coerce.number, etc.
    const directType = resolveZodTypeByText(calleeText)
    if (directType) {
      return directType
    }

    // Chained methods: z.string().email().min(1) etc.
    // The outer call is the last chained method
    // Recurse into the object part first, then apply modifiers
    const chainedSchema = resolveChainedZod(node, files, knownSchemas)
    if (chainedSchema) return chainedSchema
  }

  // Identifier types: z.string, z.number, etc.
  // Also: references to other schemas (UserSchema, PostSchema, etc.)
  if (kind === 'Identifier' || kind === 'PropertyAccessExpression') {
    const typeResult = resolveZodType(node)
    if (typeResult) return typeResult
    // If not a Zod type, try to resolve as a reference to another schema
    if (kind === 'Identifier') {
      const name = node.getText?.() || ''
      return resolveReferencedSchema(name, node, files, knownSchemas)
    }
    return null
  }

  return null
}

function convertZodObject(callNode: AnyNode, files: SourceFile[], knownSchemas: Set<string>): ResolvedSchema {
  const args = callNode.getArguments?.() || []
  const schema: ResolvedSchema = {
    type: 'object',
    properties: {},
    required: [],
  }

  if (args[0]?.getKindName() === 'ObjectLiteralExpression') {
    const objLiteral = args[0]
    const properties = objLiteral.getProperties?.() || []

    for (const prop of properties) {
      let propName = prop.getName?.()
      if (!propName) continue
      // Strip quotes from property names with hyphens: 'x-api-version' → x-api-version
      propName = propName.replace(/^['"]|['"]$/g, '')

      const initializer = prop.getInitializer?.()
      if (!initializer) continue

      // Walk the property's Zod chain
      const propSchema = convertZodAST(initializer, files, knownSchemas)
      if (propSchema) {
        schema.properties![propName] = propSchema

        // Check if required (not .optional() or .nullable() at top level)
        const isOptional = checkIsOptional(initializer)
        if (!isOptional) {
          schema.required!.push(propName)
        }
      }

      // Check JSDoc on property for description
      const jsdocs = prop.getJsDocs?.()
      if (jsdocs && jsdocs.length > 0 && propSchema) {
        const comment = jsdocs[0].getComment?.()
        if (comment) schema.properties![propName].description = comment
      }
    }
  }

  if (schema.required!.length === 0) {
    delete (schema as any).required
  }

  return schema
}

function resolveChainedZod(node: AnyNode, files: SourceFile[], knownSchemas: Set<string>): ResolvedSchema | null {
  const callee = node.getExpression?.()
  if (!callee || callee.getKindName() !== 'PropertyAccessExpression') return null

  const base = callee.getExpression?.()
  const method = callee.getName?.()
  const args = node.getArguments?.() || []

  if (!base || !method) return null

  // First resolve the base type (e.g., z.string())
  const baseSchema = convertZodAST(base, files, knownSchemas)

  // Then apply the chained method
  return applyZodMethod(baseSchema, method, args)
}

function resolveZodType(node: AnyNode): ResolvedSchema | null {
  const text = node.getText?.() || ''
  return resolveZodTypeByText(text)
}

/**
 * Check if a text (callee expression text) matches a known Zod type constructor.
 */
function resolveZodTypeByText(text: string): ResolvedSchema | null {
  // Direct type constructors
  if (text === 'z.string' || text === 'z.string()') return { type: 'string' }
  if (text === 'z.number' || text === 'z.number()') return { type: 'number' }
  if (text === 'z.boolean' || text === 'z.boolean()') return { type: 'boolean' }
  if (text === 'z.date' || text === 'z.date()') return { type: 'string', format: 'date-time' }
  if (text === 'z.bigint' || text === 'z.bigint()') return { type: 'integer', format: 'int64' }
  if (text === 'z.null' || text === 'z.null()') return { type: 'null' }
  if (text === 'z.undefined' || text === 'z.undefined()') return {}
  if (text === 'z.any' || text === 'z.any()') return {}

  // Coerced types
  if (text === 'z.coerce.string' || text === 'z.coerce.string()') return { type: 'string' }
  if (text === 'z.coerce.number' || text === 'z.coerce.number()') return { type: 'number' }
  if (text === 'z.coerce.boolean' || text === 'z.coerce.boolean()') return { type: 'boolean' }
  if (text === 'z.coerce.date' || text === 'z.coerce.date()') return { type: 'string', format: 'date-time' }

  // z.instanceof(File) / z.instanceof(Blob)
  if (text === 'z.instanceof') return { type: 'string', format: 'binary' }

  return null
}

function applyZodMethod(
  base: ResolvedSchema | null,
  method: string,
  args: AnyNode[]
): ResolvedSchema {
  const result = base ? { ...base } : { type: 'string' }

  switch (method) {
    case 'min':
      if (result.type === 'string') result.minLength = getNumberArg(args[0])
      else if (result.type === 'number' || result.type === 'integer') result.minimum = getNumberArg(args[0])
      break
    case 'max':
      if (result.type === 'string') result.maxLength = getNumberArg(args[0])
      else if (result.type === 'number' || result.type === 'integer') result.maximum = getNumberArg(args[0])
      break
    case 'email':
      result.format = 'email'
      break
    case 'url':
      result.format = 'uri'
      break
    case 'uuid':
      result.format = 'uuid'
      break
    case 'datetime':
      result.format = 'date-time'
      break
    case 'optional':
      // Mark as not required — handled at object level
      break
    case 'nullable':
      if (result.type) {
        result.type = [result.type as string, 'null']
      }
      break
    case 'nullish':
      // Both optional and nullable
      if (result.type) {
        result.type = [result.type as string, 'null']
      }
      break
    case 'default':
      const defVal = extractLiteralValue(args[0])
      if (defVal !== undefined) result.default = defVal
      break
    case 'describe':
      const desc = extractLiteralValue(args[0])
      if (typeof desc === 'string') result.description = desc
      break
    case 'readonly':
      result.readOnly = true
      break
    case 'deprecated':
      result.deprecated = true
      break
    case 'regex':
      const pattern = extractLiteralValue(args[0])
      if (typeof pattern === 'string') result.pattern = pattern
      break
    case 'int':
      result.type = 'integer'
      break
    case 'array':
      // .array() is handled at call level, not chained
      break
  }

  return result
}

function checkIsOptional(node: AnyNode): boolean {
  if (node.getKindName() !== 'CallExpression') return false
  const callee = node.getExpression?.()
  if (!callee || callee.getKindName() !== 'PropertyAccessExpression') return false

  const method = callee.getName?.()
  if (method === 'optional' || method === 'nullish' || method === 'default') return true

  // Recurse into chained calls
  const base = callee.getExpression?.()
  if (base) return checkIsOptional(base)

  return false
}

function getNumberArg(node: AnyNode | undefined): number | undefined {
  if (!node) return undefined
  const val = extractLiteralValue(node)
  return typeof val === 'number' ? val : undefined
}

function extractLiteralValue(node: AnyNode | undefined): any {
  if (!node) return undefined

  const kind = node.getKindName()
  if (kind === 'StringLiteral') return node.getText().slice(1, -1)
  if (kind === 'NumericLiteral') return Number(node.getText())
  if (kind === 'TrueKeyword') return true
  if (kind === 'FalseKeyword') return false
  if (kind === 'NullKeyword') return null

  return undefined
}

function resolveReferencedSchema(
  name: string,
  node: AnyNode,
  files: SourceFile[],
  knownSchemas: Set<string>
): ResolvedSchema | null {
  // If this name is a known schema, use $ref instead of inlining
  if (knownSchemas.has(name)) {
    return { $ref: `#/components/schemas/${name}` }
  }

  // Try to find the symbol and resolve its definition
  try {
    const symbol = node.getSymbol?.()
    if (symbol) {
      const realSymbol = (symbol as any).getAliasedSymbol?.() || symbol
      const decls = realSymbol.getDeclarations?.()
      if (decls && decls.length > 0) {
        const decl = decls[0]
        const initializer = decl.getInitializer?.()
        if (initializer) {
          return convertZodAST(initializer, files, knownSchemas)
        }
      }
    }
  } catch {
    // Symbol resolution failed
  }

  return null
}
