// /api/items: the collection. Every change that affects money (adding,
// re-basing, selling, deleting) writes the item and its ledger transaction in
// the same database transaction, so the Collection account always equals the
// summed cost basis of unsold items.

import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNotNull,
  isNull,
  sql,
  type SQL,
} from 'drizzle-orm'
import { Hono } from 'hono'
import {
  accounts,
  cardDetails,
  gameDetails,
  items,
  postings,
  priceSnapshots,
  transactions,
} from '../../../db/schema.ts'
import type { Db, Tx } from '../../../db/types.ts'
import {
  baselinePostings,
  KIND_ACCOUNT_KEY,
  purchasePostings,
  salePostings,
  splitBasis,
  type ItemKind,
} from '../../collection/accounting.ts'
import {
  priceKeyFor,
  priceKeyString,
  type PriceKey,
} from '../../collection/prices.ts'
import {
  itemCreateSchema,
  itemListQuerySchema,
  itemSellSchema,
  itemUpdateSchema,
} from '../../collection/schemas.ts'
import type { ItemDetailOut, ItemOut } from '../../collection/types.ts'
import { validatePostings, type PostingInput } from '../../ledger/postings.ts'
import { fail, idParam, validate } from '../errors.ts'
import { OPENING_BALANCES_KEY, todayUtc } from '../ledger/accounts.ts'
import { collectionAccountIds, systemAccountId } from './common.ts'

const RECORD_ESCAPE = /[\\%_]/g
const likeEscape = (s: string) => s.replace(RECORD_ESCAPE, (ch) => `\\${ch}`)

// --- Reading ---------------------------------------------------------------

async function loadItems(db: Db | Tx, where: SQL[]): Promise<ItemOut[]> {
  const rows = await db
    .select({ item: items, card: cardDetails, game: gameDetails })
    .from(items)
    .leftJoin(cardDetails, eq(cardDetails.itemId, items.id))
    .leftJoin(gameDetails, eq(gameDetails.itemId, items.id))
    .where(and(...where))
    .orderBy(asc(items.name), asc(items.id))

  // Latest snapshot per price key. The table is small (a few rows per owned
  // product per sync), so reading the latest row of each key is cheap.
  const latest = await db
    .selectDistinctOn(
      [
        priceSnapshots.source,
        priceSnapshots.externalId,
        priceSnapshots.variant,
      ],
      {
        source: priceSnapshots.source,
        externalId: priceSnapshots.externalId,
        variant: priceSnapshots.variant,
        priceCents: priceSnapshots.priceCents,
        asOf: priceSnapshots.asOf,
      },
    )
    .from(priceSnapshots)
    .orderBy(
      priceSnapshots.source,
      priceSnapshots.externalId,
      priceSnapshots.variant,
      desc(priceSnapshots.asOf),
    )
  const priceByKey = new Map(latest.map((s) => [priceKeyString(s), s]))

  return rows.map(({ item, card, game }) => {
    const out: Omit<ItemOut, 'unitPriceCents' | 'priceAsOf'> = {
      id: item.id,
      kind: item.kind,
      name: item.name,
      quantity: item.quantity,
      condition: item.condition,
      notes: item.notes,
      costBasisCents: item.costBasisCents,
      basisSource: item.basisSource,
      acquiredDate: item.acquiredDate,
      acquiredTxnId: item.acquiredTxnId,
      soldTxnId: item.soldTxnId,
      soldDate: item.soldDate,
      saleProceedsCents: item.saleProceedsCents,
      card: card
        ? {
            categoryId: card.categoryId,
            groupId: card.groupId,
            productId: card.tcgplayerProductId,
            subType: card.subType,
            setName: card.setName,
            number: card.number,
            rarity: card.rarity,
            imageUrl: card.imageUrl,
          }
        : null,
      game: game
        ? {
            platform: game.platform,
            url: game.pricechartingUrl,
            variant: game.variant,
            imageUrl: game.imageUrl,
          }
        : null,
    }
    const price = priceByKey.get(priceKeyString(priceKeyFor(out)))
    return {
      ...out,
      unitPriceCents: price?.priceCents ?? null,
      priceAsOf: price?.asOf ?? null,
    }
  })
}

