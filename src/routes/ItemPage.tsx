// /collection/:id: one item, with its cost, value, gain, linked transactions,
// and the edit / sell / undo-sale / delete actions.

import { lazy, Suspense, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { weekChangeCents } from '../../lib/collection/valuation.ts'
import {
  centsToInput,
  formatMoney,
  parseMoney,
} from '../../lib/ledger/money.ts'
import { AccountPicker } from '../components/AccountPicker.tsx'
import { Amount } from '../components/Amount.tsx'
import { GainBadge, Thumb } from '../components/ItemList.tsx'
import { MoneyInput } from '../components/MoneyInput.tsx'
import { PriceChange } from '../components/PriceChange.tsx'
import {
  CONDITIONS,
  itemGain,
  itemSubtitle,
  itemValue,
  KIND_SINGULAR,
} from '../lib/collection.ts'
import {
  todayLocal,
  useDeleteItem,
  useItem,
  useSellItem,
  useUndoSale,
  useUpdateItem,
  type ItemDetailOut,
} from '../lib/queries.ts'

// The chart library (Recharts) is large, so it loads only when an item page
// opens, keeping it out of the bundle every other page downloads.
const PriceChart = lazy(() =>
  import('../components/PriceChart.tsx').then((m) => ({
    default: m.PriceChart,
  })),
)

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  )
}

