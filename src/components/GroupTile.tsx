// Collection groups (decks, binders) as tiles or rows, matching the item
// tiles and rows they sit beside on the Collection page.

import { Link } from 'react-router'
import type { GroupOut } from '../../lib/collection/types.ts'
import { Amount } from './Amount.tsx'
import { GainBadge, Thumb, type ItemView } from './ItemList.tsx'
import { PriceChange } from './PriceChange.tsx'

const count = (g: GroupOut) =>
  `${g.cardCount} card${g.cardCount === 1 ? '' : 's'}`

export function GroupList({
  groups,
  view,
}: {
  groups: GroupOut[]
  view: ItemView
}) {
  if (groups.length === 0) return null
  if (view === 'list') {
    return (
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {groups.map((g) => (
          <li key={g.id}>
            <Link
              to={`/collection/groups/${g.id}`}
              className="flex items-center gap-3 px-1 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              <Thumb src={g.imageUrl} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{g.name}</span>
                <span className="block truncate text-sm text-zinc-500">
                  Group · {count(g)}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <Amount cents={g.marketCents} className="block" />
                <GainBadge cents={g.marketCents - g.costCents} />
                <PriceChange
                  cents={g.weekChangeCents}
                  suffix="7d"
                  className="block"
                />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {groups.map((g) => (
        <li key={g.id}>
          <Link
            to={`/collection/groups/${g.id}`}
            className="flex h-full flex-col overflow-hidden rounded-xl border-2 border-zinc-300 bg-white hover:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-500"
          >
            <span className="relative block aspect-[5/7] bg-zinc-100 dark:bg-zinc-800">
              {g.imageUrl ? (
                <img
                  src={g.imageUrl}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-contain p-2"
                />
              ) : (
                <span className="flex h-full items-center justify-center p-3 text-center text-sm font-medium text-zinc-500">
                  {g.name}
                </span>
              )}
              <span className="absolute top-2 right-2 rounded-full bg-zinc-900/80 px-2 py-0.5 text-xs font-medium text-white">
                {count(g)}
              </span>
            </span>
            <span className="flex flex-1 flex-col gap-0.5 p-2">
              <span className="line-clamp-2 text-sm leading-snug font-medium">
                {g.name}
              </span>
              <span className="text-xs text-zinc-500">Group</span>
              <span className="mt-auto flex items-baseline justify-between gap-2 pt-1">
                <Amount cents={g.marketCents} className="text-sm font-medium" />
                <GainBadge cents={g.marketCents - g.costCents} />
              </span>
              <PriceChange cents={g.weekChangeCents} suffix="7d" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