async function loadItem(db: Db | Tx, id: number): Promise<ItemOut> {
  const [item] = await loadItems(db, [eq(items.id, id)])
  if (!item) fail(404, 'Item not found')
  return item
}

// --- Writing helpers ---------------------------------------------------------

async function insertTxn(
  tx: Tx,
  header: { date: string; description: string; kind: 'normal' | 'opening' },
  lines: PostingInput[],
): Promise<number> {
  const problems = validatePostings(lines)
  if (problems.length > 0)
    throw new Error(`Internal posting error: ${problems.join(' ')}`)
  const [txn] = await tx
    .insert(transactions)
    .values({ ...header, status: 'cleared' })
    .returning({ id: transactions.id })
  if (!txn) throw new Error('Insert returned no row')
  await tx
    .insert(postings)
    .values(lines.map((l) => ({ ...l, transactionId: txn.id })))
  return txn.id
}

/** A usable account for money to come from or go to: exists, not archived, not inside the Collection. */
async function checkCashAccount(tx: Tx, accountId: number) {
  const [acct] = await tx
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId))
  if (!acct) fail(400, 'Account not found')
  if (acct.archived) fail(400, `"${acct.name}" is archived`)
  if ((await collectionAccountIds(tx)).includes(accountId)) {
    fail(
      400,
      'Pick an account outside the Collection (where the money came from or went)',
    )
  }
}

/** How many items share this acquisition transaction (more than one after a partial sale). */
async function itemsSharingTxn(tx: Tx, txnId: number): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(items)
    .where(eq(items.acquiredTxnId, txnId))
  return row?.n ?? 0
}

async function recordSnapshot(
  tx: Tx,
  key: PriceKey,
  priceCents: number,
  asOf: string,
  overwrite: boolean,
) {
  const insert = tx.insert(priceSnapshots).values({ ...key, priceCents, asOf })
  if (overwrite) {
    await insert.onConflictDoUpdate({
      target: [
        priceSnapshots.source,
        priceSnapshots.externalId,
        priceSnapshots.variant,
        priceSnapshots.asOf,
      ],
      set: { priceCents },
    })
  } else {
    await insert.onConflictDoNothing()
  }
}

const kindAccount = (tx: Tx, kind: ItemKind) =>
  systemAccountId(tx, KIND_ACCOUNT_KEY[kind])

// --- Routes ------------------------------------------------------------------

