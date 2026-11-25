// The key that lets the API and the scheduled function start the price-sync
// background function. Background functions can be called by URL from
// anywhere (the edge auth only covers /api/*), so the function refuses any
// request without this key in its `x-sync-key` header.
//
// The key is derived from SESSION_SECRET (HMAC-SHA256 over a fixed label), so
// there's no extra environment variable to set. The derived value can't be
// turned back into SESSION_SECRET, so leaking it can't forge a login.
//
// Web-standard APIs only (Web Crypto), like lib/auth/session.ts.

export const SYNC_KEY_HEADER = 'x-sync-key'
const LABEL = 'price-sync'

const encoder = new TextEncoder()

export async function deriveSyncKey(sessionSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(sessionSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(LABEL)),
  )
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** True if `given` is the key for this secret. Compares in constant time. */
export async function checkSyncKey(
  sessionSecret: string,
  given: string | null,
): Promise<boolean> {
  if (!given) return false
  const expected = await deriveSyncKey(sessionSecret)
  if (given.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++)
    diff |= expected.charCodeAt(i) ^ given.charCodeAt(i)
  return diff === 0
}
