// /collection/new: add an item in three parts.
//   1. What it is: kind, then a lookup (TCGCSV or PriceCharting) or "price manually".
//   2. Details: name, quantity, condition, notes.
//   3. How you got it: bought (a purchase transaction) or already owned
//      (an opening entry at today's value, pre-filled from the lookup).

import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { ITEM_KINDS, type ItemKind } from '../../lib/collection/accounting.ts'
import type { ItemCreate } from '../../lib/collection/schemas.ts'
import {
  centsToInput,
  formatMoney,
  parseMoney,
} from '../../lib/ledger/money.ts'
import { AccountPicker } from '../components/AccountPicker.tsx'
import { Thumb } from '../components/ItemList.tsx'
import { MoneyInput } from '../components/MoneyInput.tsx'
import {
  PriceChartingLookup,
  type PriceChartingPick,
} from '../components/PriceChartingLookup.tsx'
import { TcgLookup, type TcgPick } from '../components/TcgLookup.tsx'
import { CONDITIONS, KIND_SINGULAR, VARIANT_LABELS } from '../lib/collection.ts'
import { todayLocal, useCreateItem } from '../lib/queries.ts'

type Source =
  | { type: 'tcg'; pick: TcgPick }
  | { type: 'pc'; pick: PriceChartingPick }
  | { type: 'manual' }

