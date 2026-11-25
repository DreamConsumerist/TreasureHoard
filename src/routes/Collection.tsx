// /collection: owned (or sold) items with cost, value and gain.
//
// Grouped view (owned items only) shows each collection group (a deck, a
// binder) as one tile, then the items that aren't in a group. Individual view
// shows every item. Select mode ticks items to put them in a group.

import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ITEM_KINDS, type ItemKind } from '../../lib/collection/accounting.ts'
import type { GroupOut } from '../../lib/collection/types.ts'
import { AddToGroup } from '../components/AddToGroup.tsx'
import { Amount } from '../components/Amount.tsx'
import { GroupList } from '../components/GroupTile.tsx'
import { GainBadge, ItemList, type ItemView } from '../components/ItemList.tsx'
import { itemGain, itemValue, KIND_LABELS } from '../lib/collection.ts'
import { useDebounced } from '../lib/hooks.ts'
import { useGroups, useItems, type ItemOut } from '../lib/queries.ts'
import { weekChangeCents } from '../../lib/collection/valuation.ts'

type Sort = 'value' | 'gain' | 'movers' | 'name' | 'date'
type Grouping = 'grouped' | 'individual'

// Display choices are remembered per browser; they're display-only, so they
// don't belong in the database.
const VIEW_KEY = 'treasurehoard.collectionView'
const savedView = (): ItemView =>
  localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'tiles'
const GROUPING_KEY = 'treasurehoard.collectionGrouping'
const savedGrouping = (): Grouping =>
  localStorage.getItem(GROUPING_KEY) === 'individual' ? 'individual' : 'grouped'

const groupSorters: Record<Sort, (a: GroupOut, b: GroupOut) => number> = {
  value: (a, b) => b.marketCents - a.marketCents,
  gain: (a, b) => b.marketCents - b.costCents - (a.marketCents - a.costCents),
  movers: (a, b) =>
    Math.abs(b.weekChangeCents ?? -1) - Math.abs(a.weekChangeCents ?? -1),
  name: (a, b) => a.name.localeCompare(b.name),
  date: (a, b) => a.name.localeCompare(b.name),
}

/** Size of the 7-day move either way; -1 (sorts last) without a week of history. */
const moveSize = (i: ItemOut) => {
  const c = weekChangeCents(i)
  return c === null ? -1 : Math.abs(c)
}

const sorters: Record<Sort, (a: ItemOut, b: ItemOut) => number> = {
  value: (a, b) => (itemValue(b) ?? -1) - (itemValue(a) ?? -1),
  gain: (a, b) => (itemGain(b) ?? -Infinity) - (itemGain(a) ?? -Infinity),
  // Biggest 7-day move either way; items without a week of history go last.
  movers: (a, b) => moveSize(b) - moveSize(a),
  name: (a, b) => a.name.localeCompare(b.name),
  date: (a, b) =>
    (b.soldDate ?? b.acquiredDate).localeCompare(a.soldDate ?? a.acquiredDate),
}

