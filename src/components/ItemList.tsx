// Collection items, as a grid of tiles or as compact rows.

import { Link } from 'react-router'
import { formatMoney } from '../../lib/ledger/money.ts'
import {
  KIND_SINGULAR,
  itemGain,
  itemSubtitle,
  itemValue,
} from '../lib/collection.ts'
import type { ItemOut } from '../lib/queries.ts'
import { Amount } from './Amount.tsx'

export function Thumb({
  src,
  size = 'h-12 w-9',
}: {
  src: string | null | undefined
  size?: string
}) {
  return src ? (
    <img
      src={src}
      alt=""
      loading="lazy"
      className={`${size} shrink-0 rounded object-cover`}
    />
  ) : (
    <span className={`${size} shrink-0 rounded bg-zinc-200 dark:bg-zinc-800`} />
  )
}

export function GainBadge({ cents }: { cents: number | null }) {
  if (cents === null)
    return <span className="text-xs text-zinc-500">no price</span>
  const color =
    cents > 0
      ? 'text-green-700 dark:text-green-400'
      : cents < 0
        ? 'text-red-600 dark:text-red-400'
        : 'text-zinc-500'
  return (
    <span className={`text-xs tabular-nums ${color}`}>
      {cents > 0 ? '+' : cents < 0 ? '−' : ''}
      {formatMoney(Math.abs(cents))}
    </span>
  )
}

export type ItemView = 'tiles' | 'list'

export function ItemList({
  items,
  empty,
  view,
}: {
  items: ItemOut[]
  empty: string
  view: ItemView
}) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-zinc-500">{empty}</p>
  }
  return view === 'tiles' ? (
    <ItemTiles items={items} />
  ) : (
    <ItemRows items={items} />
  )
}

/** Grid of tiles: image on top, then name, value and gain. */
function ItemTiles({ items }: { items: ItemOut[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {items.map((item) => {
        const sold = item.soldDate !== null
        const value = sold ? item.saleProceedsCents : itemValue(item)
        const image = item.card?.imageUrl ?? item.game?.imageUrl
        return (
          <li key={item.id}>
            <Link
              to={`/collection/${item.id}`}
              className="group flex h-full flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
            >
              <span className="relative block aspect-[5/7] bg-zinc-100 dark:bg-zinc-800">
                {image ? (
                  <img
                    src={image}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-contain p-2"
                  />
                ) : (
                  // No image (an unlisted or manually priced item): show what it is.
                  <span className="flex h-full flex-col items-center justify-center gap-1 p-3 text-center">
                    <span className="text-xs tracking-wide text-zinc-500 uppercase">
                      {KIND_SINGULAR[item.kind]}
                    </span>
                    <span className="line-clamp-3 text-sm font-medium text-zinc-600 dark:text-zinc-300">
                      {item.game?.platform ?? item.name}
                    </span>
                  </span>
                )}
                {item.quantity > 1 && (
                  <span className="absolute top-2 right-2 rounded-full bg-zinc-900/80 px-2 py-0.5 text-xs font-medium text-white">
                    ×{item.quantity}
                  </span>
                )}
              </span>
              <span className="flex flex-1 flex-col gap-0.5 p-2">
                <span className="line-clamp-2 text-sm leading-snug font-medium">
                  {item.name}
                </span>
                <span className="truncate text-xs text-zinc-500">
                  {itemSubtitle(item)}
                </span>
                <span className="mt-auto flex items-baseline justify-between gap-2 pt-1">
                  {value === null ? (
                    <span className="text-sm text-zinc-500">—</span>
                  ) : (
                    <Amount cents={value} className="text-sm font-medium" />
                  )}
                  <GainBadge cents={itemGain(item)} />
                </span>
                {!sold && item.basisSource === 'baseline' && (
                  <span className="text-right text-[11px] text-zinc-500">
                    gain since added
                  </span>
                )}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

/** Compact rows: thumbnail, name and subtitle, value and gain on the right. */
function ItemRows({ items }: { items: ItemOut[] }) {
  return (
    <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
      {items.map((item) => {
        const sold = item.soldDate !== null
        const value = sold ? item.saleProceedsCents : itemValue(item)
        return (
          <li key={item.id}>
            <Link
              to={`/collection/${item.id}`}
              className="flex items-center gap-3 px-1 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              <Thumb src={item.card?.imageUrl ?? item.game?.imageUrl} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {item.name}
                  {item.quantity > 1 && (
                    <span className="ml-1 text-zinc-500">×{item.quantity}</span>
                  )}
                </span>
                <span className="block truncate text-sm text-zinc-500">
                  {itemSubtitle(item)}
                </span>
              </span>
              <span className="shrink-0 text-right">
                {value === null ? (
                  <span className="block text-sm text-zinc-500">—</span>
                ) : (
                  <Amount cents={value} className="block" />
                )}
                <span className="block">
                  <GainBadge cents={itemGain(item)} />
                  {!sold && item.basisSource === 'baseline' && (
                    <span className="ml-1 text-xs text-zinc-500">
                      since added
                    </span>
                  )}
                </span>
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
