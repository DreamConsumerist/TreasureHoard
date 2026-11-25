// /api/collection/import: decklist import.
//
//   POST /preview  parse the pasted list and match each line to a printing in
//                  the card search index (read-only)
//   POST /         import the reviewed lines into a group, in one transaction
//
// Matching, per line, stopping at the first step that leaves one printing:
//   1. set code + collector number     → matched
//   2. name + collector number         → guessed (promos, The List…)
//   3. set code + name                 → guessed
//   4. name alone, one printing        → guessed
// Otherwise "choose" (several printings) or "notfound". Foil etched prefers
// the "(Foil Etched)" product, which is how TCGplayer lists etched cards.
//
// Copies you already own are handled by planLine (lib/collection/decklist.ts):
// already in the group → kept; in no group → moved in; in another group →
// untouched. The rest are added as cards you already own, at market value on
// the import date (opening entries, exactly like adding them by hand).

import { and, eq, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm'
import { Hono } from 'hono'
import {
  cardDetails,
  catalogGroups,
  catalogProducts,
  itemGroups,
  items,
} from '../../../db/schema.ts'
import type { Db, Tx } from '../../../db/types.ts'
import {
  parseDecklist,
  planLine,
  type DeckLine,
  type OwnedRow,
} from '../../collection/decklist.ts'
import { importPreviewSchema, importSchema } from '../../collection/schemas.ts'
import type {
  CatalogHit,
  ImportPreviewLine,
  ImportPreviewOut,
  ImportResultOut,
  MatchStatus,
} from '../../collection/types.ts'
import { GAMES } from '../../pricing/tcgcsv.ts'
import { fail, validate } from '../errors.ts'
import { createGroup } from './groups.ts'
import { checkItemGroup, createItem, loadItem, splitOff } from './items.ts'

const MAX_CANDIDATES = 40

/** "Forest (276)" → "forest"; "Ghalta, Primal Hunger (Showcase)" → "ghalta, primal hunger". */
export const baseName = (name: string) =>
  name
    .replace(/(\s*\([^()]*\))+\s*$/, '')
    .trim()
    .toLowerCase()

/** "0130" → "130", "130/196" → "130", "130s" stays. */
export const normNumber = (n: string | null) =>
  n === null
    ? null
    : n
        .split('/')[0]!
        .trim()
        .toLowerCase()
        .replace(/^0+(?=[0-9a-z])/, '')

function nameMatches(productName: string, lineName: string): boolean {
  const b = baseName(productName)
  const l = lineName.trim().toLowerCase()
  // Double-faced cards: TCGplayer lists "Front // Back"; lists may give either.
  return b === l || b.startsWith(`${l} // `) || l.startsWith(`${b} // `)
}

/** Matches one decklist line against the printings whose names fit it. */
export function matchLine(
  line: DeckLine,
  pool: CatalogHit[],
): Pick<ImportPreviewLine, 'status' | 'match' | 'candidates'> {
  const named = pool.filter((c) => nameMatches(c.name, line.name))
  const etched = (c: CatalogHit) => /\betched\b/i.test(c.name)
  // Prefer the right finish's product; if that rules out everything, keep all.
  const byFinish = (list: CatalogHit[]) => {
    const f = list.filter((c) =>
      line.finish === 'etched' ? etched(c) : !etched(c),
    )
    return f.length > 0 ? f : list
  }
  const one = (list: CatalogHit[], status: MatchStatus) => {
    const f = byFinish(list)
    return f.length === 1 ? { status, match: f[0]!, candidates: [] } : null
  }
  const inSet = (c: CatalogHit) =>
    line.setCode !== null && c.setCode?.toUpperCase() === line.setCode
  const sameNumber = (c: CatalogHit) =>
    line.number !== null && normNumber(c.number) === normNumber(line.number)

  const found =
    (line.setCode && line.number
      ? one(
          named.filter((c) => inSet(c) && sameNumber(c)),
          'matched',
        )
      : null) ??
    (line.number ? one(named.filter(sameNumber), 'guessed') : null) ??
    (line.setCode ? one(named.filter(inSet), 'guessed') : null) ??
    one(named, 'guessed')
  if (found) return found

  // Several printings: offer the ones in the named set first, if any.
  const setFirst = named.filter(inSet)
  const candidates = (setFirst.length > 0 ? setFirst : named)
    .sort(
      (a, b) =>
        (b.publishedOn ?? '').localeCompare(a.publishedOn ?? '') ||
        a.name.localeCompare(b.name),
    )
    .slice(0, MAX_CANDIDATES)
  return {
    status: candidates.length > 0 ? 'choose' : 'notfound',
    match: null,
    candidates,
  }
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (ch) => `\\${ch}`)

/** Every card printing whose name starts like one of these names (one query). */
async function loadPool(
  db: Db,
  categoryId: number,
  names: string[],
): Promise<CatalogHit[]> {
  const prefixes = [
    ...new Set(names.map((n) => n.split(' // ')[0]!.trim().toLowerCase())),
  ]
  if (prefixes.length === 0) return []
  const like: SQL[] = prefixes.map(
    (p) => sql`lower(${catalogProducts.name}) like ${`${likeEscape(p)}%`}`,
  )
  return db
    .select({
      productId: catalogProducts.productId,
      groupId: catalogProducts.groupId,
      setName: catalogGroups.name,
      setCode: catalogGroups.abbreviation,
      publishedOn: catalogGroups.publishedOn,
      name: catalogProducts.name,
      number: catalogProducts.number,
      rarity: catalogProducts.rarity,
      imageUrl: catalogProducts.imageUrl,
      sealed: catalogProducts.sealed,
    })
    .from(catalogProducts)
    .innerJoin(
      catalogGroups,
      eq(catalogGroups.groupId, catalogProducts.groupId),
    )
    .where(
      and(
        eq(catalogProducts.categoryId, categoryId),
        eq(catalogProducts.sealed, false),
        or(...like),
      ),
    )
}

/** Unsold rows of this printing and sub-type, with their groups. */
async function ownedRows(
  tx: Tx,
  productId: number,
  subType: string,
): Promise<OwnedRow[]> {
  const rows = await tx
    .select({
      itemId: items.id,
      quantity: items.quantity,
      itemGroupId: items.itemGroupId,
    })
    .from(items)
    .innerJoin(cardDetails, eq(cardDetails.itemId, items.id))
    .where(
      and(
        eq(cardDetails.tcgplayerProductId, productId),
        eq(cardDetails.subType, subType),
        isNull(items.soldDate),
      ),
    )
  return rows
}

export function importRoutes(db: Db) {
  const r = new Hono()

  r.post('/preview', validate('json', importPreviewSchema), async (c) => {
    const { game, text } = c.req.valid('json')
    const { categoryId } = GAMES[game]
    const { lines, skipped } = parseDecklist(text)
    if (lines.length > 250) fail(400, 'Up to 250 different cards per import')

    const [built] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(catalogGroups)
      .where(
        and(
          eq(catalogGroups.categoryId, categoryId),
          isNotNull(catalogGroups.productsSyncedAt),
        ),
      )
    const pool = await loadPool(
      db,
      categoryId,
      lines.map((l) => l.name),
    )
    const out: ImportPreviewOut = {
      indexed: (built?.n ?? 0) > 0,
      lines: lines.map((l) => ({ ...l, ...matchLine(l, pool) })),
      skipped,
    }
    return c.json(out)
  })

  r.post('/', validate('json', importSchema), async (c) => {
    const input = c.req.valid('json')
    const result = await db.transaction(async (tx) => {
      let target: number
      if (input.itemGroupId !== undefined) {
        await checkItemGroup(tx, input.itemGroupId)
        target = input.itemGroupId
      } else {
        const name = input.newGroupName!
        const [clash] = await tx
          .select({ id: itemGroups.id })
          .from(itemGroups)
          .where(sql`lower(${itemGroups.name}) = lower(${name})`)
        if (clash) fail(409, `There's already a group called "${name}"`)
        target = await createGroup(tx, name)
      }

      const totals: ImportResultOut = {
        itemGroupId: target,
        added: 0,
        moved: 0,
        present: 0,
      }
      for (const line of input.lines) {
        const plan = planLine(
          line.quantity,
          await ownedRows(tx, line.productId, line.subType),
          target,
          line.useExisting,
        )
        totals.present += plan.present

        for (const take of plan.fromUngrouped) {
          const item = await loadItem(tx, take.itemId)
          const movingId =
            take.quantity < item.quantity
              ? (await splitOff(tx, item, take.quantity)).id
              : item.id
          await tx
            .update(items)
            .set({ itemGroupId: target })
            .where(eq(items.id, movingId))
          totals.moved += take.quantity
        }

        if (plan.add > 0) {
          if (line.priceCents === null) {
            fail(
              400,
              `${line.name} (${line.setName}) has no market price. Add it by hand with a value instead.`,
            )
          }
          await createItem(tx, {
            kind: 'card',
            name: line.name,
            quantity: plan.add,
            condition: line.condition ?? null,
            notes: null,
            card: {
              categoryId: line.categoryId,
              groupId: line.groupId,
              productId: line.productId,
              subType: line.subType,
              setName: line.setName,
              number: line.number ?? null,
              rarity: line.rarity ?? null,
              imageUrl: line.imageUrl ?? null,
            },
            acquisition: {
              mode: 'baseline',
              date: input.date,
              valueCents: line.priceCents * plan.add,
            },
            observedPrice: { priceCents: line.priceCents, asOf: input.date },
            itemGroupId: target,
          })
          totals.added += plan.add
        }
      }
      return totals
    })
    return c.json(result, 201)
  })

  return r
}