export default function Collection() {
  const [status, setStatus] = useState<'owned' | 'sold'>('owned')
  const [kind, setKind] = useState<ItemKind | undefined>()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<Sort>('value')
  const [view, setViewState] = useState<ItemView>(savedView)
  const setView = (v: ItemView) => {
    setViewState(v)
    localStorage.setItem(VIEW_KEY, v)
  }
  const [grouping, setGroupingState] = useState<Grouping>(savedGrouping)
  const setGrouping = (g: Grouping) => {
    setGroupingState(g)
    localStorage.setItem(GROUPING_KEY, g)
  }
  // Select mode: the ticked item ids, or null when not selecting.
  const [selected, setSelected] = useState<Set<number> | null>(null)
  const [choosingGroup, setChoosingGroup] = useState(false)
  const q = useDebounced(search.trim())
  const list = useItems({ status, kind, q: q || undefined })
  const groupList = useGroups()

  const items = useMemo(
    () => [...(list.data ?? [])].sort(sorters[sort]),
    [list.data, sort],
  )
  // Selecting works on individual items, and sold items stay individual.
  const grouped =
    grouping === 'grouped' && status === 'owned' && selected === null
  // Groups with at least one item matching the filters (all of them when
  // there are no filters), so filtering never hides a matching card.
  const shownGroups = useMemo(() => {
    if (!grouped) return []
    const matching = new Set(items.map((i) => i.itemGroup?.id))
    const filtered = !kind && !q
    return [...(groupList.data ?? [])]
      .filter((g) => (filtered ? true : matching.has(g.id)))
      .sort(groupSorters[sort])
  }, [grouped, items, kind, q, groupList.data, sort])
  const shownItems = grouped ? items.filter((i) => !i.itemGroup) : items

  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const stopSelecting = () => {
    setSelected(null)
    setChoosingGroup(false)
  }
  const totals = useMemo(() => {
    let cost = 0
    let value = 0
    let gain = 0 // only over items with a known value, so unpriced ones don't skew it
    let unpriced = 0
    let oldest: string | null = null
    for (const i of items) {
      cost += i.costBasisCents
      const v = status === 'sold' ? i.saleProceedsCents : itemValue(i)
      if (v === null) unpriced++
      else {
        value += v
        gain += v - i.costBasisCents
      }
      if (i.priceAsOf && (!oldest || i.priceAsOf < oldest)) oldest = i.priceAsOf
    }
    return { cost, value, gain, unpriced, oldest }
  }, [items, status])

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-sm ${
      active
        ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
        : 'border-zinc-300 dark:border-zinc-700'
    }`

  return (
    <div>
      <header className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Collection</h1>
        <div className="flex gap-2">
          {status === 'owned' && selected === null && (
            <button
              type="button"
              className="btn"
              onClick={() => setSelected(new Set())}
            >
              Select
            </button>
          )}
          <Link to="/collection/import" className="btn">
            Import decklist
          </Link>
          <Link to="/collection/new" className="btn-primary">
            + Add item
          </Link>
        </div>
      </header>

      {selected !== null && (
        <div className="card sticky top-2 z-20 mb-4 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm">
              {selected.size} selected
              {selected.size < items.length && (
                <button
                  type="button"
                  className="ml-2 text-zinc-500 underline"
                  onClick={() => setSelected(new Set(items.map((i) => i.id)))}
                >
                  Select all {items.length}
                </button>
              )}
            </span>
            {!choosingGroup && (
              <span className="flex gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={selected.size === 0}
                  onClick={() => setChoosingGroup(true)}
                >
                  Add to group…
                </button>
                <button type="button" className="btn" onClick={stopSelecting}>
                  Done
                </button>
              </span>
            )}
          </div>
          {choosingGroup && (
            <AddToGroup
              itemIds={[...selected]}
              onDone={stopSelecting}
              onCancel={() => setChoosingGroup(false)}
            />
          )}
        </div>
      )}

      <div className="mb-3 flex gap-1">
        {(['owned', 'sold'] as const).map((s) => (
          <button
            key={s}
            onClick={() => {
              setStatus(s)
              if (s === 'sold' && sort === 'movers') setSort('value')
              if (s === 'sold') stopSelecting()
            }}
            className={`rounded-lg px-3 py-1.5 text-sm ${status === s ? 'bg-zinc-200 font-medium dark:bg-zinc-800' : 'text-zinc-600 dark:text-zinc-400'}`}
          >
            {s === 'owned' ? 'Owned' : 'Sold'}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <button
          onClick={() => setKind(undefined)}
          className={chip(kind === undefined)}
        >
          All
        </button>
        {ITEM_KINDS.map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={chip(kind === k)}
          >
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search names"
          className="input max-w-xs flex-1"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="input w-auto"
          aria-label="Sort"
        >
          <option value="value">Highest value</option>
          <option value="gain">Biggest gain</option>
          {status === 'owned' && (
            <option value="movers">Biggest movers (7 days)</option>
          )}
          <option value="name">Name</option>
          <option value="date">
            {status === 'sold' ? 'Recently sold' : 'Recently added'}
          </option>
        </select>
        <div className="flex overflow-hidden rounded-lg border border-zinc-300 text-sm dark:border-zinc-700">
          {(['tiles', 'list'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`px-3 py-1 ${
                view === v
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : ''
              }`}
            >
              {v === 'tiles' ? 'Tiles' : 'List'}
            </button>
          ))}
        </div>
        {status === 'owned' && (
          <div className="flex overflow-hidden rounded-lg border border-zinc-300 text-sm dark:border-zinc-700">
            {(['grouped', 'individual'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGrouping(g)}
                aria-pressed={grouping === g}
                className={`px-3 py-1 ${
                  grouping === g
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : ''
                }`}
              >
                {g === 'grouped' ? 'Grouped' : 'Individual'}
              </button>
            ))}
          </div>
        )}
      </div>

      {items.length > 0 && (
        <div className="card mb-4 grid grid-cols-3 gap-2 text-sm">
          <div>
            <div className="label">
              {items.length} item{items.length === 1 ? '' : 's'} · cost
            </div>
            <Amount cents={totals.cost} className="font-medium" />
          </div>
          <div>
            <div className="label">
              {status === 'sold' ? 'Sold for' : 'Value'}
            </div>
            <Amount cents={totals.value} className="font-medium" />
          </div>
          <div>
            <div className="label">
              {status === 'sold' ? 'Realized' : 'Unrealized'}
            </div>
            <GainBadge cents={totals.gain} />
          </div>
          {status === 'owned' && (totals.oldest || totals.unpriced > 0) && (
            <p className="col-span-3 text-xs text-zinc-500">
              {totals.oldest && `Oldest price shown is from ${totals.oldest}. `}
              {totals.unpriced > 0 &&
                `${totals.unpriced} item(s) have no price and are left out of the value.`}
            </p>
          )}
        </div>
      )}

      {list.error && (
        <p className="text-sm text-red-600">{list.error.message}</p>
      )}
      {list.isPending ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <div className="space-y-3">
          <GroupList groups={shownGroups} view={view} />
          {!(shownGroups.length > 0 && shownItems.length === 0) && (
            <ItemList
              items={shownItems}
              view={view}
              showGroup={!grouped}
              selection={selected === null ? undefined : { selected, toggle }}
              empty={
                status === 'sold'
                  ? 'Nothing sold yet.'
                  : items.length > 0
                    ? 'Everything here is in a group.'
                    : 'Nothing here yet. Add your first item.'
              }
            />
          )}
        </div>
      )}
    </div>
  )
}
