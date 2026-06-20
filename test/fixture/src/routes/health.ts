import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { ApiVersionHeaderSchema } from '../schemas'

const app = new Hono()
  .get('/health',
    /**
     * Health check.
     * @description Returns the current server status, current timestamp,
     *   and process uptime. Used by load balancers and monitoring tools
     *   to verify the service is operational. No authentication required.
     * @tags Health
     * @public
     */
    (c) => {
      return c.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      }, 200)
    }
  )
  .get('/system/info',
    zValidator('header', ApiVersionHeaderSchema),
    /**
     * System information.
     * @description Returns detailed system information. Respects the x-api-version
     *   header to return version-specific fields. Requires client identification
     *   via x-client-id header.
     * @tags Health
     * @public
     */
    (c) => {
      const headers = c.req.valid('header')
      return c.json({
        version: '1.0.0',
        environment: 'production',
        region: 'us-east-1',
        clientId: headers['x-client-id'] || 'unknown',
      }, 200)
    }
  )

export default app