export function itemRoutes(db: Db) {
  const r = new Hono()

  r.get('/', validate('query', itemListQuerySchema), async (c) => {
    const q = c.req.valid('query')
    const where: SQL[] = [
      q.status === 'sold' ? isNotNull(items.soldDate) : isNull(items.soldDate),
    ]
    if (q.kind) where.push(eq(items.kind, q.kind))
    if (q.q) where.push(ilike(items.name, `%${likeEscape(q.q)}%`))
    return c.json(await loadItems(db, where))
  })

  r.get('/:id', async (c) => {
    const item = await loadItem(db, idParam(c.req.param('id')))
    const key = priceKeyFor(item)
    const history = await db
      .select({
        asOf: priceSnapshots.asOf,
        priceCents: priceSnapshots.priceCents,
      })
      .from(priceSnapshots)
      .where(
        and(
          eq(priceSnapshots.source, key.source),
          eq(priceSnapshots.externalId, key.externalId),
          eq(priceSnapshots.variant, key.variant),
        ),
      )
      .orderBy(asc(priceSnapshots.asOf))
    const out: ItemDetailOut = { ...item, priceHistory: history }
    return c.json(out)
  })

  // POST /api/items → add an item, bought (purchase transaction) or already
  // owned (opening entry at today's value). A $0 basis books nothing.
  r.post('/', validate('json', itemCreateSchema), async (c) => {
    const input = c.req.valid('json')
    const acq = input.acquisition
    const basis = acq.mode === 'purchase' ? acq.costCents : acq.valueCents

    const id = await db.transaction(async (tx) => {
      let txnId: number | null = null
      if (basis > 0) {
        const kindId = await kindAccount(tx, input.kind)
        if (acq.mode === 'purchase') {
          await checkCashAccount(tx, acq.fromAccountId)
          txnId = await insertTxn(
            tx,
            {
              date: acq.date,
              description: `Bought: ${input.name}`,
              kind: 'normal',
            },
            purchasePostings(kindId, acq.fromAccountId, basis),
          )
        } else {
          const openingId = await systemAccountId(tx, OPENING_BALANCES_KEY)
          txnId = await insertTxn(
            tx,
            {
              date: acq.date,
              description: `Opening balance: ${input.name}`,
              kind: 'opening',
            },
            baselinePostings(kindId, openingId, basis),
          )
        }
      }

      const [item] = await tx
        .insert(items)
        .values({
          kind: input.kind,
          name: input.name,
          quantity: input.quantity,
          condition: input.condition ?? null,
          notes: input.notes ?? null,
          costBasisCents: basis,
          basisSource: acq.mode === 'purchase' ? 'purchase' : 'baseline',
          acquiredDate: acq.date,
          acquiredTxnId: txnId,
        })
        .returning({ id: items.id })
      if (!item) throw new Error('Insert returned no row')

      let card: ItemOut['card'] = null
      let game: ItemOut['game'] = null
      if (input.card) {
        card = {
          categoryId: input.card.categoryId,
          groupId: input.card.groupId,
          productId: input.card.productId,
          subType: input.card.subType ?? null,
          setName: input.card.setName,
          number: input.card.number ?? null,
          rarity: input.card.rarity ?? null,
          imageUrl: input.card.imageUrl ?? null,
        }
        await tx.insert(cardDetails).values({
          itemId: item.id,
          categoryId: card.categoryId,
          groupId: card.groupId,
          tcgplayerProductId: card.productId,
          subType: card.subType,
          setName: card.setName,
          number: card.number,
          rarity: card.rarity,
          imageUrl: card.imageUrl,
        })
      } else if (input.game) {
        game = {
          platform: input.game.platform,
          url: input.game.url ?? null,
          variant: input.game.variant,
          imageUrl: input.game.imageUrl ?? null,
        }
        await tx.insert(gameDetails).values({
          itemId: item.id,
          platform: game.platform,
          pricechartingUrl: game.url,
          variant: game.variant,
          imageUrl: game.imageUrl,
        })
      }

      if (input.observedPrice) {
        const key = priceKeyFor({ id: item.id, card, game })
        // A lookup price for a shared product never overwrites what's already
        // recorded for that day; a manual price belongs to this item alone.
        await recordSnapshot(
          tx,
          key,
          input.observedPrice.priceCents,
          input.observedPrice.asOf,
          key.source === 'manual',
        )
      }
      return item.id
    })
    return c.json(await loadItem(db, id), 201)
  })

  // PATCH /api/items/:id → edit. Basis, date and quantity are locked once sold.
  r.patch('/:id', validate('json', itemUpdateSchema), async (c) => {
    const id = idParam(c.req.param('id'))
    const input = c.req.valid('json')
    await db.transaction(async (tx) => {
      const item = await loadItem(tx, id)
      const sold = item.soldDate !== null
      const basisChanged =
        input.costBasisCents !== undefined &&
        input.costBasisCents !== item.costBasisCents
      const dateChanged =
        input.acquiredDate !== undefined &&
        input.acquiredDate !== item.acquiredDate
      if (
        sold &&
        (basisChanged || dateChanged || input.quantity !== undefined)
      ) {
        fail(409, 'Undo the sale before changing cost, date or quantity')
      }
      const exclusive =
        item.acquiredTxnId === null ||
        (await itemsSharingTxn(tx, item.acquiredTxnId)) === 1
      if ((basisChanged || dateChanged) && !exclusive) {
        fail(
          409,
          'This item shares its purchase with a portion that was sold, so its cost is fixed',
        )
      }

      // Cost basis: keep the acquisition transaction in step.
      if (basisChanged) {
        const basis = input.costBasisCents!
        const kindId = await kindAccount(tx, item.kind)
        if (item.acquiredTxnId !== null) {
          const lines = await tx
            .select()
            .from(postings)
            .where(eq(postings.transactionId, item.acquiredTxnId))
          if (lines.length !== 2)
            fail(
              409,
              'The purchase transaction has been split; edit it in the ledger',
            )
          if (basis === 0) {
            await tx
              .update(items)
              .set({ acquiredTxnId: null })
              .where(eq(items.id, id))
            await tx
              .delete(transactions)
              .where(eq(transactions.id, item.acquiredTxnId))
          } else {
            for (const line of lines) {
              await tx
                .update(postings)
                .set({
                  amountCents: line.accountId === kindId ? basis : -basis,
                })
                .where(eq(postings.id, line.id))
            }
          }
        } else if (basis > 0) {
          if (item.basisSource === 'purchase') {
            fail(
              400,
              'This item was recorded as free. Delete and re-add it to book what you paid',
            )
          }
          const openingId = await systemAccountId(tx, OPENING_BALANCES_KEY)
          const txnId = await insertTxn(
            tx,
            {
              date: input.acquiredDate ?? item.acquiredDate,
              description: `Opening balance: ${item.name}`,
              kind: 'opening',
            },
            baselinePostings(kindId, openingId, basis),
          )
          await tx
            .update(items)
            .set({ acquiredTxnId: txnId })
            .where(eq(items.id, id))
        }
      }

      // Date and name flow through to an exclusively-owned acquisition transaction.
      const [current] = await tx
        .select({ txnId: items.acquiredTxnId })
        .from(items)
        .where(eq(items.id, id))
      if (current?.txnId && exclusive) {
        const name = input.name ?? item.name
        await tx
          .update(transactions)
          .set({
            date: input.acquiredDate ?? item.acquiredDate,
            description: `${item.basisSource === 'purchase' ? 'Bought' : 'Opening balance'}: ${name}`,
            updatedAt: sql`now()`,
          })
          .where(eq(transactions.id, current.txnId))
      }

      const changes = {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.quantity !== undefined && { quantity: input.quantity }),
        ...(input.condition !== undefined && { condition: input.condition }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.costBasisCents !== undefined && {
          costBasisCents: input.costBasisCents,
        }),
        ...(input.acquiredDate !== undefined && {
          acquiredDate: input.acquiredDate,
        }),
      }
      // An edit may touch only details or the price; an empty SET isn't valid SQL.
      if (Object.keys(changes).length > 0) {
        await tx.update(items).set(changes).where(eq(items.id, id))
      }

      if (item.card && input.subType !== undefined) {
        await tx
          .update(cardDetails)
          .set({ subType: input.subType })
          .where(eq(cardDetails.itemId, id))
      }
      if (
        item.game &&
        (input.platform !== undefined || input.variant !== undefined)
      ) {
        await tx
          .update(gameDetails)
          .set({
            ...(input.platform !== undefined && { platform: input.platform }),
            ...(input.variant !== undefined && { variant: input.variant }),
          })
          .where(eq(gameDetails.itemId, id))
      }

      if (input.manualPriceCents !== undefined) {
        const key = priceKeyFor(item)
        if (key.source !== 'manual') {
          fail(
            400,
            'This item is priced from its lookup source; manual prices are for unlisted items',
          )
        }
        await recordSnapshot(
          tx,
          key,
          input.manualPriceCents,
          input.today ?? todayUtc(),
          true,
        )
      }
    })
    return c.json(await loadItem(db, id))
  })

  // POST /api/items/:id/sell → sell all or part of an item.
  r.post('/:id/sell', validate('json', itemSellSchema), async (c) => {
    const id = idParam(c.req.param('id'))
    const input = c.req.valid('json')
    const soldId = await db.transaction(async (tx) => {
      const item = await loadItem(tx, id)
      if (item.soldDate !== null) fail(409, 'This item is already sold')
      if (input.quantity > item.quantity)
        fail(400, `Only ${item.quantity} owned`)
      if (input.proceedsCents > 0) {
        if (input.toAccountId === undefined)
          fail(400, 'Choose the account the money went to')
        await checkCashAccount(tx, input.toAccountId)
      }

      // A partial sale splits the row: the sold part becomes its own item.
      let targetId = id
      let basis = item.costBasisCents
      if (input.quantity < item.quantity) {
        const { soldCents, keptCents } = splitBasis(
          item.costBasisCents,
          item.quantity,
          input.quantity,
        )
        await tx
          .update(items)
          .set({
            quantity: item.quantity - input.quantity,
            costBasisCents: keptCents,
          })
          .where(eq(items.id, id))
        const [copy] = await tx
          .insert(items)
          .values({
            kind: item.kind,
            name: item.name,
            quantity: input.quantity,
            condition: item.condition,
            notes: item.notes,
            costBasisCents: soldCents,
            basisSource: item.basisSource,
            acquiredDate: item.acquiredDate,
            acquiredTxnId: item.acquiredTxnId,
          })
          .returning({ id: items.id })
        if (!copy) throw new Error('Insert returned no row')
        targetId = copy.id
        basis = soldCents
        if (item.card) {
          await tx.insert(cardDetails).values({
            itemId: copy.id,
            categoryId: item.card.categoryId,
            groupId: item.card.groupId,
            tcgplayerProductId: item.card.productId,
            subType: item.card.subType,
            setName: item.card.setName,
            number: item.card.number,
            rarity: item.card.rarity,
            imageUrl: item.card.imageUrl,
          })
        }
        if (item.game) {
          await tx.insert(gameDetails).values({
            itemId: copy.id,
            platform: item.game.platform,
            pricechartingUrl: item.game.url,
            variant: item.game.variant,
            imageUrl: item.game.imageUrl,
          })
        }
      }

      const lines = salePostings({
        // Only absent when proceeds are $0, and then that line is left out.
        toAccountId: input.toAccountId ?? 0,
        kindAccountId: await kindAccount(tx, item.kind),
        gainsAccountId: await systemAccountId(tx, 'realized_gains'),
        basisCents: basis,
        proceedsCents: input.proceedsCents,
      })
      const txnId =
        lines.length > 0
          ? await insertTxn(
              tx,
              {
                date: input.date,
                description: `Sold: ${item.name}${input.quantity > 1 ? ` ×${input.quantity}` : ''}`,
                kind: 'normal',
              },
              lines,
            )
          : null
      await tx
        .update(items)
        .set({
          soldDate: input.date,
          soldTxnId: txnId,
          saleProceedsCents: input.proceedsCents,
        })
        .where(eq(items.id, targetId))
      return targetId
    })
    return c.json(await loadItem(db, soldId))
  })

  // DELETE /api/items/:id/sale → undo a sale (split rows stay split).
  r.delete('/:id/sale', async (c) => {
    const id = idParam(c.req.param('id'))
    await db.transaction(async (tx) => {
      const item = await loadItem(tx, id)
      if (item.soldDate === null) fail(409, 'This item is not sold')
      await tx
        .update(items)
        .set({ soldDate: null, soldTxnId: null, saleProceedsCents: null })
        .where(eq(items.id, id))
      if (item.soldTxnId !== null) {
        await tx.delete(transactions).where(eq(transactions.id, item.soldTxnId))
      }
    })
    return c.json(await loadItem(db, id))
  })

  // DELETE /api/items/:id → remove an unsold item and its acquisition entry.
  r.delete('/:id', async (c) => {
    const id = idParam(c.req.param('id'))
    await db.transaction(async (tx) => {
      const item = await loadItem(tx, id)
      if (item.soldDate !== null)
        fail(409, 'Undo the sale before deleting this item')
      if (
        item.acquiredTxnId !== null &&
        (await itemsSharingTxn(tx, item.acquiredTxnId)) > 1
      ) {
        fail(
          409,
          'This item shares its purchase with a portion that was sold, so it can’t be deleted',
        )
      }
      await tx.delete(items).where(eq(items.id, id))
      if (item.acquiredTxnId !== null) {
        await tx
          .delete(transactions)
          .where(eq(transactions.id, item.acquiredTxnId))
      }
    })
    return c.json({ ok: true })
  })

  return r
}
