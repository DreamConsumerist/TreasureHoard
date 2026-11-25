// The REST API as a Hono app, built around an injected database.
//
// netlify/functions/api.mts calls createApp(db) with the real Netlify database;
// tests call it with an in-memory PGlite database. Everything else is
// identical, so the tests exercise the real routes, validation and SQL.
//
// Auth is checked twice: first by the edge function (netlify/edge-functions/
// auth.ts) before the API function even starts, then again by the middleware
// below. The second check is cheap insurance in case the edge function's
// route config ever drifts or fails to deploy.

import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Db } from '../../db/types.ts'
import { verifyPassword } from '../auth/password.ts'
import {
  createSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  verifySessionToken,
} from '../auth/session.ts'
import { catalogRoutes } from './collection/catalog.ts'
import { checkRoutes } from './collection/check.ts'
import { itemRoutes } from './collection/items.ts'
import { handleError } from './errors.ts'
import { accountRoutes } from './ledger/accounts.ts'
import { dashboardRoutes } from './ledger/dashboard.ts'
import { transactionRoutes } from './ledger/transactions.ts'

const FAILED_LOGIN_DELAY_MS = 1000

/** Things the app reaches outside itself for; tests pass fakes. */
export interface AppDeps {
  fetch?: typeof fetch
}

export function createApp(db: Db, deps: AppDeps = {}) {
  const fetchFn = deps.fetch ?? fetch
  const app = new Hono().basePath('/api')
  app.onError(handleError)

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

  // --- Ledger ---
  app.route('/accounts', accountRoutes(db))
  app.route('/transactions', transactionRoutes(db))
  app.route('/dashboard', dashboardRoutes(db))

  // --- Collection ---
  app.route('/catalog', catalogRoutes(fetchFn))
  app.route('/items', itemRoutes(db))
  app.route('/collection', checkRoutes(db))

  return app
}
