// /collection/import: paste a decklist, review what each line matched, fix
// any line, then import the lot into a group as cards you already own.
//
// Matching happens on the server (it needs the card search index). Prices
// are loaded here, one set at a time through the existing per-set lookup, so
// no single request runs long and you see the total before importing. Copies
// you already own are worked out with the same rule the server applies
// (planLine): already in the deck → kept, in no group → moved in, in another
// group → left alone.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  planLine,
  subTypeFor,
  type Finish,
} from '../../lib/collection/decklist.ts'
import type { ImportInput } from '../../lib/collection/schemas.ts'
import type {
  CatalogHit,
  ImportPreviewLine,
  ImportPreviewOut,
  ImportResultOut,
  TcgProductOut,
} from '../../lib/collection/types.ts'
import { formatMoney } from '../../lib/ledger/money.ts'
import { CardSearch } from '../components/CardSearch.tsx'
import { Thumb } from '../components/ItemList.tsx'
import { api } from '../lib/api.ts'
import { CONDITIONS, GAME_LABELS } from '../lib/collection.ts'
import {
  todayLocal,
  useGroups,
  useItems,
  useStartSync,
  type GameKey,
} from '../lib/queries.ts'

const CATEGORY_IDS: Record<GameKey, number> = {
  mtg: 1,
  onepiece: 68,
  riftbound: 89,
}

interface Row {
  key: number
  line: ImportPreviewLine
  hit: CatalogHit | null
  finish: Finish
  quantity: number
  condition: string
  useExisting: boolean
  removed: boolean
  changing: boolean
}

const STATUS_LABEL = {
  matched: {
    text: 'matched',
    cls: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
  },
  guessed: {
    text: 'guessed',
    cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  },
  choose: {
    text: 'choose',
    cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  },
  notfound: {
    text: 'not found',
    cls: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  },
  picked: {
    text: 'picked',
    cls: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  },
} as const

/** Rows needing attention first, then in list order. */
const rank = (r: Row) =>
  r.hit === null
    ? 0
    : r.line.status === 'guessed' || r.line.status === 'choose'
      ? 1
      : 2

