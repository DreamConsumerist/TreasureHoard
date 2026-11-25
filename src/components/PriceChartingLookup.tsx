// Game / hardware lookup: paste a PriceCharting product link, look it up once,
// then pick loose / CIB / new.

import { useState, type FormEvent } from 'react'
import { formatMoney } from '../../lib/ledger/money.ts'
import { VARIANT_LABELS } from '../lib/collection.ts'
import { usePriceChartingLookup } from '../lib/queries.ts'

export interface PriceChartingPick {
  url: string
  name: string
  platform: string
  variant: 'loose' | 'cib' | 'new'
  priceCents: number | null
  imageUrl: string | null
}

export function PriceChartingLookup({
  onPick,
}: {
  onPick: (pick: PriceChartingPick) => void
}) {
  const [url, setUrl] = useState('')
  const lookup = usePriceChartingLookup()

  function submit(e: FormEvent) {
    e.preventDefault()
    if (url.trim()) lookup.mutate(url.trim())
  }

  return (
    <div className="space-y-3">
      {/* Its own small form, so Enter looks up instead of submitting the outer form. */}
      <form onSubmit={submit} className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.pricecharting.com/game/…"
          className="input flex-1"
        />
        <button
          type="submit"
          disabled={lookup.isPending || !url.trim()}
          className="btn-primary"
        >
          {lookup.isPending ? 'Looking up…' : 'Look up'}
        </button>
      </form>
      <p className="text-xs text-zinc-500">
        Find the item on pricecharting.com and paste its page link here.
      </p>
      {lookup.error && (
        <p className="text-sm text-red-600">{lookup.error.message}</p>
      )}
      {lookup.data && (
        <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="font-medium">{lookup.data.name}</div>
          <div className="mb-2 text-sm text-zinc-500">
            {lookup.data.platform}
          </div>
          <div className="flex flex-wrap gap-2">
            {(['loose', 'cib', 'new'] as const).map((variant) => {
              const price = lookup.data.prices[variant]
              return (
                <button
                  key={variant}
                  type="button"
                  onClick={() =>
                    onPick({
                      url: lookup.data.url,
                      name: lookup.data.name,
                      platform: lookup.data.platform,
                      variant,
                      priceCents: price,
                      imageUrl: lookup.data.imageUrl,
                    })
                  }
                  className="btn"
                >
                  {VARIANT_LABELS[variant]}:{' '}
                  {price === null ? '—' : formatMoney(price)}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
