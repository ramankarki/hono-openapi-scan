import type { Type } from 'ts-morph'
import type { SchemaRef } from './types'

type AnyNode = any

/**
 * Convert a ts-morph Type to a SchemaRef (JSON Schema fragment).
 * Uses known schema names to produce $ref for Zod/Drizzle types.
 */
export function typeToSchemaRef(type: Type, knownSchemas: Set<string>): SchemaRef {
  const text = type.getText()

  // Handle primitives
  if (type.isString()) return { type: 'string' }
  if (type.isNumber()) return { type: 'number' }
  if (type.isBoolean()) return { type: 'boolean' }
  if (type.isNull()) return { type: 'null' }
  if (type.isUndefined()) return {}
  if (type.isVoid()) return {}

  // Handle Date
  try {
    const symbol = type.getSymbol()
    const symName = symbol?.getName() || ''
    if (symName === 'Date') return { type: 'string', format: 'date-time' }
  } catch { /* ignore */ }

  // Handle string literal types (enum values)
  if (type.isStringLiteral()) {
    const val = text.replace(/^['"]|['"]$/g, '')
    return { type: 'string', enum: [val] }
  }

  // Handle number literal
  if (type.isNumberLiteral()) {
    return { type: 'number', enum: [String(Number(text))] }
  }

  // Handle boolean literal
  if (type.isBooleanLiteral()) {
    return { type: 'boolean', enum: [String(text === 'true')] }
  }

  // Handle arrays
  if (type.isArray()) {
    const elementType = type.getArrayElementType()
    if (elementType) {
      return { type: 'array', items: typeToSchemaRef(elementType, knownSchemas) }
    }
    return { type: 'array', items: {} }
  }

  // Handle union types (e.g., string | null, 'a' | 'b' | 'c')
  if (type.isUnion()) {
    const unionTypes = type.getUnionTypes()
    const nonNullTypes = unionTypes.filter(t => !t.isNull() && !t.isUndefined())
    const hasNull = unionTypes.some(t => t.isNull() || t.isUndefined())

    if (nonNullTypes.length === 1) {
      const result = typeToSchemaRef(nonNullTypes[0]!, knownSchemas)
      if (hasNull) result.nullable = true
      return result
    }

    // Check if it's a literal union (enum)
    const allLiterals = nonNullTypes.every(t => t.isStringLiteral() || t.isNumberLiteral())
    if (allLiterals && nonNullTypes.length > 0) {
      const values: string[] = nonNullTypes.map(t => {
        const v = t.getText().replace(/^['"]|['"]$/g, '')
        return t.isNumberLiteral() ? String(Number(v)) : v
      })
      const typeBase: string = nonNullTypes[0]!.isStringLiteral() ? 'string' : 'number'
      return { type: typeBase, enum: values }
    }

    // General union → oneOf
    return {
      oneOf: nonNullTypes.map(t => typeToSchemaRef(t, knownSchemas)),
    }
  }

  // Handle objects
  const properties = type.getProperties()
  if (properties.length > 0) {
    // Check if this type matches a known schema (via symbol name or alias)
    let schemaName: string | null = null

    try {
      const symbol = type.getSymbol()
      const name = symbol?.getName()
      if (name && knownSchemas.has(name)) {
        schemaName = name
      }
    } catch { /* ignore */ }

    try {
      // Check alias symbol (e.g., type alias pointing to a schema)
      const aliasSym = (type as any).getAliasSymbol?.()
      const aliasName = aliasSym?.getName?.()
      if (!schemaName && aliasName && knownSchemas.has(aliasName)) {
        schemaName = aliasName
      }
    } catch { /* ignore */ }

    if (schemaName) {
      return { $ref: `#/components/schemas/${schemaName}` }
    }

    // Walk properties and build inline schema
    const schema: SchemaRef = {
      type: 'object',
      properties: {} as Record<string, SchemaRef>,
    }
    const required: string[] = []

    for (const prop of properties) {
      const propName = prop.getName()
      try {
        let propType: Type | undefined
        let valueDecl: any = prop.getValueDeclaration?.()

        if (valueDecl) {
          propType = valueDecl.getType()
        } else {
          // Fallback for synthetic types (e.g., from `as` assertions):
          // try declarations, or use the property type from the parent
          const decls = prop.getDeclarations?.()
          if (decls && decls.length > 0) {
            valueDecl = decls[0]
            propType = (valueDecl as any).getType()
          }
        }

        if (propType) {
          // Skip function-typed properties (methods, Zod runtime internals).
          // Spread of c.req.valid() resolves to full Zod object with callable methods.
          // Only keep data properties (no call signatures).
          try {
            const callSigs = (propType as any).getCallSignatures?.() || []
            if (callSigs.length > 0) continue
          } catch { /* not callable */ }

          const propSchema = typeToSchemaRef(propType, knownSchemas)

          // Check description from JSDoc on the property
          if (valueDecl) {
            try {
              if (typeof (valueDecl as any).getJsDocs === 'function') {
                const jsdocs = (valueDecl as any).getJsDocs()
                if (jsdocs && jsdocs.length > 0) {
                  const comment = jsdocs[0].getComment?.()
                  if (comment) propSchema.description = comment
                }
              }
            } catch { /* ignore */ }
          }

          schema.properties![propName] = propSchema

          // Determine if required
          if (!propType.isNullable() && !propType.isUndefined()) {
            if (valueDecl) {
              const hasQuestion = typeof (valueDecl as any).hasQuestionToken === 'function'
                ? (valueDecl as any).hasQuestionToken()
                : false
              if (!hasQuestion) {
                required.push(propName)
              }
            } else {
              required.push(propName)
            }
          }
        }
      } catch {
        // Fallback for property type resolution failure
        schema.properties![propName] = { type: 'string' }
      }
    }

    if (required.length > 0) {
      schema.required = required
    }

    return schema
  }

  // Handle type references (e.g., Promise<User>, Array<User>)
  try {
    const typeArgs = (type as any).getTypeArguments?.()
    if (typeArgs && typeArgs.length > 0) {
      // It's a generic type like Promise<T> or Array<T>
      const baseText = text.replace(/<.*$/, '')
      if (baseText === 'Promise') {
        return typeToSchemaRef(typeArgs[0], knownSchemas)
      }
    }
  } catch { /* ignore */ }

  // Fallback: try to match by type text
  const cleanText = text.replace(/import\([^)]+\)\./g, '').trim()
  if (knownSchemas.has(cleanText)) {
    return { $ref: `#/components/schemas/${cleanText}` }
  }

  // Ultimate fallback
  return { type: 'object', description: `Response (${cleanText})` }
}

/**
 * Resolve the TypeScript type of an expression node and convert to SchemaRef.
 */
export function resolveExpressionType(node: AnyNode, knownSchemas: Set<string>): SchemaRef | null {
  try {
    const type = node.getType()
    return typeToSchemaRef(type, knownSchemas)
  } catch {
    return null
  }
}

/**
 * Get the return type of a function-like node and convert to SchemaRef.
 * Unwraps Promise<T> → T.
 */
export function resolveReturnType(node: AnyNode, knownSchemas: Set<string>): SchemaRef | null {
  try {
    const returnType = node.getReturnType?.()
    if (!returnType) return null

    // Unwrap Promise<T>
    let unwrapped = returnType
    try {
      const typeArgs = (returnType as any).getTypeArguments?.()
      if (typeArgs && typeArgs.length > 0) {
        const text = returnType.getText()
        if (text.startsWith('Promise<')) {
          unwrapped = typeArgs[0]
        }
      }
    } catch { /* keep as-is */ }

    return typeToSchemaRef(unwrapped, knownSchemas)
  } catch {
    return null
  }
}

/**
 * Resolve a generic TypeReference string like "z.infer<typeof UserSchema>"
 * or "User" to a known schema name if it matches.
 */
export function resolveTypeReference(typeText: string, knownSchemas: Set<string>): string | null {
  // Strip z.infer<typeof ...> wrapper
  let name = typeText
  const inferMatch = name.match(/z\.infer\s*<\s*typeof\s+(\w+)\s*>/)
  if (inferMatch) {
    name = inferMatch[1]!
  }

  // Strip type parameter wrappers
  name = name.replace(/^[A-Z]\w*<\s*/, '').replace(/>$/, '')

  if (knownSchemas.has(name)) return name
  return null
}
