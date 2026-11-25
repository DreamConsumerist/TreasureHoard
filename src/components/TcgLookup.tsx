// Card / sealed lookup: game → set → product → sub-type (Normal, Foil…),
// with TCGplayer market prices from TCGCSV.

import { useMemo, useState } from 'react'
import { formatMoney } from '../../lib/ledger/money.ts'
import { GAME_LABELS } from '../lib/collection.ts'
import {
  useTcgGroups,
  useTcgProducts,
  type GameKey,
  type TcgProductOut,
} from '../lib/queries.ts'
import { Thumb } from './ItemList.tsx'

export interface TcgPick {
  game: GameKey
  categoryId: number
  groupId: number
  setName: string
  product: TcgProductOut
  subType: string
  marketCents: number | null
}

const CATEGORY_IDS: Record<GameKey, number> = {
  mtg: 1,
  onepiece: 68,
  riftbound: 89,
}
const MAX_RESULTS = 60

export function TcgLookup({
  sealed,
  onPick,
}: {
  /** Show sealed product (true) or individual cards (false) first. */
  sealed: boolean
  onPick: (pick: TcgPick) => void
}) {
  const [game, setGame] = useState<GameKey | null>(null)
  const [groupId, setGroupId] = useState<number | null>(null)
  const [setFilter, setSetFilter] = useState('')
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)
  const groups = useTcgGroups(game)
  const products = useTcgProducts(game, groupId)

  const visibleGroups = useMemo(() => {
    const f = setFilter.trim().toLowerCase()
    return (groups.data ?? []).filter(
      (g) =>
        !f ||
        g.name.toLowerCase().includes(f) ||
        g.abbreviation?.toLowerCase().includes(f),
    )
  }, [groups.data, setFilter])

  const matches = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return (products.data ?? []).filter(
      (p) =>
        (showAll || p.sealed === sealed) &&
        words.every(
          (w) =>
            p.name.toLowerCase().includes(w) ||
            p.number?.toLowerCase().includes(w),
        ),
    )
  }, [products.data, search, sealed, showAll])

  const setName = groups.data?.find((g) => g.groupId === groupId)?.name ?? ''

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(GAME_LABELS) as GameKey[]).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => {
              setGame(g)
              setGroupId(null)
            }}
            className={game === g ? 'btn-primary' : 'btn'}
          >
            {GAME_LABELS[g]}
          </button>
        ))}
      </div>

      {game && (
        <div className="space-y-1">
          <span className="label">Set</span>
          {groups.error && (
            <p className="text-sm text-red-600">{groups.error.message}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <input
              value={setFilter}
              onChange={(e) => setSetFilter(e.target.value)}
              placeholder="Filter sets"
              className="input max-w-[10rem]"
            />
            <select
              value={groupId ?? ''}
              onChange={(e) =>
                setGroupId(e.target.value ? Number(e.target.value) : null)
              }
              className="input min-w-0 flex-1"
              disabled={groups.isPending}
            >
              <option value="">
                {groups.isPending
                  ? 'Loading sets…'
                  : 'Choose a set (newest first)'}
              </option>
              {visibleGroups.map((g) => (
                <option key={g.groupId} value={g.groupId}>
                  {g.name}
                  {g.abbreviation ? ` (${g.abbreviation})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {game && groupId && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                sealed ? 'Search sealed product' : 'Search card name or number'
              }
              className="input flex-1"
              autoFocus
            />
            <label className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
              />
              Show {sealed ? 'cards' : 'sealed'} too
            </label>
          </div>
          {products.isPending && (
            <p className="text-sm text-zinc-500">Loading the set…</p>
          )}
          {products.error && (
            <p className="text-sm text-red-600">{products.error.message}</p>
          )}
          {products.data && (
            <>
              <ul className="max-h-96 divide-y divide-zinc-200 overflow-y-auto rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {matches.slice(0, MAX_RESULTS).map((p) => (
                  <li key={p.productId} className="flex items-center gap-3 p-2">
                    <Thumb src={p.imageUrl} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {p.name}
                      </span>
                      <span className="block truncate text-xs text-zinc-500">
                        {[p.number, p.rarity].filter(Boolean).join(' · ') ||
                          (p.sealed ? 'Sealed' : '')}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-wrap justify-end gap-1">
                      {(p.prices.length > 0
                        ? p.prices
                        : [
                            {
                              subType: 'Normal',
                              marketCents: null,
                              lowCents: null,
                            },
                          ]
                      ).map((price) => (
                        <button
                          key={price.subType}
                          type="button"
                          onClick={() =>
                            onPick({
                              game,
                              categoryId: CATEGORY_IDS[game],
                              groupId,
                              setName,
                              product: p,
                              subType: price.subType,
                              marketCents: price.marketCents,
                            })
                          }
                          className="btn px-2 py-1 text-xs"
                        >
                          {price.subType}{' '}
                          {price.marketCents === null
                            ? '—'
                            : formatMoney(price.marketCents)}
                        </button>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-zinc-500">
                {matches.length > MAX_RESULTS
                  ? `Showing ${MAX_RESULTS} of ${matches.length}. Type more to narrow it down.`
                  : `${matches.length} match${matches.length === 1 ? '' : 'es'}.`}{' '}
                Prices are TCGplayer market prices.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
