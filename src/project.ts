import { Project, type SourceFile } from 'ts-morph'
import { existsSync } from 'fs'
import { resolve, dirname } from 'path'

export function createProject(entryPath: string): {
  project: Project
  entryFile: SourceFile
  files: SourceFile[]
} {
  const absEntry = resolve(entryPath)

  if (!existsSync(absEntry)) {
    throw new Error(`Entry file not found: ${absEntry}`)
  }

  const tsConfig = findTsConfig(dirname(absEntry))

  const project = new Project({
    tsConfigFilePath: tsConfig,
    skipAddingFilesFromTsConfig: false,
  })

  const entryFile = project.addSourceFileAtPath(absEntry)
  const allFiles = resolveImportTree(project, entryFile)

  return { project, entryFile, files: allFiles }
}

function findTsConfig(dir: string): string | undefined {
  const path = resolve(dir, 'tsconfig.json')
  if (existsSync(path)) return path
  const parent = resolve(dir, '..')
  if (parent === dir) return undefined
  return findTsConfig(parent)
}

function resolveImportTree(project: Project, startFile: SourceFile): SourceFile[] {
  const visited = new Set<string>()
  const queue: SourceFile[] = [startFile]
  const result: SourceFile[] = []

  while (queue.length > 0) {
    const file = queue.shift()!
    const filePath = file.getFilePath()

    if (visited.has(filePath)) continue
    visited.add(filePath)
    result.push(file)

    for (const imp of file.getImportDeclarations()) {
      try {
        const resolved = imp.getModuleSpecifierSourceFile()
        if (resolved && !visited.has(resolved.getFilePath())) {
          queue.push(resolved)
        }
      } catch {
        // Skip unresolvable imports
      }
    }
  }

  return result
}
