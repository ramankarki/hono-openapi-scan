import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'fs'

function loadSpec(path = 'test/fixture/openapi.json') {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

describe('openapi.json quality', () => {
  const spec = loadSpec()
  const schemas: Record<string, any> = spec.components?.schemas || {}
  const secSchemes = new Set(Object.keys(spec.components?.securitySchemes || {}))

  test('structure', () => {
    expect(spec.openapi).toBe('3.1.0')
    expect(spec.info.title).toBeTruthy()
    expect(spec.info.version).toBeTruthy()
  })

  test('every operation has operationId + summary + responses', () => {
    for (const [path, methods] of Object.entries(spec.paths as Record<string, any>)) {
      for (const [method, op] of Object.entries(methods as Record<string, any>)) {
        expect(op.operationId).toBeTruthy()
        expect(op.summary).toBeTruthy()
        expect(op.responses).toBeTruthy()
        // camelCase
        expect(op.operationId[0]).not.toBe(op.operationId[0]?.toUpperCase())
        // No hyphens
        expect(op.operationId).not.toContain('-')
      }
    }
  })

  test('no duplicate operationIds', () => {
    const ids = new Set<string>()
    for (const [, methods] of Object.entries(spec.paths as Record<string, any>)) {
      for (const [, op] of Object.entries(methods as Record<string, any>)) {
        expect(ids.has(op.operationId)).toBeFalse()
        ids.add(op.operationId)
      }
    }
  })

  test('parameters valid', () => {
    for (const [path, methods] of Object.entries(spec.paths as Record<string, any>)) {
      for (const [method, op] of Object.entries(methods as Record<string, any>)) {
        for (const p of (op.parameters || []) as any[]) {
          expect(p.name).toBeTruthy()
          expect(['path', 'query', 'header', 'cookie']).toContain(p.in)
          if (p.in === 'path') expect(p.required).toBeTrue()
          expect(p.name).not.toMatch(/^['"]/)
        }
      }
    }
  })

  test('request body has schema', () => {
    for (const [path, methods] of Object.entries(spec.paths as Record<string, any>)) {
      for (const [method, op] of Object.entries(methods as Record<string, any>)) {
        for (const body of Object.values((op.requestBody?.content || {}) as Record<string, any>)) {
          expect((body as any).schema).toBeTruthy()
        }
      }
    }
  })

  test('responses valid', () => {
    for (const [path, methods] of Object.entries(spec.paths as Record<string, any>)) {
      for (const [method, op] of Object.entries(methods as Record<string, any>)) {
        for (const [code, resp] of Object.entries(op.responses as Record<string, any>)) {
          const r = resp as any
          expect(r.description).toBeTruthy()
          
          if (code.startsWith('2')) {
            expect(r.content).toBeTruthy()
            for (const s of Object.values(r.content as Record<string, any>)) {
              const schema = (s as any).schema || {}
              // No Zod internals
              const str = JSON.stringify(schema)
              expect(str).not.toContain('_def')
              expect(str).not.toContain('~standard')
              expect(str).not.toContain('safeParseAsync')
              // $ref targets exist
              if (schema.$ref) {
                const name = schema.$ref.replace('#/components/schemas/', '')
                expect(schemas[name]).toBeTruthy()
              }
            }
          }
          
          // Error responses use $ref
          if (['400','401','403','404','409','429','500'].includes(code)) {
            for (const s of Object.values(r.content?.['application/json'] ? {json: r.content['application/json']} : {})) {
              expect((s as any).schema?.$ref).toBeTruthy()
            }
          }
        }
      }
    }
  })

  test('security schemes valid', () => {
    for (const [, methods] of Object.entries(spec.paths as Record<string, any>)) {
      for (const [, op] of Object.entries(methods as Record<string, any>)) {
        for (const sec of (op.security || []) as any[]) {
          for (const k of Object.keys(sec)) {
            expect(secSchemes.has(k)).toBeTrue()
          }
        }
      }
    }
  })

  test('component schemas valid', () => {
    for (const [name, s] of Object.entries(schemas)) {
      for (const [pname, prop] of Object.entries((s as any).properties || {})) {
        const p = prop as any
        if (p.$ref) continue
        // Must have type or const
        expect('type' in p || 'const' in p).toBeTrue()
      }
    }
  })

  test('Drizzle readOnly', () => {
    for (const name of ['Users', 'Posts']) {
      if (schemas[name]) {
        for (const key of ['id', 'createdAt', 'updatedAt']) {
          if (schemas[name].properties?.[key]) {
            expect(schemas[name].properties[key].readOnly).toBeTrue()
          }
        }
      }
    }
  })

  test('tag consistency', () => {
    const tagNames = new Set((spec.tags as any[])?.map(t => t.name) || [])
    for (const [, methods] of Object.entries(spec.paths as Record<string, any>)) {
      for (const [, op] of Object.entries(methods as Record<string, any>)) {
        for (const t of (op.tags || []) as string[]) {
          expect(tagNames.has(t)).toBeTrue()
        }
      }
    }
  })

  test('path naming', () => {
    for (const path of Object.keys(spec.paths)) {
      if (path !== '/') expect(path).not.toEndWith('/')
      expect(path).not.toContain('//')
    }
  })
})
