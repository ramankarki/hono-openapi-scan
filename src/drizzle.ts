import type { SourceFile } from 'ts-morph'
import type { DrizzleTableInfo, DrizzleColumnInfo } from './types'

type AnyNode = any

/**
 * Detect Drizzle table definitions (pgTable, mysqlTable, sqliteTable) in source files.
 * Only tables that are actually referenced by endpoints are registered.
 */
export function findDrizzleTables(files: SourceFile[]): Map<string, DrizzleTableInfo> {
  const tables = new Map<string, DrizzleTableInfo>()

  for (const file of files) {
    if (file.getFilePath().includes('node_modules')) continue

    file.forEachDescendant((node: AnyNode) => {
      if (node.getKindName() !== 'CallExpression') return
      const callee = node.getExpression?.()
      const calleeText: string = callee?.getText?.() || ''

      // Match pgTable('name', {...}) or mysqlTable, sqliteTable, singlestoreTable
      const tableMatch = calleeText.match(/^(pgTable|mysqlTable|sqliteTable|singlestoreTable)$/)
      if (!tableMatch) return

      const args: AnyNode[] = node.getArguments?.() || []
      if (args.length < 2) return

      const tableName = extractLiteral(args[0])
      if (!tableName) return

      // Find the variable name this table is assigned to
      const parent = node.getParent?.()
      let exportName = tableName
      if (parent?.getKindName() === 'VariableDeclaration') {
        exportName = parent.getName?.() || tableName
      }

      // Extract columns from the second argument (object literal)
      const columns = extractColumns(args[1])
      if (columns.length === 0) return

      tables.set(exportName, {
        tableName,
        exportName,
        sourceFile: file.getFilePath(),
        columns,
      })
    })
  }

  return tables
}

function extractLiteral(node: AnyNode): string | null {
  if (node.getKindName() === 'StringLiteral') {
    return node.getText().slice(1, -1)
  }
  return null
}

/** Extract description from JSDoc or // comment above/trailing a node */
function getCommentFromNode(node: AnyNode): string | null {
  // 1. Try JSDoc
  const jsdocs = node.getJsDocs?.()
  if (jsdocs && jsdocs.length > 0) {
    const comment = jsdocs[0].getComment?.()
    if (comment) return comment.trim()
  }

  // 2. Try ts-morph's built-in leading comment ranges
  try {
    const ranges = node.getLeadingCommentRanges?.()
    if (ranges && ranges.length > 0) {
      const fullText = node.getSourceFile?.()?.getFullText?.() || ''
      const comments = ranges
        .map((r: any) => {
          const text = fullText.slice(r.getPos(), r.getEnd())
          return text.replace(/^\/\/\s*/, '').replace(/^\/\*\s*/, '').replace(/\s*\*\/$/, '').trim()
        })
        .filter((c: string) => c && !c.startsWith('*') && !c.startsWith('/'))
      if (comments.length > 0) return comments.join(' ')
    }
  } catch {
    // Fallback to manual
  }

  // 3. Try trailing // comment on the same line
  const nodeText = node.getText?.() || ''
  const trailingMatch = nodeText.match(/\/\/\s*(.+)/)
  if (trailingMatch) return trailingMatch[1]!.trim()

  return null
}

function extractColumns(objLiteral: AnyNode): DrizzleColumnInfo[] {
  if (objLiteral.getKindName() !== 'ObjectLiteralExpression') {
    // Could be a function returning an object: (table) => ({...})
    if (objLiteral.getKindName() === 'ArrowFunction') {
      const body = objLiteral.getBody?.()
      if (body) return extractColumns(body)
    }
    return []
  }

  const columns: DrizzleColumnInfo[] = []
  const properties: AnyNode[] = objLiteral.getProperties?.() || []

  for (const prop of properties) {
    const name: string = prop.getName?.() || ''
    if (!name) continue

    const initializer = prop.getInitializer?.()
    if (!initializer) continue

    const col = extractColumnInfo(name, initializer)
    if (!col) continue

    // Get description from JSDoc or plain // comment above/trailing the property
    const comment = getCommentFromNode(prop)
    if (comment) col.description = comment

    columns.push(col)
  }

  return columns
}

