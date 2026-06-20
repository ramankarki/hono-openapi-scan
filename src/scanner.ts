import { writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import type { SourceFile } from 'ts-morph'
import { createProject } from './project'
import { buildAppRegistry, walkAppRoutes, type AppRegistry } from './routes'
import { assembleSpec } from './assemble'
import type { ScanConfig, RouteInfo } from './types'

export async function scan(config: ScanConfig): Promise<string> {
  const entry = config.entry || 'src/index.ts'
  const output = config.output || 'openapi.json'

  console.log(`Scanning entry: ${entry}`)

  const { entryFile, files } = createProject(entry)
  console.log(`Resolved ${files.length} source files`)

  // Build app registry - maps variable names to their Hono app locations
  const registry = buildAppRegistry(files)
  console.log(`Found ${registry.apps.size} Hono app(s)`)

  if (registry.apps.size === 0) {
    console.warn('Warning: No Hono app instances found')
  }

  // Collect known schema names from all source files (for $ref resolution)
  const knownSchemas = collectKnownSchemaNames(files)

  // Walk routes starting from the entry file's app
  // Try default export first, then named exports
  let allRoutes: RouteInfo[] = []

  // Find the app in the entry file
  const entryApp = findEntryApp(registry, entryFile)
  if (entryApp) {
    const routes = walkAppRoutes(entryApp.sourceFile, entryApp.name, registry, '', knownSchemas)
    console.log(`  ${entryApp.name}: ${routes.length} route(s)`)
    allRoutes.push(...routes)
  } else {
    // Fallback: walk all apps
    for (const [, app] of registry.apps) {
      const routes = walkAppRoutes(app.sourceFile, app.name, registry, '', knownSchemas)
      console.log(`  ${app.name}: ${routes.length} route(s)`)
      allRoutes.push(...routes)
    }
  }

  // Deduplicate routes
  const seen = new Set<string>()
  allRoutes = allRoutes.filter(r => {
    const key = `${r.method}:${r.fullPath}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  console.log(`Total unique routes: ${allRoutes.length}`)

  const spec = assembleSpec(allRoutes, config, files, registry.authScopes)

  const json = JSON.stringify(spec, null, 2)
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, json)
  console.log(`Wrote OpenAPI spec to: ${output}`)

  return json
}

function findEntryApp(registry: AppRegistry, entryFile: import('ts-morph').SourceFile): { sourceFile: import('ts-morph').SourceFile; name: string } | null {
  const entryPath = entryFile.getFilePath()

  // Try default export or 'app' in entry file
  for (const [key, app] of registry.apps) {
    if (app.sourceFile.getFilePath() === entryPath && (app.name === 'default' || app.name === 'app')) {
      return app
    }
  }
  // Any app in the entry file
  for (const [, app] of registry.apps) {
    if (app.sourceFile.getFilePath() === entryPath) {
      return app
    }
  }
  return null
}

/**
 * Collect all exported Zod schema names and Drizzle table names from reachable source files.
 * These are used for $ref resolution in response type walking.
 */
function collectKnownSchemaNames(files: SourceFile[]): Set<string> {
  const names = new Set<string>()
  const drizzlePatterns = ['pgTable(', 'mysqlTable(', 'sqliteTable(', 'singlestoreTable(']

  for (const file of files) {
    if (file.getFilePath().includes('node_modules')) continue
    try {
      file.forEachDescendant((node: any) => {
        if (node.getKindName() === 'VariableDeclaration') {
          const name = node.getName?.()
          if (!name) return
          const initText = node.getInitializer?.()?.getText?.() || ''

          // Zod schemas: z.object, z.enum, z.array, z.string, etc.
          if (initText.includes('z.object') || initText.includes('z.enum') ||
              initText.includes('z.array') || initText.startsWith('z.')) {
            // Check if it's actually exported
            const parent = node.getParent?.()?.getParent?.()
            const isExported = parent?.getKindName?.() === 'VariableStatement' &&
              (parent as any).isExported?.()
            if (isExported) {
              names.add(name)
            }
          }

          // Drizzle tables: pgTable, mysqlTable, sqliteTable, singlestoreTable
          if (drizzlePatterns.some((p: string) => initText.includes(p))) {
            // Add PascalCase version (e.g., users → Users)
            const pascalName = name.charAt(0).toUpperCase() + name.slice(1)
            names.add(pascalName)
            // Also add the raw name
            names.add(name)
          }
        }

        // Also check for type aliases that might be inferred from Drizzle
        if (node.getKindName() === 'TypeAliasDeclaration') {
          const name = node.getName?.()
          const typeText = node.getTypeNode?.()?.getText?.() || ''
          if (name && typeText.includes('typeof') &&
              drizzlePatterns.some((p: string) => typeText.includes(p))) {
            const pascalName = name.charAt(0).toUpperCase() + name.slice(1)
            names.add(pascalName)
            names.add(name)
          }
        }
      })
    } catch { /* skip files with traversal errors */ }
  }

  return names
}
