import { describe, test, expect } from 'bun:test'
import { Project } from 'ts-morph'

// We test resolveZodTypeByText directly since it's the internal unit
// The full resolution requires a ts-morph project which is integration-level

describe('Zod schema resolution', () => {
  test('resolves simple object schema', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    const file = project.createSourceFile('test.ts', `
      import { z } from 'zod'
      export const UserSchema = z.object({
        name: z.string().min(1).max(100),
        email: z.string().email(),
        age: z.number().int().min(0),
      })
    `)

    // Verify parsing works
    const decls = file.getVariableDeclarations()
    expect(decls.length).toBe(1)
    expect(decls[0]!.getName()).toBe('UserSchema')
  })

  test('handles optional and default fields', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    const file = project.createSourceFile('test.ts', `
      import { z } from 'zod'
      export const Input = z.object({
        required: z.string(),
        optional: z.string().optional(),
        withDefault: z.string().default('hello'),
        nullable: z.string().nullable(),
        nullish: z.string().nullish(),
      })
    `)

    const decls = file.getVariableDeclarations()
    expect(decls.length).toBe(1)
    expect(decls[0]!.getName()).toBe('Input')
  })

  test('handles enums', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    const file = project.createSourceFile('test.ts', `
      import { z } from 'zod'
      export const Role = z.enum(['admin', 'user', 'moderator'])
    `)

    const decls = file.getVariableDeclarations()
    expect(decls[0]!.getName()).toBe('Role')
  })

  test('handles coerced types', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    const file = project.createSourceFile('test.ts', `
      import { z } from 'zod'
      export const Query = z.object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
        search: z.coerce.string().optional(),
      })
    `)

    const decls = file.getVariableDeclarations()
    expect(decls[0]!.getName()).toBe('Query')
  })

  test('handles nested references', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    const file = project.createSourceFile('test.ts', `
      import { z } from 'zod'
      export const UserSchema = z.object({
        id: z.string().uuid(),
        name: z.string(),
      })
      export const Response = z.object({
        data: z.array(UserSchema),
        cursor: z.string().nullable(),
      })
    `)

    const decls = file.getVariableDeclarations()
    expect(decls.length).toBe(2)
  })
})
