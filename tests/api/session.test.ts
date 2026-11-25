// Sliding sessions: a valid session over a week old is renewed on the next API
// request; a newer one isn't; an expired one is still refused.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  shouldRenewSession,
  verifySessionToken,
} from '../../lib/auth/session.ts'
import { createTestApi } from './harness.ts'

const DAY = 24 * 60 * 60
const now = () => Math.floor(Date.now() / 1000)

describe('shouldRenewSession', () => {
  it('renews only tokens issued more than 7 days ago', async () => {
    const secret = 'x'.repeat(40)
    const t = now()
    expect(shouldRenewSession(await createSessionToken(secret, t), t)).toBe(
      false,
    )
    expect(
      shouldRenewSession(await createSessionToken(secret, t - 6 * DAY), t),
    ).toBe(false)
    expect(
      shouldRenewSession(await createSessionToken(secret, t - 8 * DAY), t),
    ).toBe(true)
  })
})

describe('session renewal in the API', () => {
  let api: Awaited<ReturnType<typeof createTestApi>>
  beforeAll(async () => {
    api = await createTestApi()
  })
  afterAll(() => api.close())

  const request = async (issuedAt: number) => {
    const token = await createSessionToken(
      process.env.SESSION_SECRET!,
      issuedAt,
    )
    return api.app.request('/api/accounts', {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    })
  }

  it('hands a session over a week old a fresh 30-day cookie', async () => {
    const res = await request(now() - 10 * DAY)
    expect(res.status).toBe(200)
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`)
    expect(cookie).toMatch(/HttpOnly/i)
    const token = cookie.split(';')[0]!.split('=')[1]!
    expect(await verifySessionToken(token, process.env.SESSION_SECRET!)).toBe(
      true,
    )
    expect(shouldRenewSession(token)).toBe(false)
  })

  it('leaves a recent session alone', async () => {
    const res = await request(now() - DAY)
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('still refuses an expired session', async () => {
    const res = await request(now() - 31 * DAY)
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
  })
})
