// The REST API: every /api/* request lands in this one function, and Hono
// routes it to the matching handler.
//
// Auth is checked twice: first by the edge function (netlify/edge-functions/
// auth.ts) before this function even starts, then again by the middleware
// below. The second check is cheap insurance in case the edge function's
// route config ever drifts or fails to deploy.

import type { Config } from '@netlify/functions'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { db } from '../../db/index.ts'
import { verifyPassword } from '../../lib/auth/password.ts'
import {
  createSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  verifySessionToken,
} from '../../lib/auth/session.ts'

const FAILED_LOGIN_DELAY_MS = 1000

const app = new Hono().basePath('/api')

// --- Auth middleware: everything except /api/login needs a valid session ---
app.use('*', async (c, next) => {
  if (c.req.path === '/api/login') return next()
  const secret = process.env.SESSION_SECRET
  const token = getCookie(c, SESSION_COOKIE)
  if (secret && token && (await verifySessionToken(token, secret))) {
    return next()
  }
  return c.json({ error: 'Unauthorized' }, 401)
})

// --- POST /api/login  { password } → sets the session cookie ---
app.post('/login', async (c) => {
  const passwordHash = process.env.APP_PASSWORD_HASH
  const secret = process.env.SESSION_SECRET
  if (!passwordHash || !secret) {
    return c.json(
      { error: 'Server is missing APP_PASSWORD_HASH or SESSION_SECRET' },
      500,
    )
  }

  const body: unknown = await c.req.json().catch(() => null)
  const password =
    typeof body === 'object' &&
    body !== null &&
    'password' in body &&
    typeof body.password === 'string'
      ? body.password
      : ''

  if (!(await verifyPassword(password, passwordHash))) {
    // Slows down password guessing.
    await new Promise((resolve) => setTimeout(resolve, FAILED_LOGIN_DELAY_MS))
    return c.json({ error: 'Incorrect password' }, 401)
  }

  setCookie(c, SESSION_COOKIE, await createSessionToken(secret), {
    httpOnly: true, // page JavaScript can't read it
    secure: true, // only sent over HTTPS (browsers allow localhost)
    sameSite: 'Strict', // never sent on requests started by other sites
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
  return c.json({ ok: true })
})

// --- POST /api/logout → clears the session cookie ---
app.post('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true })
  return c.json({ ok: true })
})

// --- GET /api/health → proves the database is reachable ---
app.get('/health', async (c) => {
  try {
    await db.execute(sql`select 1`)
    return c.json({ db: 'ok' })
  } catch (err) {
    console.error('Health check failed:', err)
    return c.json({ db: 'error' }, 503)
  }
})

// Netlify functions and Hono both speak web-standard Request/Response.
export default (req: Request) => app.fetch(req)

export const config: Config = {
  path: '/api/*',
}
