// Test harness: the real API app on a fresh in-memory Postgres (PGlite), with
// the real migrations applied, plus a helper that sends authenticated requests.

import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import * as schema from '../../db/schema.ts'
import { createApp } from '../../lib/api/app.ts'
import { createSessionToken, SESSION_COOKIE } from '../../lib/auth/session.ts'

const SECRET = 'test-secret-that-is-long-enough-for-hmac'

export async function createTestApi() {
  process.env.SESSION_SECRET = SECRET
  const client = new PGlite()
  const db = drizzle({ client, schema })
  await migrate(db, { migrationsFolder: 'netlify/database/migrations' })
  const app = createApp(db)
  const cookie = `${SESSION_COOKIE}=${await createSessionToken(SECRET)}`

  /** Sends a request as a logged-in user; returns status and parsed JSON body. */
  async function call<T = any>(method: string, path: string, body?: unknown) {
    const res = await app.request(`/api${path}`, {
      method,
      headers: { cookie, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, body: (await res.json()) as T }
  }

  return { app, db, client, call, close: () => client.close() }
}
