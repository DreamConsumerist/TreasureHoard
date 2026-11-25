// Starting the price-sync background function over HTTP. Used by the API
// ("Refresh now") and the scheduled function. Background functions answer
// 202 straight away and keep running for up to 15 minutes.

import { deriveSyncKey, SYNC_KEY_HEADER } from './syncKey.ts'

export const BACKGROUND_PATH = '/.netlify/functions/price-sync-background'

/** Asks the background function to execute the given runs. Throws if it doesn't accept. */
export async function triggerBackground(
  fetchFn: typeof fetch,
  origin: string,
  sessionSecret: string,
  runIds: number[],
): Promise<void> {
  const res = await fetchFn(new URL(BACKGROUND_PATH, origin), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [SYNC_KEY_HEADER]: await deriveSyncKey(sessionSecret),
    },
    body: JSON.stringify({ runIds }),
  })
  if (!res.ok) throw new Error(`The price-sync function answered ${res.status}`)
}
