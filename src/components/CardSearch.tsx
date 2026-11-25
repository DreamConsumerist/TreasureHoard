// Find a card (or sealed product) by name across every set of a game, using
// the card search index. Each result is one printing, shown with its picture,
// set, collector number and rarity, so the exact printing is picked by sight.
// Used by Add item and the decklist import's review screen.

import { useState } from 'react'
import type { CatalogHit } from '../../lib/collection/types.ts'
import { useDebounced } from '../lib/hooks.ts'
import {
  useCatalogSearch,
  usePriceStatus,
  useStartSync,
  type GameKey,
} from '../lib/queries.ts'
import { Thumb } from './ItemList.tsx'

export function CardSearch({
  game,
  sealed,
  onChoose,
  initialQuery = '',
  autoFocus = false,
  chosenId,
}: {
  game: GameKey
  /** Only cards (false) or only sealed (true); undefined = both. */
  sealed?: boolean
  onChoose: (hit: CatalogHit) => void
  initialQuery?: string
  autoFocus?: boolean
  /** Highlights the chosen result. */
  chosenId?: number
}) {
  const [q, setQ] = useState(initialQuery)
  const debounced = useDebounced(q.trim())
  const search = useCatalogSearch(game, debounced, sealed)
  const status = usePriceStatus()
  const build = useStartSync()
  const catalog = status.data?.find((s) => s.job === 'catalog')
  const building = catalog?.last?.status === 'running'

  return (
    <div className="space-y-2">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={
          sealed ? 'Search sealed product by name' : 'Search by card name'
        }
        className="input"
        autoFocus={autoFocus}
      />

      {search.data && !search.data.indexed && (
        <div className="rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-800">
          {building ? (
            <>
              Building the card search index… The first build takes about 5
              minutes. Browse by set in the meantime.
            </>
          ) : (
            <>
              <p>
                Searching by name needs the card search index, a copy of every
                set's card list. It isn't built yet.
              </p>
              <button
                type="button"
                className="btn-primary mt-2"
                disabled={build.isPending}
                onClick={() => build.mutate('catalog')}
              >
                Build it now (about 5 minutes)
              </button>
              {build.error && (
                <p className="mt-1 text-red-600">{build.error.message}</p>
              )}
            </>
          )}
        </div>
      )}
      {search.error && (
        <p className="text-sm text-red-600">{search.error.message}</p>
      )}

      {search.data?.indexed && debounced.length >= 2 && (
        <>
          <ul className="max-h-96 divide-y divide-zinc-200 overflow-y-auto rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {search.data.results.map((hit) => (
              <li key={hit.productId}>
                <button
                  type="button"
                  onClick={() => onChoose(hit)}
                  className={`flex w-full items-center gap-3 p-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                    chosenId === hit.productId
                      ? 'bg-zinc-100 dark:bg-zinc-800'
                      : ''
                  }`}
                >
                  <Thumb src={hit.imageUrl} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {hit.name}
                    </span>
                    <span className="block truncate text-xs text-zinc-500">
                      {hit.setName}
                      {hit.setCode ? ` (${hit.setCode})` : ''}
                      {hit.number ? ` · #${hit.number}` : ''}
                      {hit.rarity ? ` · ${hit.rarity}` : ''}
                      {hit.publishedOn
                        ? ` · ${hit.publishedOn.slice(0, 4)}`
                        : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-zinc-500">
            {search.data.results.length === 0
              ? 'No matches. New sets appear within a week of release.'
              : search.data.results.length >= 60
                ? 'Showing the first 60. Type more of the name to narrow it down.'
                : `${search.data.results.length} printing${search.data.results.length === 1 ? '' : 's'}.`}
          </p>
        </>
      )}
    </div>
  )
}