export default function DecklistImport() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const groups = useGroups()
  const owned = useItems({ status: 'owned' })
  const build = useStartSync()

  // Step 1: the list and where it goes.
  const [game, setGame] = useState<GameKey>('mtg')
  const [text, setText] = useState('')
  const [groupChoice, setGroupChoice] = useState('new')
  const [newName, setNewName] = useState('')
  const [condition, setCondition] = useState('Near Mint')
  const [date, setDate] = useState(todayLocal())

  // Step 2: the review.
  const [rows, setRows] = useState<Row[] | null>(null)
  const [skipped, setSkipped] = useState<ImportPreviewOut['skipped']>([])
  const [indexed, setIndexed] = useState(true)
  const [catalogs, setCatalogs] = useState<Map<number, TcgProductOut[]>>(
    new Map(),
  )
  const [priceErrors, setPriceErrors] = useState<Set<number>>(new Set())

  const preview = useMutation({
    mutationFn: () =>
      api<ImportPreviewOut>('/collection/import/preview', {
        method: 'POST',
        body: JSON.stringify({ game, text }),
      }),
    onSuccess: (p) => {
      setIndexed(p.indexed)
      setSkipped(p.skipped)
      setRows(
        p.lines.map((line, i) => ({
          key: i,
          line,
          hit: line.match,
          finish: line.finish,
          quantity: line.quantity,
          condition,
          useExisting: true,
          removed: false,
          changing: false,
        })),
      )
    },
  })

  const doImport = useMutation({
    mutationFn: (body: ImportInput) =>
      api<ImportResultOut>('/collection/import', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (res) => {
      void qc.invalidateQueries()
      navigate(`/collection/groups/${res.itemGroupId}`)
    },
  })

  // Load each needed set's products and prices, one set at a time.
  const neededSets = useMemo(
    () => [
      ...new Set(
        (rows ?? [])
          .filter((r) => !r.removed && r.hit)
          .map((r) => r.hit!.groupId),
      ),
    ],
    [rows],
  )
  useEffect(() => {
    let cancelled = false
    void (async () => {
      for (const groupId of neededSets) {
        if (cancelled) return
        if (catalogs.has(groupId) || priceErrors.has(groupId)) continue
        try {
          const products = await qc.fetchQuery({
            queryKey: ['tcg-products', game, groupId],
            queryFn: () =>
              api<TcgProductOut[]>(
                `/catalog/tcg/products?game=${game}&groupId=${groupId}`,
              ),
            staleTime: 60 * 60_000,
          })
          if (!cancelled) setCatalogs((m) => new Map(m).set(groupId, products))
        } catch {
          if (!cancelled) setPriceErrors((s) => new Set(s).add(groupId))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [neededSets, catalogs, priceErrors, game, qc])

  const targetId = groupChoice === 'new' ? null : Number(groupChoice)
  const groupName = (id: number | null) =>
    groups.data?.find((g) => g.id === id)?.name ?? 'another group'

  /** Everything the review shows for a row, derived from current state. */
  function details(r: Row) {
    if (!r.hit) return null
    const product = catalogs
      .get(r.hit.groupId)
      ?.find((p) => p.productId === r.hit!.productId)
    const wanted = subTypeFor(r.finish)
    const available = product?.prices.map((p) => p.subType) ?? []
    // A printing sold in only one finish (foil-only promos) uses that one.
    const subType =
      available.includes(wanted) || available.length !== 1
        ? wanted
        : available[0]!
    const priceCents =
      product?.prices.find((p) => p.subType === subType)?.marketCents ?? null
    const ownedRows = (owned.data ?? [])
      .filter(
        (i) =>
          i.card?.productId === r.hit!.productId && i.card.subType === subType,
      )
      .map((i) => ({
        itemId: i.id,
        quantity: i.quantity,
        itemGroupId: i.itemGroup?.id ?? null,
        groupName: i.itemGroup?.name ?? null,
      }))
    const plan = planLine(r.quantity, ownedRows, targetId, r.useExisting)
    const elsewhereNames = [
      ...new Set(
        ownedRows
          .filter((o) => o.itemGroupId !== null && o.itemGroupId !== targetId)
          .map((o) => o.groupName ?? groupName(o.itemGroupId)),
      ),
    ]
    return {
      product,
      subType,
      priceCents,
      plan,
      elsewhereNames,
      loading: !product && !priceErrors.has(r.hit.groupId),
      failed: priceErrors.has(r.hit.groupId),
      hasExisting: ownedRows.some(
        (o) => o.itemGroupId === null || o.itemGroupId === targetId,
      ),
    }
  }

  const active = (rows ?? []).filter((r) => !r.removed)
  const computed = active.map((r) => ({ r, d: details(r) }))
  const unresolved = computed.filter(({ d }) => d === null).length
  const loadingPrices = computed.some(({ d }) => d?.loading)
  const missingPrice = computed.filter(
    ({ d }) => d && !d.loading && d.plan.add > 0 && d.priceCents === null,
  )
  const totals = computed.reduce(
    (t, { d }) =>
      d
        ? {
            present: t.present + d.plan.present,
            moved:
              t.moved +
              d.plan.fromUngrouped.reduce((s, f) => s + f.quantity, 0),
            added: t.added + d.plan.add,
            value: t.value + (d.priceCents ?? 0) * d.plan.add,
          }
        : t,
    { present: 0, moved: 0, added: 0, value: 0 },
  )
  const groupOk = groupChoice !== 'new' || newName.trim() !== ''
  const canImport =
    active.length > 0 &&
    unresolved === 0 &&
    !loadingPrices &&
    missingPrice.length === 0 &&
    groupOk &&
    !doImport.isPending

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs!.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  function submit() {
    if (!canImport) return
    const lines = computed.map(({ r, d }) => ({
      categoryId: CATEGORY_IDS[game],
      groupId: r.hit!.groupId,
      setName: r.hit!.setName,
      productId: r.hit!.productId,
      name: r.hit!.name,
      number: r.hit!.number,
      rarity: r.hit!.rarity,
      imageUrl: r.hit!.imageUrl,
      subType: d!.subType,
      quantity: r.quantity,
      condition: r.condition || null,
      priceCents: d!.priceCents,
      useExisting: r.useExisting,
    }))
    doImport.mutate({
      date,
      ...(groupChoice === 'new'
        ? { newGroupName: newName.trim() }
        : { itemGroupId: Number(groupChoice) }),
      lines,
    })
  }

  const sorted = [...computed].sort(
    (a, b) => rank(a.r) - rank(b.r) || a.r.line.lineNo - b.r.line.lineNo,
  )

  return (
    <div className="space-y-4">
      <Link to="/collection" className="text-sm text-zinc-500 hover:underline">
        ← Collection
      </Link>
      <h1 className="text-xl font-semibold">Import a decklist</h1>

      <section className="card space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="label">Game</span>
            <select
              value={game}
              onChange={(e) => {
                setGame(e.target.value as GameKey)
                setRows(null)
              }}
              className="input"
            >
              {(Object.keys(GAME_LABELS) as GameKey[]).map((g) => (
                <option key={g} value={g}>
                  {GAME_LABELS[g]}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="label">Into group</span>
            <select
              value={groupChoice}
              onChange={(e) => setGroupChoice(e.target.value)}
              className="input"
            >
              <option value="new">New group…</option>
              {groups.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          {groupChoice === 'new' && (
            <label className="block space-y-1 sm:col-span-2">
              <span className="label">New group's name</span>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ghalta deck"
                className="input"
              />
            </label>
          )}
          <label className="block space-y-1">
            <span className="label">Condition (for every card)</span>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              className="input"
            >
              {CONDITIONS.card.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="label">Value as of</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input"
            />
          </label>
        </div>
        <label className="block space-y-1">
          <span className="label">Decklist</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder={
              '1 Ghalta, Primal Hunger (RIX) 130 *F*\n1 Beast Within (C21) 205\n30 Forest (FDN) 280'
            }
            className="input font-mono text-sm"
          />
          <span className="block text-xs text-zinc-500">
            Paste an export from Moxfield, Archidekt or MTG Arena. Exports with
            set codes and collector numbers match exact printings; plain names
            work too, but you'll pick the printing. *F* means foil, *E* foil
            etched. Maybeboard cards are left out.
          </span>
        </label>
        {preview.error && (
          <p className="text-sm text-red-600">{preview.error.message}</p>
        )}
        <button
          type="button"
          className="btn-primary"
          disabled={text.trim() === '' || preview.isPending}
          onClick={() => preview.mutate()}
        >
          {preview.isPending
            ? 'Matching…'
            : rows
              ? 'Match again'
              : 'Match cards'}
        </button>
      </section>

      {rows && !indexed && (
        <div className="card text-sm">
          <p>
            Matching needs the card search index, which isn't built yet for this
            game.
          </p>
          <button
            type="button"
            className="btn-primary mt-2"
            disabled={build.isPending}
            onClick={() => build.mutate('catalog')}
          >
            Build it now (about 5 minutes)
          </button>
          {build.isSuccess && (
            <p className="mt-1 text-zinc-500">
              Building. Press Match again when it's done (Settings shows its
              progress).
            </p>
          )}
        </div>
      )}

      {rows && indexed && (
        <section className="space-y-3">
          <div className="card grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div>
              <div className="label">New copies</div>
              <span className="font-medium">{totals.added}</span>
            </div>
            <div>
              <div className="label">Their value</div>
              <span className="font-medium">{formatMoney(totals.value)}</span>
            </div>
            <div>
              <div className="label">Moved from no group</div>
              <span className="font-medium">{totals.moved}</span>
            </div>
            <div>
              <div className="label">Already in the group</div>
              <span className="font-medium">{totals.present}</span>
            </div>
            {(unresolved > 0 || loadingPrices || missingPrice.length > 0) && (
              <p className="col-span-full text-xs text-amber-700 dark:text-amber-400">
                {unresolved > 0 &&
                  `${unresolved} line${unresolved === 1 ? '' : 's'} need a printing chosen. `}
                {loadingPrices &&
                  `Loading prices: ${catalogs.size} of ${neededSets.length} sets. `}
                {missingPrice.length > 0 &&
                  `${missingPrice.length} card${missingPrice.length === 1 ? ' has' : 's have'} no market price: remove them and add them by hand.`}
              </p>
            )}
          </div>

          {skipped.length > 0 && (
            <details className="text-sm text-zinc-500">
              <summary className="cursor-pointer">
                {skipped.length} line{skipped.length === 1 ? '' : 's'} left out
              </summary>
              <ul className="mt-1 space-y-0.5 font-mono text-xs">
                {skipped.map((s) => (
                  <li key={s.lineNo}>
                    {s.lineNo}: {s.text}{' '}
                    <span className="font-sans">({s.reason})</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <ul className="card divide-y divide-zinc-200 p-0 dark:divide-zinc-800">
            {sorted.map(({ r, d }) => {
              const status =
                STATUS_LABEL[
                  r.hit && r.hit !== r.line.match ? 'picked' : r.line.status
                ]
              return (
                <li key={r.key} className="space-y-2 p-3">
                  <div className="flex items-start gap-3">
                    <Thumb src={r.hit?.imageUrl ?? null} />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {r.hit?.name ?? r.line.name}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs ${status.cls}`}
                        >
                          {status.text}
                        </span>
                      </div>
                      <div className="text-xs text-zinc-500">
                        {r.hit
                          ? `${r.hit.setName}${r.hit.setCode ? ` (${r.hit.setCode})` : ''}${r.hit.number ? ` · #${r.hit.number}` : ''}`
                          : `From your list: ${r.line.name}${r.line.setCode ? ` (${r.line.setCode})` : ''}${r.line.number ? ` ${r.line.number}` : ''}`}
                      </div>
                      {d && (
                        <div className="text-xs">
                          {[
                            d.plan.present > 0 &&
                              `${d.plan.present} already in the group`,
                            d.plan.fromUngrouped.length > 0 &&
                              `${d.plan.fromUngrouped.reduce((s, f) => s + f.quantity, 0)} from no group`,
                            d.plan.add > 0 && `${d.plan.add} new`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                          {d.elsewhereNames.length > 0 && (
                            <span className="text-zinc-500">
                              {' '}
                              (you also own {d.plan.elsewhere} in{' '}
                              {d.elsewhereNames.join(', ')})
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-right text-sm">
                      {d?.loading && <span className="text-zinc-500">…</span>}
                      {d?.failed && (
                        <span className="text-red-600">price failed</span>
                      )}
                      {d && !d.loading && !d.failed && (
                        <>
                          <div className="tabular-nums">
                            {d.priceCents === null
                              ? 'no price'
                              : formatMoney(d.priceCents)}
                          </div>
                          {d.plan.add > 0 && d.priceCents !== null && (
                            <div className="text-xs text-zinc-500 tabular-nums">
                              {d.plan.add} × ={' '}
                              {formatMoney(d.priceCents * d.plan.add)}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-sm sm:pl-12">
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      value={r.quantity}
                      onChange={(e) => {
                        const n = Number.parseInt(e.target.value, 10)
                        if (Number.isInteger(n) && n >= 1)
                          update(r.key, { quantity: n })
                      }}
                      className="input w-20 py-1"
                      aria-label="Quantity"
                    />
                    <select
                      value={r.finish}
                      onChange={(e) =>
                        update(r.key, { finish: e.target.value as Finish })
                      }
                      className="input w-auto py-1"
                      aria-label="Finish"
                    >
                      <option value="normal">Non-foil</option>
                      <option value="foil">Foil</option>
                      <option value="etched">Foil etched</option>
                    </select>
                    {d && d.subType !== subTypeFor(r.finish) && (
                      <span className="text-xs text-zinc-500">
                        (only sold as {d.subType})
                      </span>
                    )}
                    <select
                      value={r.condition}
                      onChange={(e) =>
                        update(r.key, { condition: e.target.value })
                      }
                      className="input w-auto py-1"
                      aria-label="Condition"
                    >
                      {CONDITIONS.card.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                    {d?.hasExisting && (
                      <label className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={!r.useExisting}
                          onChange={(e) =>
                            update(r.key, { useExisting: !e.target.checked })
                          }
                        />
                        Add all as new copies
                      </label>
                    )}
                    <button
                      type="button"
                      className="btn py-1"
                      onClick={() => update(r.key, { changing: !r.changing })}
                    >
                      {r.hit ? 'Change printing' : 'Choose printing'}
                    </button>
                    <button
                      type="button"
                      className="btn py-1"
                      onClick={() => update(r.key, { removed: true })}
                      aria-label="Remove line"
                    >
                      Remove
                    </button>
                  </div>

                  {(r.changing || (!r.hit && r.line.candidates.length > 0)) && (
                    <div className="space-y-2 sm:pl-12">
                      {!r.changing && (
                        <ul className="max-h-72 divide-y divide-zinc-200 overflow-y-auto rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                          {r.line.candidates.map((c) => (
                            <li key={c.productId}>
                              <button
                                type="button"
                                onClick={() => update(r.key, { hit: c })}
                                className="flex w-full items-center gap-3 p-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                              >
                                <Thumb src={c.imageUrl} />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm">
                                    {c.name}
                                  </span>
                                  <span className="block truncate text-xs text-zinc-500">
                                    {c.setName}
                                    {c.number ? ` · #${c.number}` : ''}
                                    {c.publishedOn
                                      ? ` · ${c.publishedOn.slice(0, 4)}`
                                      : ''}
                                  </span>
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {r.changing && (
                        <CardSearch
                          game={game}
                          sealed={false}
                          initialQuery={r.line.name}
                          chosenId={r.hit?.productId}
                          onChoose={(hit) =>
                            update(r.key, { hit, changing: false })
                          }
                        />
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>

          {rows.some((r) => r.removed) && (
            <button
              type="button"
              className="text-sm text-zinc-500 underline"
              onClick={() =>
                setRows((rs) => rs!.map((r) => ({ ...r, removed: false })))
              }
            >
              Restore {rows.filter((r) => r.removed).length} removed line(s)
            </button>
          )}

          {doImport.error && (
            <p className="text-sm text-red-600">{doImport.error.message}</p>
          )}
          <div className="flex items-center justify-end gap-3">
            {!groupOk && (
              <span className="text-sm text-zinc-500">
                Name the new group first.
              </span>
            )}
            <button
              type="button"
              className="btn-primary px-5 py-2"
              disabled={!canImport}
              onClick={submit}
            >
              {doImport.isPending
                ? 'Importing…'
                : `Import ${active.length} line${active.length === 1 ? '' : 's'}`}
            </button>
          </div>
          <p className="text-right text-xs text-zinc-500">
            New copies are booked as cards you already own, at their market
            value on {date}.
          </p>
        </section>
      )}
    </div>
  )
}
