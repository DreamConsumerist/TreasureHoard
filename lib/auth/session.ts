// Session tokens: a signed expiry timestamp.
//
//   token = "<expiresAtUnixSeconds>.<base64url HMAC-SHA256 signature>"
//
// The signature proves the server issued the token (only it knows
// SESSION_SECRET), and the timestamp limits how long it's valid. Nothing is
// stored server-side, so verification needs no database.
//
// Uses only web-standard APIs (Web Crypto, TextEncoder, btoa/atob) so the same
// code runs in Node (functions, tests) and Deno (edge functions).

export const SESSION_COOKIE = 'session'
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60 // 30 days
/**
 * Sliding sessions: a valid token older than this is replaced by a fresh
 * 30-day one on the next API request (lib/api/app.ts). Used at least weekly,
 * you stay logged in; left alone for 30 days, you're logged out.
 */
export const SESSION_RENEW_AFTER_SECONDS = 7 * 24 * 60 * 60 // 7 days

const encoder = new TextEncoder()

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function importHmacKey(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

/** Creates a token that expires SESSION_MAX_AGE_SECONDS after `now`. */
export async function createSessionToken(
  secret: string,
  now: number = nowSeconds(),
): Promise<string> {
  const payload = String(now + SESSION_MAX_AGE_SECONDS)
  const key = await importHmacKey(secret)
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(payload),
  )
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`
}

/** True only if the token was signed with `secret` and hasn't expired. */
export async function verifySessionToken(
  token: string,
  secret: string,
  now: number = nowSeconds(),
): Promise<boolean> {
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [payload, signatureText] = parts
  if (!/^\d+$/.test(payload)) return false

  const signature = fromBase64Url(signatureText)
  if (!signature) return false

  // crypto.subtle.verify compares in constant time, so response timing
  // doesn't leak how much of a forged signature was correct.
  const key = await importHmacKey(secret)
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    signature,
    encoder.encode(payload),
  )
  return valid && Number(payload) > now
}

/**
 * True if a token (already verified) is old enough to be replaced: more than
 * SESSION_RENEW_AFTER_SECONDS since it was issued. The token stores only its
 * expiry, and every token lasts SESSION_MAX_AGE_SECONDS, so its issue time is
 * expiry − max age.
 */
export function shouldRenewSession(
  token: string,
  now: number = nowSeconds(),
): boolean {
  const expiresAt = Number(token.split('.')[0])
  if (!Number.isFinite(expiresAt)) return false
  return (
    expiresAt - SESSION_MAX_AGE_SECONDS + SESSION_RENEW_AFTER_SECONDS <= now
  )
}
