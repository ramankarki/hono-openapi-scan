import type { JSDocInfo } from './types'

type AnyNode = any

export function parseJSDocRaw(comment: string): JSDocInfo {
  const info: JSDocInfo = {
    tags: [],
    isPublic: false,
    deprecated: false,
    hidden: false,
    errors: [],
    params: [],
  }

  const lines = comment.split('\n').map(l => l.replace(/^\s*\*\s?/, '').trim())
  const descLines: string[] = []
  let inTags = false

  for (const line of lines) {
    if (line.startsWith('@')) {
      inTags = true
      parseTag(line, info)
    } else if (!inTags && line && !line.startsWith('/**') && !line.startsWith('*/')) {
      descLines.push(line)
    }
  }

  const desc = descLines.join(' ').trim()
  if (desc) {
    const firstPeriod = desc.search(/[.!?]\s/)
    if (firstPeriod > 0) {
      info.summary = desc.slice(0, firstPeriod + 1).trim()
      info.description = desc.slice(firstPeriod + 1).trim() || undefined
    } else {
      info.summary = desc
    }
  }

  return info
}

function parseTag(line: string, info: JSDocInfo) {
  const match = line.match(/^@(\w+)\s*(.*?)$/)
  if (!match) return

  const [, tag, rest] = match

  // Tags that don't need arguments
  const noArgTags = ['public', 'deprecated', 'hide']

  switch (tag) {
    case 'tags': {
      const parsed = parseBraceOrComma(rest || '')
      info.tags.push(...parsed)
      break
    }
    case 'summary':
      info.summary = (rest || '').trim()
      break
    case 'description':
      info.description = (rest || '').trim()
      break
    case 'public':
      info.isPublic = true
      break
    case 'deprecated':
      info.deprecated = true
      break
    case 'hide':
      info.hidden = true
      break
    case 'operationId':
      info.operationId = (rest || '').trim()
      break
    case 'security': {
      const parsed = parseBraceOrComma(rest || '')
      info.security = parsed
      break
    }
    case 'returns':
    case 'return':
      info.returns = (rest || '').trim()
      break
    case 'error': {
      if ((rest || '').trim().toLowerCase() === 'none') {
        info.errors = []
        break
      }
      // Support: @error 400, 403, 500 (comma or space separated)
      const codes = (rest || '').split(/[,\s]+/).filter(Boolean)
      for (const code of codes) {
        const status = parseInt(code)
        if (!isNaN(status)) {
          info.errors.push({ status })
        }
      }
      break
    }
    case 'param': {
      const pParts = (rest || '').trim().split(/\s+-\s+/)
      info.params.push({ name: pParts[0]?.trim() || '', description: pParts[1]?.trim() })
      break
    }
  }
}

function parseBraceOrComma(input: string): string[] {
  const trimmed = input.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean)
  }
  return trimmed.split(',').map(s => s.trim()).filter(Boolean)
}

export function parseJSDocFromNode(node: AnyNode): JSDocInfo | null {
  if (typeof node.getJsDocs !== 'function') return null

  try {
    const jsdocs = node.getJsDocs()
    if (!jsdocs || jsdocs.length === 0) return null

    const comments: string[] = []
    for (const doc of jsdocs) {
      const text = doc.getComment?.()
      if (text) comments.push(text)

      const tags = doc.getTags?.()
      if (tags) {
        for (const tag of tags) {
          // getComment() handles multi-line descriptions properly
          // For tags like @returns {Type}, getComment() may be empty and the type is in a typeExpression
          const comment = tag.getComment?.()
          if (comment !== undefined && comment !== null && comment !== '') {
            // Join multi-line comments with spaces for consistent single-line parsing
            const singleLine = comment.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
            comments.push(`@${tag.getTagName()} ${singleLine}`)
          } else {
            // Fallback: use getText() for the full tag line (handles @returns {Type})
            const tagText = tag.getText?.() || `@${tag.getTagName()}`
            comments.push(tagText)
          }
        }
      }
    }

    return comments.length > 0 ? parseJSDocRaw(comments.join('\n')) : null
  } catch {
    return null
  }
}
