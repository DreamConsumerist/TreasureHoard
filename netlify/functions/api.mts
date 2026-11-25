// The REST API entry point: every /api/* request lands in this one function.
// The routes themselves live in lib/api/app.ts, built around an injected
// database so tests can run them against an in-memory Postgres.

import type { Config } from '@netlify/functions'
import { db } from '../../db/index.ts'
import { createApp } from '../../lib/api/app.ts'

const app = createApp(db)

// Netlify functions and Hono both speak web-standard Request/Response.
export default (req: Request) => app.fetch(req)

export const config: Config = {
  path: '/api/*',
}
