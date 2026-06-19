import { Hono } from 'hono'

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

export default app