function extractColumnInfo(name: string, node: AnyNode): DrizzleColumnInfo | null {
  if (node.getKindName() !== 'CallExpression') return null

  const text: string = node.getText?.() || ''
  const callee = node.getExpression?.()
  const calleeText: string = callee?.getText?.() || ''

  // Base column type from the callee name
  let type = 'string'
  let format: string | undefined

  if (calleeText.includes('uuid')) { type = 'string'; format = 'uuid' }
  else if (calleeText.includes('text') || calleeText.includes('varchar')) { type = 'string' }
  else if (calleeText.includes('integer') || calleeText.includes('serial')) { type = 'integer' }
  else if (calleeText.includes('real') || calleeText.includes('doublePrecision')) { type = 'number' }
  else if (calleeText.includes('boolean')) { type = 'boolean' }
  else if (calleeText.includes('timestamp') || calleeText.includes('date')) { type = 'string'; format = 'date-time' }
  else if (calleeText.includes('json')) { type = 'object' }

  // Drizzle: columns are nullable by default, .notNull() makes them required
  const isNotNull = text.includes('.notNull(')
  const hasDefault = text.includes('.default(') || text.includes('.defaultRandom(') || text.includes('.defaultNow(')
  const isPrimaryKey = text.includes('.primaryKey(')
  const isUnique = text.includes('.unique(')
  const isReadOnly = text.includes('.defaultRandom(') || text.includes('.defaultNow(') || calleeText.includes('serial')

  // A column is required if it has .notNull() AND doesn't have a default
  // (primary keys with defaults are still required for output schemas)
  const nullable = !isNotNull

  // Extract enum values
  let enumValues: string[] | undefined
  if (calleeText.includes('pgEnum')) {
    const args = node.getArguments?.() || []
    if (args.length >= 2 && args[1]?.getKindName() === 'ArrayLiteralExpression') {
      const elements: AnyNode[] = args[1].getElements?.() || []
      enumValues = elements
        .map((e: AnyNode) => extractLiteral(e))
        .filter((s): s is string => s !== null)
    }
  }

  // Extract maxLength for varchar
  let maxLength: number | undefined
  if (calleeText.includes('varchar')) {
    const args = node.getArguments?.() || []
    if (args[0]?.getKindName() === 'NumericLiteral') {
      maxLength = Number(args[0].getText())
    }
  }

  return {
    name,
    type,
    format,
    nullable,
    hasDefault,
    isPrimaryKey,
    isUnique,
    isReadOnly,
    description: undefined,
    enumValues,
    maxLength,
  }
}

/**
 * Convert a Drizzle table to JSON Schema.
 */
export function drizzleTableToSchema(table: DrizzleTableInfo): Record<string, any> {
  const properties: Record<string, any> = {}
  const required: string[] = []

  for (const col of table.columns) {
    const prop: Record<string, any> = { type: col.type }
    if (col.format) prop.format = col.format
    if (col.enumValues) prop.enum = col.enumValues
    if (col.maxLength) prop.maxLength = col.maxLength
    if (col.isReadOnly) prop.readOnly = true
    prop.description = col.description || camelToTitle(col.name)
    prop.example = generateExample(col)

    properties[col.name] = prop

    if (!col.nullable && !col.hasDefault && !col.isPrimaryKey) {
      required.push(col.name)
    }
    // Primary keys are always required even with defaults
  }

  const schema: Record<string, any> = {
    type: 'object',
    properties,
  }

  if (required.length > 0) {
    schema.required = required
  }

  return schema
}

/** Convert camelCase to Title Case */
function camelToTitle(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, s => s.toUpperCase())
    .trim()
}

/** Generate a sensible example value from column type */
function generateExample(col: import('./types').DrizzleColumnInfo): string | number | boolean | null {
  if (col.enumValues && col.enumValues.length > 0) return col.enumValues[0]!
  switch (col.type) {
    case 'string':
      if (col.format === 'uuid') return '550e8400-e29b-41d4-a716-446655440000'
      if (col.format === 'date-time') return '2026-01-15T10:30:00Z'
      if (col.format === 'email') return 'user@example.com'
      if (col.format === 'uri') return 'https://example.com'
      return 'string'
    case 'integer': return 42
    case 'number': return 3.14
    case 'boolean': return true
    default: return 'string'
  }
}
