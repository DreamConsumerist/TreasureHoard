// Password hashing with scrypt (Node built-in).
//
// scrypt is deliberately slow and memory-hungry, so guessing passwords from a
// leaked hash is expensive. The stored format records every parameter needed
// to re-check a password:
//
//   scrypt$<N>$<r>$<p>$<salt base64url>$<hash base64url>
//
// N = CPU/memory cost, r = block size, p = parallelism. The random salt makes
// every hash unique even for identical passwords.
//
// Node-only (node:crypto). Used by the API function and the hash script, never
// by the edge function.

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import type { ScryptOptions } from 'node:crypto'

const COST_N = 16384 // 2^14: ~16 MB of memory per hash
const BLOCK_SIZE_R = 8
const PARALLELISM_P = 1
const KEY_LENGTH = 64
const SALT_LENGTH = 16

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (err, key) =>
      err ? reject(err) : resolve(key),
    )
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const key = await scryptAsync(password, salt, KEY_LENGTH, {
    N: COST_N,
    r: BLOCK_SIZE_R,
    p: PARALLELISM_P,
  })
  return [
    'scrypt',
    COST_N,
    BLOCK_SIZE_R,
    PARALLELISM_P,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$')
}

/** True if `password` matches `stored`. A malformed `stored` never matches. */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const [, nText, rText, pText, saltText, keyText] = parts
  const N = Number(nText)
  const r = Number(rText)
  const p = Number(pText)
  // Sanity bounds so a corrupted setting can't make the server do huge work.
  if (!Number.isInteger(N) || N < 2 || N > 2 ** 20) return false
  if (!Number.isInteger(r) || r < 1 || r > 32) return false
  if (!Number.isInteger(p) || p < 1 || p > 16) return false

  const salt = Buffer.from(saltText, 'base64url')
  const expected = Buffer.from(keyText, 'base64url')
  if (salt.length === 0 || expected.length === 0) return false

  const actual = await scryptAsync(password, salt, expected.length, {
    N,
    r,
    p,
    maxmem: 256 * N * r,
  })
  // Constant-time comparison: timing doesn't reveal how many bytes matched.
  return timingSafeEqual(actual, expected)
}
