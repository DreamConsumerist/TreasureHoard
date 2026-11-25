// /api/groups: collection groups (a deck, a binder). A group is purely an
// organizing layer: each item keeps its own cost, price and ledger entry, and
// the group adds up its unsold items with the same valuation rules as the
// Dashboard (never-priced items count at cost). The ledger is never touched.

import { and, asc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { itemGroups, items } from '../../../db/schema.ts'
import type { Db, Tx } from '../../../db/types.ts'
import {
  groupAddItemsSchema,
  groupCreateSchema,
  groupUpdateSchema,
} from '../../collection/schemas.ts'
import type {
  GroupDetailOut,
  GroupOut,
  ItemOut,
} from '../../collection/types.ts'
import {
  marketValueCents,
  weekChangeCents,
} from '../../collection/valuation.ts'
import { fail, idParam, validate } from '../errors.ts'
import { loadItems } from './items.ts'

type GroupRow = typeof itemGroups.$inferSelect

const imageOf = (i: ItemOut) => i.card?.imageUrl ?? i.game?.imageUrl ?? null

/** A group's totals over its unsold items, and its cover picture. */
export function summarize(g: GroupRow, groupItems: ItemOut[]): GroupOut {
  const owned = groupItems.filter((i) => i.soldDate === null)
  const changes = owned
    .map(weekChangeCents)
    .filter((c): c is number => c !== null)
  const byValue = [...owned].sort(
    (a, b) => marketValueCents(b) - marketValueCents(a),
  )
  const cover = groupItems.find((i) => i.id === g.coverItemId)
  return {
    id: g.id,
    name: g.name,
    notes: g.notes,
    coverItemId: g.coverItemId,
    imageUrl:
      (cover && imageOf(cover)) ??
      byValue.map(imageOf).find((u) => u !== null) ??
      null,
    itemCount: owned.length,
    cardCount: owned.reduce((s, i) => s + i.quantity, 0),
    costCents: owned.reduce((s, i) => s + i.costBasisCents, 0),
    marketCents: owned.reduce((s, i) => s + marketValueCents(i), 0),
    weekChangeCents:
      changes.length > 0 ? changes.reduce((s, c) => s + c, 0) : null,
  }
}

async function loadGroup(db: Db | Tx, id: number): Promise<GroupDetailOut> {
  const [g] = await db.select().from(itemGroups).where(eq(itemGroups.id, id))
  if (!g) fail(404, 'Group not found')
  const groupItems = await loadItems(db, [eq(items.itemGroupId, id)])
  return { ...summarize(g, groupItems), items: groupItems }
}

/** Fails with 409 if another group already has this name (case-insensitive). */
async function checkNameFree(db: Db, name: string, exceptId?: number) {
  const [clash] = await db
    .select({ id: itemGroups.id })
    .from(itemGroups)
    .where(sql`lower(${itemGroups.name}) = lower(${name})`)
  if (clash && clash.id !== exceptId)
    fail(409, `There's already a group called "${name}"`)
}

/** Creates a group (used by the import too). Returns its id. */
export async function createGroup(
  db: Db | Tx,
  name: string,
  notes: string | null = null,
): Promise<number> {
  const [g] = await db
    .insert(itemGroups)
    .values({ name, notes })
    .returning({ id: itemGroups.id })
  return g!.id
}

export function groupRoutes(db: Db) {
  const r = new Hono()

  // Every group with its totals, by name.
  r.get('/', async (c) => {
    const groups = await db
      .select()
      .from(itemGroups)
      .orderBy(asc(sql`lower(${itemGroups.name})`))
    const grouped = await loadItems(db, [isNotNull(items.itemGroupId)])
    const out: GroupOut[] = groups.map((g) =>
      summarize(
        g,
        grouped.filter((i) => i.itemGroup?.id === g.id),
      ),
    )
    return c.json(out)
  })

  r.get('/:id', async (c) =>
    c.json(await loadGroup(db, idParam(c.req.param('id')))),
  )

  r.post('/', validate('json', groupCreateSchema), async (c) => {
    const input = c.req.valid('json')
    await checkNameFree(db, input.name)
    const id = await createGroup(db, input.name, input.notes ?? null)
    return c.json(await loadGroup(db, id), 201)
  })

  r.patch('/:id', validate('json', groupUpdateSchema), async (c) => {
    const id = idParam(c.req.param('id'))
    const input = c.req.valid('json')
    await loadGroup(db, id) // 404 if missing
    if (input.name !== undefined) await checkNameFree(db, input.name, id)
    if (input.coverItemId) {
      const [item] = await db
        .select({ group: items.itemGroupId })
        .from(items)
        .where(eq(items.id, input.coverItemId))
      if (item?.group !== id) fail(400, 'The cover must be one of its items')
    }
    const changes = {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(input.coverItemId !== undefined && {
        coverItemId: input.coverItemId,
      }),
    }
    if (Object.keys(changes).length > 0) {
      await db.update(itemGroups).set(changes).where(eq(itemGroups.id, id))
    }
    return c.json(await loadGroup(db, id))
  })

  // Its items stay in the collection, ungrouped (on delete set null).
  r.delete('/:id', async (c) => {
    const id = idParam(c.req.param('id'))
    const deleted = await db
      .delete(itemGroups)
      .where(eq(itemGroups.id, id))
      .returning({ id: itemGroups.id })
    if (deleted.length === 0) fail(404, 'Group not found')
    return c.json({ ok: true })
  })

  // Put items in this group, moving them out of any other.
  r.post('/:id/items', validate('json', groupAddItemsSchema), async (c) => {
    const id = idParam(c.req.param('id'))
    const { itemIds } = c.req.valid('json')
    await loadGroup(db, id)
    const ids = [...new Set(itemIds)]
    const found = await db
      .select({ id: items.id })
      .from(items)
      .where(inArray(items.id, ids))
    if (found.length !== ids.length)
      fail(400, 'Some of those items no longer exist')
    await db.transaction(async (tx) => {
      // A cover that just left another group stops being that group's cover.
      await tx
        .update(itemGroups)
        .set({ coverItemId: null })
        .where(and(inArray(itemGroups.coverItemId, ids), ne(itemGroups.id, id)))
      await tx
        .update(items)
        .set({ itemGroupId: id })
        .where(inArray(items.id, ids))
    })
    return c.json(await loadGroup(db, id))
  })

  return r
}
