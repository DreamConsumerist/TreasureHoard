// /collection/groups/:id: one collection group (a deck, a binder) with its
// totals and its cards. Select mode here sets the cover or removes cards from
// the group (they stay in the collection).

import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  marketValueCents,
  weekChangeCents,
} from '../../lib/collection/valuation.ts'
import { Amount } from '../components/Amount.tsx'
import { GainBadge, ItemList, type ItemView } from '../components/ItemList.tsx'
import { PriceChange } from '../components/PriceChange.tsx'
import {
  useDeleteGroup,
  useGroup,
  useUpdateGroup,
  useUpdateItem,
} from '../lib/queries.ts'

const VIEW_KEY = 'treasurehoard.collectionView'

export default function GroupPage() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const group = useGroup(id)
  const update = useUpdateGroup()
  const del = useDeleteGroup()
  const updateItem = useUpdateItem()
  const [view, setView] = useState<ItemView>(() =>
    localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'tiles',
  )
  const [selected, setSelected] = useState<Set<number> | null>(null)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [showSold, setShowSold] = useState(false)

  const g = group.data
  const owned = useMemo(
    () =>
      (g?.items ?? [])
        .filter((i) => i.soldDate === null)
        .sort((a, b) => marketValueCents(b) - marketValueCents(a)),
    [g],
  )
  const sold = (g?.items ?? []).filter((i) => i.soldDate !== null)
  const movers = owned
    .map((i) => ({ item: i, change: weekChangeCents(i) }))
    .filter((m): m is { item: typeof m.item; change: number } =>
      Boolean(m.change),
    )
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 5)

  const toggle = (itemId: number) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })

  async function removeSelected() {
    if (!selected) return
    for (const itemId of selected) {
      await updateItem.mutateAsync({ id: itemId, itemGroupId: null })
    }
    setSelected(null)
  }

  if (group.isPending) return <p className="text-sm text-zinc-500">Loading…</p>
  if (group.error)
    return <p className="text-sm text-red-600">{group.error.message}</p>
  if (!g) return null

  const busy = update.isPending || updateItem.isPending || del.isPending
  const error = update.error ?? updateItem.error ?? del.error

  return (
    <div className="space-y-4">
      <Link to="/collection" className="text-sm text-zinc-500 hover:underline">
        ← Collection
      </Link>

      {editing ? (
        <form
          className="card space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            update.mutate(
              { id, name: name.trim(), notes: notes.trim() || null },
              { onSuccess: () => setEditing(false) },
            )
          }}
        >
          <label className="block space-y-1">
            <span className="label">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
            />
          </label>
          <label className="block space-y-1">
            <span className="label">Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="input"
            />
          </label>
          <div className="flex justify-between gap-2">
            <button
              type="button"
              className="btn-danger"
              disabled={busy}
              onClick={() => {
                if (
                  confirm(
                    `Delete the group "${g.name}"? Its cards stay in your collection, ungrouped.`,
                  )
                )
                  del.mutate(id, { onSuccess: () => navigate('/collection') })
              }}
            >
              Delete group
            </button>
            <span className="flex gap-2">
              <button
                type="button"
                className="btn"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={busy || name.trim() === ''}
              >
                Save
              </button>
            </span>
          </div>
        </form>
      ) : (
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">{g.name}</h1>
            {g.notes && (
              <p className="mt-1 text-sm whitespace-pre-wrap text-zinc-500">
                {g.notes}
              </p>
            )}
          </div>
          <button
            type="button"
            className="btn shrink-0"
            onClick={() => {
              setName(g.name)
              setNotes(g.notes ?? '')
              setEditing(true)
            }}
          >
            Edit
          </button>
        </header>
      )}

      <div className="card grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <div className="label">Value</div>
          <Amount cents={g.marketCents} className="text-lg font-semibold" />
          <PriceChange
            cents={g.weekChangeCents}
            suffix="7d"
            className="block"
          />
        </div>
        <div>
          <div className="label">Cost</div>
          <Amount cents={g.costCents} className="font-medium" />
        </div>
        <div>
          <div className="label">Unrealized</div>
          <GainBadge cents={g.marketCents - g.costCents} />
        </div>
        <div>
          <div className="label">Cards</div>
          <span className="font-medium">
            {g.cardCount}
            {g.itemCount !== g.cardCount && (
              <span className="text-zinc-500"> ({g.itemCount} entries)</span>
            )}
          </span>
        </div>
      </div>

      {movers.length > 0 && (
        <section className="card">
          <h2 className="mb-2 font-medium">Movers this week</h2>
          <ul className="space-y-1 text-sm">
            {movers.map(({ item, change }) => (
              <li key={item.id} className="flex justify-between gap-2">
                <Link
                  to={`/collection/${item.id}`}
                  className="truncate hover:underline"
                >
                  {item.name}
                </Link>
                <PriceChange cents={change} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/collection/new?group=${id}`} className="btn-primary">
          + Add card to this group
        </Link>
        {selected === null ? (
          <button
            type="button"
            className="btn"
            onClick={() => setSelected(new Set())}
          >
            Select
          </button>
        ) : (
          <>
            <span className="text-sm">{selected.size} selected</span>
            <button
              type="button"
              className="btn"
              disabled={selected.size !== 1 || busy}
              title="Pick exactly one card"
              onClick={() =>
                update.mutate(
                  { id, coverItemId: [...selected][0]! },
                  { onSuccess: () => setSelected(null) },
                )
              }
            >
              Use as cover
            </button>
            <button
              type="button"
              className="btn"
              disabled={selected.size === 0 || busy}
              onClick={() => void removeSelected().catch(() => {})}
            >
              Remove from group
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setSelected(null)}
            >
              Done
            </button>
          </>
        )}
        {g.coverItemId !== null && selected === null && (
          <button
            type="button"
            className="text-sm text-zinc-500 underline"
            disabled={busy}
            onClick={() => update.mutate({ id, coverItemId: null })}
          >
            Reset cover
          </button>
        )}
        <div className="ml-auto flex overflow-hidden rounded-lg border border-zinc-300 text-sm dark:border-zinc-700">
          {(['tiles', 'list'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                setView(v)
                localStorage.setItem(VIEW_KEY, v)
              }}
              aria-pressed={view === v}
              className={`px-3 py-1 ${view === v ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : ''}`}
            >
              {v === 'tiles' ? 'Tiles' : 'List'}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error.message}</p>}

      <ItemList
        items={owned}
        view={view}
        selection={selected === null ? undefined : { selected, toggle }}
        empty="No cards in this group yet. Use Select on the Collection page, or add one here."
      />

      {sold.length > 0 && (
        <section>
          <button
            type="button"
            className="text-sm text-zinc-500 underline"
            onClick={() => setShowSold((v) => !v)}
          >
            {showSold ? 'Hide' : 'Show'} {sold.length} sold (not counted in the
            totals)
          </button>
          {showSold && (
            <div className="mt-2">
              <ItemList items={sold} view={view} empty="" />
            </div>
          )}
        </section>
      )}
    </div>
  )
}