export default function CollectionNew() {
  const navigate = useNavigate()
  const create = useCreateItem()
  const [kind, setKind] = useState<ItemKind | null>(null)
  const [source, setSource] = useState<Source | null>(null)

  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [condition, setCondition] = useState('')
  const [notes, setNotes] = useState('')
  const [platform, setPlatform] = useState('')
  const [variant, setVariant] = useState<'loose' | 'cib' | 'new'>('loose')
  const [manualPrice, setManualPrice] = useState('') // unit value for unlisted items

  const [mode, setMode] = useState<'baseline' | 'purchase'>('baseline')
  const [date, setDate] = useState(todayLocal())
  const [amount, setAmount] = useState('')
  const [amountTouched, setAmountTouched] = useState(false)
  const [fromAccountId, setFromAccountId] = useState<number | null>(null)

  const tcg = kind === 'card' || kind === 'sealed'
  const qty = Number.parseInt(quantity, 10)
  const qtyValid = Number.isInteger(qty) && qty >= 1

  // The unit price the lookup found (or that was typed for an unlisted item).
  const unitPrice: number | null =
    source?.type === 'tcg'
      ? source.pick.marketCents
      : source?.type === 'pc'
        ? source.pick.priceCents
        : manualPrice.trim()
          ? parseMoney(manualPrice)
          : null

  // "Already owned" shows today's market value × quantity until edited by hand.
  // Derived during render, so it follows quantity changes without extra state.
  const suggested =
    mode === 'baseline' && !amountTouched && unitPrice !== null && qtyValid
      ? centsToInput(unitPrice * qty)
      : null
  const shownAmount = suggested ?? amount

  function chooseKind(k: ItemKind) {
    setKind(k)
    setSource(null)
    setCondition(CONDITIONS[k][0] ?? '')
  }

  function pickTcg(pick: TcgPick) {
    setSource({ type: 'tcg', pick })
    setName(pick.product.name)
    setAmountTouched(false)
  }

  // For games, the condition grades match the variants ("Loose", "Complete in
  // box", "New / sealed"), so picking a variant sets the condition too.
  // Hardware grades (Excellent, Good…) are a different scale and are left alone.
  function chooseVariant(v: 'loose' | 'cib' | 'new') {
    setVariant(v)
    if (kind === 'game') setCondition(VARIANT_LABELS[v])
  }

  function pickPc(pick: PriceChartingPick) {
    setSource({ type: 'pc', pick })
    setName(pick.name)
    setPlatform(pick.platform)
    chooseVariant(pick.variant)
    setAmountTouched(false)
  }

  const amountCents = parseMoney(shownAmount)
  const canSave =
    kind !== null &&
    source !== null &&
    name.trim() !== '' &&
    qtyValid &&
    amountCents !== null &&
    amountCents >= 0 &&
    (tcg || platform.trim() !== '') &&
    (mode === 'baseline' || fromAccountId !== null) &&
    !(
      source.type === 'manual' &&
      manualPrice.trim() !== '' &&
      parseMoney(manualPrice) === null
    ) &&
    !create.isPending

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSave || kind === null || source === null || amountCents === null)
      return
    const body: ItemCreate = {
      kind,
      name: name.trim(),
      quantity: qty,
      condition: condition || null,
      notes: notes.trim() || null,
      acquisition:
        mode === 'purchase'
          ? {
              mode,
              date,
              costCents: amountCents,
              fromAccountId: fromAccountId!,
            }
          : { mode, date, valueCents: amountCents },
      ...(unitPrice !== null && {
        observedPrice: { priceCents: unitPrice, asOf: todayLocal() },
      }),
    }
    if (source.type === 'tcg') {
      const { pick } = source
      body.card = {
        categoryId: pick.categoryId,
        groupId: pick.groupId,
        productId: pick.product.productId,
        subType: pick.subType,
        setName: pick.setName,
        number: pick.product.number,
        rarity: pick.product.rarity,
        imageUrl: pick.product.imageUrl,
      }
    } else {
      body.game = {
        platform: platform.trim(),
        url: source.type === 'pc' ? source.pick.url : null,
        variant: source.type === 'pc' ? source.pick.variant : variant,
        imageUrl: source.type === 'pc' ? source.pick.imageUrl : null,
      }
    }
    create.mutate(body, {
      onSuccess: (item) => navigate(`/collection/${item.id}`),
    })
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold">Add to collection</h1>

      {/* 1. What it is */}
      <section className="card space-y-4">
        <h2 className="font-medium">1. What is it?</h2>
        <div className="flex flex-wrap gap-2">
          {ITEM_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => chooseKind(k)}
              className={kind === k ? 'btn-primary' : 'btn'}
            >
              {KIND_SINGULAR[k]}
            </button>
          ))}
        </div>

        {kind && source && (
          <div className="flex items-center gap-3 rounded-lg bg-zinc-100 p-3 dark:bg-zinc-800">
            {source.type === 'tcg' && (
              <Thumb src={source.pick.product.imageUrl} />
            )}
            {source.type === 'pc' && source.pick.imageUrl && (
              <Thumb src={source.pick.imageUrl} />
            )}
            <div className="min-w-0 flex-1 text-sm">
              {source.type === 'tcg' && (
                <>
                  <div className="font-medium">{source.pick.product.name}</div>
                  <div className="text-zinc-500">
                    {source.pick.setName} · {source.pick.subType} ·{' '}
                    {source.pick.marketCents === null
                      ? 'no market price'
                      : formatMoney(source.pick.marketCents)}
                  </div>
                </>
              )}
              {source.type === 'pc' && (
                <>
                  <div className="font-medium">{source.pick.name}</div>
                  <div className="text-zinc-500">
                    {source.pick.platform} ·{' '}
                    {VARIANT_LABELS[source.pick.variant]} ·{' '}
                    {source.pick.priceCents === null
                      ? 'no price'
                      : formatMoney(source.pick.priceCents)}
                  </div>
                </>
              )}
              {source.type === 'manual' && (
                <div className="font-medium">Not listed: priced by hand</div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSource(null)}
              className="btn"
            >
              Change
            </button>
          </div>
        )}

        {kind && !source && tcg && (
          <TcgLookup sealed={kind === 'sealed'} onPick={pickTcg} />
        )}
        {kind && !source && !tcg && (
          <>
            <PriceChartingLookup onPick={pickPc} />
            <button
              type="button"
              onClick={() => setSource({ type: 'manual' })}
              className="text-sm text-zinc-500 underline"
            >
              Not on PriceCharting? Price it manually
            </button>
          </>
        )}
      </section>

      {kind && source && (
        <form onSubmit={submit} className="space-y-6">
          {/* 2. Details */}
          <section className="card space-y-4">
            <h2 className="font-medium">2. Details</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1 sm:col-span-2">
                <span className="label">Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input"
                  required
                />
              </label>
              <label className="block space-y-1">
                <span className="label">Quantity</span>
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="input"
                />
              </label>
              <label className="block space-y-1">
                <span className="label">Condition</span>
                <select
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                  className="input"
                >
                  <option value="">Not specified</option>
                  {CONDITIONS[kind].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              {!tcg && (
                <label className="block space-y-1">
                  <span className="label">Platform</span>
                  <input
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                    placeholder="e.g. Nintendo 3DS"
                    className="input"
                    required
                  />
                </label>
              )}
              {source.type === 'manual' && (
                <>
                  <label className="block space-y-1">
                    <span className="label">Variant</span>
                    <select
                      value={variant}
                      onChange={(e) =>
                        chooseVariant(e.target.value as typeof variant)
                      }
                      className="input"
                    >
                      {(['loose', 'cib', 'new'] as const).map((v) => (
                        <option key={v} value={v}>
                          {VARIANT_LABELS[v]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-1">
                    <span className="label">
                      Current value, each (optional)
                    </span>
                    <MoneyInput
                      value={manualPrice}
                      onChange={setManualPrice}
                      placeholder="0.00"
                    />
                  </label>
                </>
              )}
              <label className="block space-y-1 sm:col-span-2">
                <span className="label">Notes</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="input"
                />
              </label>
            </div>
          </section>

          {/* 3. How you got it */}
          <section className="card space-y-4">
            <h2 className="font-medium">3. How did you get it?</h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setMode('baseline')
                  setAmountTouched(false)
                }}
                className={mode === 'baseline' ? 'btn-primary' : 'btn'}
              >
                Already owned
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('purchase')
                  setAmount('')
                  setAmountTouched(true)
                }}
                className={mode === 'purchase' ? 'btn-primary' : 'btn'}
              >
                Bought it
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="label">
                  {mode === 'baseline' ? 'Value today (total)' : 'Total paid'}
                </span>
                <MoneyInput
                  value={shownAmount}
                  onChange={(v) => {
                    setAmount(v)
                    setAmountTouched(true)
                  }}
                  placeholder="0.00"
                />
              </label>
              <label className="block space-y-1">
                <span className="label">
                  {mode === 'baseline' ? 'As of' : 'Date bought'}
                </span>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="input"
                />
              </label>
              {mode === 'purchase' && (
                <label className="block space-y-1 sm:col-span-2">
                  <span className="label">Paid from</span>
                  <AccountPicker
                    value={fromAccountId}
                    onChange={setFromAccountId}
                    types={['asset', 'liability']}
                    placeholder="Checking, credit card…"
                  />
                </label>
              )}
            </div>
            <p className="text-xs text-zinc-500">
              {mode === 'baseline'
                ? 'Becomes the item’s starting cost, so gains are counted from today. Recorded as an opening entry (hidden from the register).'
                : 'Recorded as a purchase from that account. Gains are counted from what you paid.'}
            </p>
          </section>

          {create.error && (
            <p className="text-sm text-red-600">{create.error.message}</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => navigate('/collection')}
              className="btn"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSave}
              className="btn-primary px-5 py-2"
            >
              {create.isPending ? 'Adding…' : 'Add to collection'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
