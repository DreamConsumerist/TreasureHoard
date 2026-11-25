import { describe, expect, it } from 'vitest'
import { checkSyncKey, deriveSyncKey } from '../../lib/pricing/syncKey.ts'

describe('sync key', () => {
  it('is derived deterministically and differs per secret', async () => {
    const a = await deriveSyncKey('secret-one')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(await deriveSyncKey('secret-one')).toBe(a)
    expect(await deriveSyncKey('secret-two')).not.toBe(a)
  })

  it('accepts only the right key', async () => {
    const key = await deriveSyncKey('secret-one')
    expect(await checkSyncKey('secret-one', key)).toBe(true)
    expect(await checkSyncKey('secret-two', key)).toBe(false)
    expect(await checkSyncKey('secret-one', key.slice(1))).toBe(false)
    expect(await checkSyncKey('secret-one', null)).toBe(false)
    expect(await checkSyncKey('secret-one', '')).toBe(false)
  })
})