function EditForm({
  item,
  onDone,
}: {
  item: ItemDetailOut
  onDone: () => void
}) {
  const update = useUpdateItem()
  const sold = item.soldDate !== null
  const manual = !item.card && !item.game?.url
  const [name, setName] = useState(item.name)
  const [quantity, setQuantity] = useState(String(item.quantity))
  const [condition, setCondition] = useState(item.condition ?? '')
  const [notes, setNotes] = useState(item.notes ?? '')
  const [basis, setBasis] = useState(centsToInput(item.costBasisCents))
  const [date, setDate] = useState(item.acquiredDate)
  const [price, setPrice] = useState(
    item.unitPriceCents === null ? '' : centsToInput(item.unitPriceCents),
  )

  const basisCents = parseMoney(basis)
  const priceCents = price.trim() ? parseMoney(price) : null
  const qty = Number.parseInt(quantity, 10)
  const valid =
    name.trim() !== '' &&
    basisCents !== null &&
    basisCents >= 0 &&
    Number.isInteger(qty) &&
    qty >= 1 &&
    !(price.trim() && priceCents === null)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || basisCents === null) return
    update.mutate(
      {
        id: item.id,
        name: name.trim(),
        condition: condition || null,
        notes: notes.trim() || null,
        // Locked once sold; only sent when changed, so other edits never touch the books.
        ...(!sold && qty !== item.quantity && { quantity: qty }),
        ...(!sold &&
          basisCents !== item.costBasisCents && { costBasisCents: basisCents }),
        ...(!sold && date !== item.acquiredDate && { acquiredDate: date }),
        ...(manual &&
          priceCents !== null &&
          priceCents !== item.unitPriceCents && {
            manualPriceCents: priceCents,
            today: todayLocal(),
          }),
      },
      { onSuccess: onDone },
    )
  }

  return (
    <form onSubmit={submit} className="card space-y-4">
      <h2 className="font-medium">Edit</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1 sm:col-span-2">
          <span className="label">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
          />
        </label>
        <label className="block space-y-1">
          <span className="label">Quantity</span>
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="input"
            disabled={sold}
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
            {[
              ...new Set([
                ...CONDITIONS[item.kind],
                ...(item.condition ? [item.condition] : []),
              ]),
            ].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="label">Cost basis (total)</span>
          <MoneyInput value={basis} onChange={setBasis} disabled={sold} />
        </label>
        <label className="block space-y-1">
          <span className="label">
            {item.basisSource === 'baseline' ? 'Added on' : 'Bought on'}
          </span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input"
            disabled={sold}
          />
        </label>
        {manual && (
          <label className="block space-y-1">
            <span className="label">Current value, each</span>
            <MoneyInput value={price} onChange={setPrice} placeholder="0.00" />
          </label>
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
      <p className="text-xs text-zinc-500">
        {sold
          ? 'Cost, date and quantity are locked while the item is sold. Undo the sale to change them.'
          : 'Changing the cost or date updates the linked ledger entry too.'}
      </p>
      {update.error && (
        <p className="text-sm text-red-600">{update.error.message}</p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="btn">
          Cancel
        </button>
        <button
          type="submit"
          disabled={!valid || update.isPending}
          className="btn-primary"
        >
          Save
        </button>
      </div>
    </form>
  )
}

function SellForm({
  item,
  onDone,
}: {
  item: ItemDetailOut
  onDone: (soldId: number) => void
}) {
  const sell = useSellItem()
  const [quantity, setQuantity] = useState(String(item.quantity))
  const [proceeds, setProceeds] = useState('')
  const [date, setDate] = useState(todayLocal())
  const [toAccountId, setToAccountId] = useState<number | null>(null)

  const qty = Number.parseInt(quantity, 10)
  const qtyValid = Number.isInteger(qty) && qty >= 1 && qty <= item.quantity
  const proceedsCents = parseMoney(proceeds)
  // The basis that leaves with this sale (prorated, as the server does it).
  const basisSold = qtyValid
    ? Math.round((item.costBasisCents * qty) / item.quantity)
    : null
  const gain =
    proceedsCents !== null && basisSold !== null
      ? proceedsCents - basisSold
      : null
  const needsAccount = proceedsCents !== null && proceedsCents > 0
  const valid =
    qtyValid &&
    proceedsCents !== null &&
    proceedsCents >= 0 &&
    (!needsAccount || toAccountId !== null)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || proceedsCents === null) return
    sell.mutate(
      {
        id: item.id,
        date,
        quantity: qty,
        proceedsCents,
        // With no proceeds there's nothing to deposit, so no account is sent.
        ...(needsAccount && toAccountId !== null && { toAccountId }),
      },
      { onSuccess: (sold) => onDone(sold.id) },
    )
  }

  return (
    <form onSubmit={submit} className="card space-y-4">
      <h2 className="font-medium">Sell</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {item.quantity > 1 && (
          <label className="block space-y-1">
            <span className="label">Quantity (of {item.quantity})</span>
            <input
              type="number"
              min={1}
              max={item.quantity}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="input"
            />
          </label>
        )}
        <label className="block space-y-1">
          <span className="label">Sold for (total, after fees)</span>
          <MoneyInput
            value={proceeds}
            onChange={setProceeds}
            placeholder="0.00"
            autoFocus
          />
        </label>
        <label className="block space-y-1">
          <span className="label">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input"
          />
        </label>
        <label className="block space-y-1">
          <span className="label">Money went to</span>
          <AccountPicker
            value={toAccountId}
            onChange={setToAccountId}
            types={['asset', 'liability']}
            placeholder={
              needsAccount ? 'Checking, PayPal…' : 'Not needed for $0'
            }
          />
        </label>
      </div>
      {gain !== null && (
        <p className="text-sm">
          {gain >= 0 ? 'Gain' : 'Loss'}: <GainBadge cents={gain} />{' '}
          <span className="text-zinc-500">
            (cost basis {formatMoney(basisSold ?? 0)}
            {qtyValid && qty < item.quantity
              ? `; the other ${item.quantity - qty} stay in your collection`
              : ''}
            )
          </span>
        </p>
      )}
      {sell.error && (
        <p className="text-sm text-red-600">{sell.error.message}</p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => onDone(item.id)} className="btn">
          Cancel
        </button>
        <button
          type="submit"
          disabled={!valid || sell.isPending}
          className="btn-primary"
        >
          Record sale
        </button>
      </div>
    </form>
  )
}

export default function ItemPage() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const { data: item, error, isPending } = useItem(id)
  const [panel, setPanel] = useState<'none' | 'edit' | 'sell'>('none')
  const undo = useUndoSale()
  const del = useDeleteItem()

  if (isPending) return <p className="text-sm text-zinc-500">Loading…</p>
  if (error || !item)
    return (
      <p className="text-sm text-red-600">
        {error?.message ?? 'Item not found.'}
      </p>
    )

  const sold = item.soldDate !== null
  const value = itemValue(item)
  const gain = itemGain(item)
  const actionError = undo.error ?? del.error

  return (
    <div className="max-w-2xl space-y-4">
      <Link to="/collection" className="text-sm text-zinc-500 hover:underline">
        ← Collection
      </Link>

      <header className="flex gap-4">
        <Thumb
          src={
            item.card?.imageUrl?.replace('_200w', '_400w') ??
            item.game?.imageUrl
          }
          size="h-32 w-24"
        />
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">
            {item.name}
            {item.quantity > 1 && (
              <span className="ml-2 text-zinc-500">×{item.quantity}</span>
            )}
          </h1>
          <p className="text-sm text-zinc-500">
            {KIND_SINGULAR[item.kind]} · {itemSubtitle(item)}
          </p>
          {item.condition && (
            <p className="text-sm text-zinc-500">{item.condition}</p>
          )}
          {sold && (
            <p className="mt-1 inline-block rounded bg-zinc-200 px-2 py-0.5 text-xs dark:bg-zinc-800">
              Sold {item.soldDate}
            </p>
          )}
        </div>
      </header>

      <section className="card divide-y divide-zinc-200 dark:divide-zinc-800">
        <Row
          label={item.basisSource === 'baseline' ? 'Value when added' : 'Paid'}
        >
          <Amount cents={item.costBasisCents} />{' '}
          <span className="text-zinc-500">on {item.acquiredDate}</span>
        </Row>
        {sold ? (
          <>
            <Row label="Sold for">
              <Amount cents={item.saleProceedsCents ?? 0} />
            </Row>
            <Row label="Realized gain">
              <GainBadge cents={gain} />
            </Row>
          </>
        ) : (
          <>
            <Row label="Price, each">
              {item.unitPriceCents === null ? (
                <span className="text-zinc-500">no price yet</span>
              ) : (
                <>
                  <Amount cents={item.unitPriceCents} />{' '}
                  <span className="text-zinc-500">as of {item.priceAsOf}</span>{' '}
                  <PriceChange cents={weekChangeCents(item)} suffix="7d" />
                </>
              )}
            </Row>
            <Row label="Value">
              {value === null ? '—' : <Amount cents={value} />}
            </Row>
            <Row
              label={
                item.basisSource === 'baseline' ? 'Gain since added' : 'Gain'
              }
            >
              <GainBadge cents={gain} />
            </Row>
          </>
        )}
        <Row label="Ledger">
          <span className="space-x-3">
            {item.acquiredTxnId ? (
              <Link to={`/ledger/${item.acquiredTxnId}`} className="underline">
                {item.basisSource === 'baseline' ? 'Opening entry' : 'Purchase'}
              </Link>
            ) : (
              <span className="text-zinc-500">nothing booked ($0)</span>
            )}
            {item.soldTxnId && (
              <Link to={`/ledger/${item.soldTxnId}`} className="underline">
                Sale
              </Link>
            )}
          </span>
        </Row>
        {item.card && (
          <Row label="Source">
            <a
              href={`https://www.tcgplayer.com/product/${item.card.productId}`}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              TCGplayer
            </a>
          </Row>
        )}
        {item.game?.url && (
          <Row label="Source">
            <a
              href={item.game.url}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              PriceCharting
            </a>
          </Row>
        )}
        {item.notes && <Row label="Notes">{item.notes}</Row>}
      </section>

      {item.priceHistory.length > 0 && (
        <section className="card space-y-2">
          <h2 className="font-medium">Price per unit</h2>
          <Suspense
            fallback={<div className="h-56" aria-label="Loading chart" />}
          >
            <PriceChart
              history={item.priceHistory}
              costPerUnitCents={Math.round(item.costBasisCents / item.quantity)}
              costLabel={
                item.basisSource === 'baseline'
                  ? 'Value when added'
                  : 'Your cost'
              }
            />
          </Suspense>
        </section>
      )}

      {panel === 'none' && (
        <div className="flex flex-wrap gap-2">
          {!sold && (
            <button onClick={() => setPanel('sell')} className="btn-primary">
              Sell
            </button>
          )}
          <button onClick={() => setPanel('edit')} className="btn">
            Edit
          </button>
          {sold ? (
            <button
              onClick={() => {
                if (
                  confirm(
                    'Undo this sale? The sale transaction is deleted and the item returns to your collection.',
                  )
                )
                  undo.mutate(item.id)
              }}
              className="btn"
            >
              Undo sale
            </button>
          ) : (
            <button
              onClick={() => {
                if (
                  confirm(
                    `Delete "${item.name}"? Its ledger entry is deleted too.`,
                  )
                )
                  del.mutate(item.id, {
                    onSuccess: () => navigate('/collection'),
                  })
              }}
              className="btn-danger"
            >
              Delete
            </button>
          )}
        </div>
      )}
      {actionError && (
        <p className="text-sm text-red-600">{actionError.message}</p>
      )}

      {panel === 'edit' && (
        <EditForm item={item} onDone={() => setPanel('none')} />
      )}
      {panel === 'sell' && (
        <SellForm
          item={item}
          onDone={(soldId) => {
            setPanel('none')
            if (soldId !== item.id) navigate(`/collection/${soldId}`)
          }}
        />
      )}
    </div>
  )
}
