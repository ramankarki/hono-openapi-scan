import type { OpenAPIV3_1 } from 'openapi-types'

export interface ScanConfig {
  /** Entry file path. Defaults to 'src/index.ts'. */
  entry?: string
  /** Output file path. Defaults to 'openapi.json'. */
  output?: string
  /** API metadata. title defaults to package.json#name if not set. */
  info?: {
    title?: string
    version?: string
    description?: string
  }
  servers?: Array<{ url: string; description?: string }>
  security?: Array<Record<string, string[]>>
  securitySchemes?: Record<string, OpenAPIV3_1.SecuritySchemeObject>
  tags?: Array<{ name: string; description?: string }>
  /** Custom error response schema. Import your Zod object and pass it directly — no strings. Omit for built-in Stripe-style. */
  errorSchema?: Record<string, any>
  /** Auto-generated error responses. true (all), false (none), or array of status codes. Defaults to true. */
  defaultErrorResponses?: boolean | number[]
  /** Paths that skip global auth even without @public. Supports glob patterns. */
  excludeAuth?: string[]
  openapi?: '3.1.0'
}

export interface RouteInfo {
  method: string
  path: string
  fullPath: string
  middleware: MiddlewareInfo[]
  handler: HandlerInfo | null
  jsdoc: JSDocInfo
  security?: Array<Record<string, string[]>>
  tags: string[]
  operationId: string
  summary: string
  description?: string
  deprecated: boolean
  hidden: boolean
  sourceFile: string
}

export interface MiddlewareInfo {
  type: 'zValidator' | 'auth' | 'unknown'
  target?: 'param' | 'query' | 'json' | 'form' | 'header' | 'cookie'
  schema?: ZodSchemaInfo
  sourceFile?: string
}

export interface HandlerInfo {
  name?: string
  returnType?: string
  responses: ResponseInfo[]
  sourceFile: string
}

export interface ResponseInfo {
  status: number
  description: string
  contentType: string
  schema?: SchemaRef
  example?: unknown
}

export interface ZodSchemaInfo {
  name?: string
  exportName?: string
  sourceFile: string
  schema: Record<string, unknown>
  isExported: boolean
}

export interface DrizzleTableInfo {
  tableName: string
  exportName: string
  sourceFile: string
  columns: DrizzleColumnInfo[]
}

export interface DrizzleColumnInfo {
  name: string
  type: string
  format?: string
  nullable: boolean
  hasDefault: boolean
  isPrimaryKey: boolean
  isUnique: boolean
  isReadOnly: boolean
  description?: string
  enumValues?: string[]
  maxLength?: number
}

export interface SchemaRef {
  $ref?: string
  type?: string
  properties?: Record<string, unknown>
  items?: SchemaRef
  required?: string[]
  nullable?: boolean
  enum?: string[]
  format?: string
  description?: string
  example?: unknown
  default?: unknown
  readOnly?: boolean
  writeOnly?: boolean
  deprecated?: boolean
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  pattern?: string
  oneOf?: SchemaRef[]
  additionalProperties?: SchemaRef
}

export interface JSDocInfo {
  summary?: string
  description?: string
  tags: string[]
  isPublic: boolean
  security?: string[]
  deprecated: boolean
  hidden: boolean
  operationId?: string
  returns?: string
  errors: ErrorAnnotation[]
  params: ParamAnnotation[]
}

export interface ErrorAnnotation {
  status: number
}

export interface ParamAnnotation {
  name: string
  description?: string
}

export interface AssembledSpec {
  openapi: string
  info: OpenAPIV3_1.InfoObject
  servers?: OpenAPIV3_1.ServerObject[]
  tags?: OpenAPIV3_1.TagObject[]
  paths: Record<string, Record<string, OpenAPIV3_1.OperationObject>>
  components?: {
    schemas?: Record<string, OpenAPIV3_1.SchemaObject>
    securitySchemes?: Record<string, OpenAPIV3_1.SecuritySchemeObject>
  }
  security?: Array<Record<string, string[]>>
}
