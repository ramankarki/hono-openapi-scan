#!/usr/bin/env bun
import { Command } from 'commander'
import { writeFileSync, readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { loadConfig } from './config'
import { scan } from './scanner'

const program = new Command()

program
  .name('hono-openapi-scan')
  .description('Scan a Hono codebase and generate OpenAPI 3.1 spec')
  .version(getVersion())
  .argument('[entry]', 'Entry file path (overrides config entry)')
  .option('-c, --config <path>', 'Config file path (default: hono-openapi-scan.config.ts)')
  .action(async (entry, options) => {
    try {
      const config = await loadConfig(options.config)

      if (options.config) {
        const configDir = dirname(resolve(options.config))
        config.entry = resolve(configDir, entry || config.entry || 'src/index.ts')
      } else if (entry) {
        config.entry = entry
      }

      await scan(config)
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

program
  .command('init')
  .description('Create a default hono-openapi-scan.config.ts')
  .action(() => {
    const configContent = `import { defineConfig } from 'hono-openapi-scan'

export default defineConfig({
  info: {
    title: 'My API',
    // version: auto-reads from package.json
    // description: auto-reads from README.md
  },

  // servers: [
  //   { url: 'http://localhost:3000', description: 'Local' },
  // ],

  // security: [{ bearerAuth: [] }],
  // securitySchemes: {
  //   bearerAuth: {
  //     type: 'http',
  //     scheme: 'bearer',
  //     bearerFormat: 'JWT',
  //   },
  // },

  // tags: [
  //   { name: 'Users', description: 'User management' },
  // ],

  entry: 'src/index.ts',
  output: 'openapi.json',
})
`
    writeFileSync('hono-openapi-scan.config.ts', configContent)
    console.log('Created hono-openapi-scan.config.ts')
  })

program.parse()

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'))
    return pkg.version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}
