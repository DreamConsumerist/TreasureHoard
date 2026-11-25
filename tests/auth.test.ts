import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../lib/auth/password.ts'
import {
  createSessionToken,
  SESSION_MAX_AGE_SECONDS,
  verifySessionToken,
} from '../lib/auth/session.ts'

const SECRET = 'test-secret-that-is-long-enough-for-hmac'
const NOW = 1_800_000_000

describe('session tokens', () => {
  it('verifies a freshly created token', async () => {
    const token = await createSessionToken(SECRET, NOW)
    expect(await verifySessionToken(token, SECRET, NOW)).toBe(true)
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await createSessionToken('some-other-secret', NOW)
    expect(await verifySessionToken(token, SECRET, NOW)).toBe(false)
  })

  it('rejects a token whose expiry was tampered with', async () => {
    const token = await createSessionToken(SECRET, NOW)
    const [expiry, signature] = token.split('.')
    const extended = `${Number(expiry) + 999_999}.${signature}`
    expect(await verifySessionToken(extended, SECRET, NOW)).toBe(false)
  })

  it('rejects an expired token', async () => {
    const token = await createSessionToken(SECRET, NOW)
    const afterExpiry = NOW + SESSION_MAX_AGE_SECONDS + 1
    expect(await verifySessionToken(token, SECRET, afterExpiry)).toBe(false)
  })

  it('rejects malformed tokens', async () => {
    for (const bad of [
      '',
      'abc',
      '123',
      '123.',
      '.abc',
      'x.y',
      '1.2.3',
      '123.!!!',
    ]) {
      expect(await verifySessionToken(bad, SECRET, NOW)).toBe(false)
    }
  })
})

describe('password hashing', () => {
  it('accepts the correct password', async () => {
    const stored = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(
      true,
    )
  })

  it('rejects a wrong password', async () => {
    const stored = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('Correct horse battery staple', stored)).toBe(
      false,
    )
  })

  it('salts hashes, so the same password hashes differently', async () => {
    const a = await hashPassword('same password')
    const b = await hashPassword('same password')
    expect(a).not.toBe(b)
  })

  it('rejects malformed stored hashes', async () => {
    for (const bad of ['', 'plaintext', 'scrypt$1$2$3', 'bcrypt$a$b$c$d$e']) {
      expect(await verifyPassword('anything', bad)).toBe(false)
    }
  })
})
