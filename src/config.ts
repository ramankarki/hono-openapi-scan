import { readFileSync, existsSync } from 'fs'
import type { ScanConfig } from './types'

const DEFAULTS = {
  entry: 'src/index.ts',
  output: 'openapi.json',
  servers: [{ url: 'http://localhost:3000', description: 'Local' }] as ScanConfig['servers'],
  security: [] as ScanConfig['security'],
  openapi: '3.1.0' as const,
  defaultErrorResponses: true as const,
}

/** Identity function for type-safe config. */
export function defineConfig(config: ScanConfig): ScanConfig {
  return config
}

export async function loadConfig(configPath?: string): Promise<ScanConfig> {
  let userConfig: Partial<ScanConfig> = {}
  const cwd = process.cwd()

  const pathsToTry: string[] = []
  if (configPath) {
    // Resolve relative paths to absolute
    const abs = configPath.startsWith('/') ? configPath : `${cwd}/${configPath}`
    pathsToTry.push(abs, configPath)
  } else {
    pathsToTry.push(
      `${cwd}/hono-openapi-scan.config.ts`,
      `${cwd}/hono-openapi-scan.config.js`,
      `${cwd}/openapi.config.ts`,
      `${cwd}/openapi.config.js`,
    )
  }

  for (const path of pathsToTry) {
    try {
      const mod = await import(path)
      userConfig = mod.default ?? mod.config ?? {}
      break
    } catch {
      // Try next path
    }
  }

  // Merge with defaults
  const merged: ScanConfig = { ...DEFAULTS, ...userConfig }

  // info.title defaults to package.json#name
  if (!merged.info?.title) {
    try {
      const pkgPath = `${cwd}/package.json`
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
        merged.info = { ...merged.info, title: pkg.name || 'API' }
      }
    } catch { /* ignore */ }
  }
  if (!merged.info?.title) merged.info = { ...merged.info, title: 'API' }

  // version defaults to package.json#version
  if (!merged.info?.version) {
    try {
      const pkgPath = `${cwd}/package.json`
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
        if (pkg.version) merged.info = { ...merged.info, version: pkg.version }
      }
    } catch { /* ignore */ }
  }
  if (!merged.info?.version) merged.info = { ...merged.info, version: '0.0.0' }

  // description defaults to first paragraph of README.md
  if (!merged.info?.description) {
    try {
      const readmePath = `${cwd}/README.md`
      if (existsSync(readmePath)) {
        const readme = readFileSync(readmePath, 'utf-8')
        // Use first paragraph after the title
        const lines = readme.split('\n')
        let foundTitle = false
        for (const line of lines) {
          if (!foundTitle && line.startsWith('# ')) { foundTitle = true; continue }
          if (foundTitle && line.trim() && !line.startsWith('#') && !line.startsWith('[') && !line.startsWith('!')) {
            merged.info.description = line.trim()
            break
          }
        }
      }
    } catch { /* ignore */ }
  }

  return merged
}
