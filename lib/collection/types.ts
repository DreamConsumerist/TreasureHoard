// Collection API response shapes, shared by server and browser.

import type { ItemKind } from './accounting.ts'

export interface ItemOut {
  id: number
  kind: ItemKind
  name: string
  quantity: number
  condition: string | null
  notes: string | null
  costBasisCents: number
  basisSource: 'purchase' | 'baseline'
  acquiredDate: string
  acquiredTxnId: number | null
  soldTxnId: number | null
  soldDate: string | null
  saleProceedsCents: number | null
  /** The collection group (deck, binder) it belongs to, if any. */
  itemGroup: { id: number; name: string } | null
  card: {
    categoryId: number
    groupId: number
    productId: number
    subType: string | null
    setName: string
    number: string | null
    rarity: string | null
    imageUrl: string | null
  } | null
  game: {
    platform: string
    url: string | null
    variant: 'loose' | 'cib' | 'new'
    imageUrl: string | null
  } | null
  /** Latest known price for ONE unit, and the day it was seen. Null if never priced. */
  unitPriceCents: number | null
  priceAsOf: string | null
  /** Unit price from at least 7 days before the latest one, or null if none yet. */
  weekAgoPriceCents: number | null
}

export interface ItemDetailOut extends ItemOut {
  priceHistory: { asOf: string; priceCents: number }[]
}

/** A collection group with its unsold items added up. */
export interface GroupOut {
  id: number
  name: string
  notes: string | null
  coverItemId: number | null
  /** The cover item's picture, or its most valuable item's. */
  imageUrl: string | null
  /** Unsold items: rows, and copies (sum of quantities). */
  itemCount: number
  cardCount: number
  costCents: number
  /** Never-priced items count at cost (lib/collection/valuation.ts). */
  marketCents: number
  /** Sum of the 7-day changes that are known; null if none are. */
  weekChangeCents: number | null
}

export interface GroupDetailOut extends GroupOut {
  /** Every item in the group, sold ones included (their totals aren't counted). */
  items: ItemOut[]
}

export interface CollectionCheck {
  ok: boolean
  ledgerCents: number
  itemsCents: number
}

export interface TcgGroupOut {
  groupId: number
  name: string
  abbreviation: string | null
  publishedOn: string
}

export interface TcgProductOut {
  productId: number
  name: string
  number: string | null
  rarity: string | null
  imageUrl: string | null
  sealed: boolean
  prices: {
    subType: string
    marketCents: number | null
    lowCents: number | null
  }[]
}

/** A product in the card search index. */
export interface CatalogHit {
  productId: number
  groupId: number
  setName: string
  setCode: string | null
  publishedOn: string | null
  name: string
  number: string | null
  rarity: string | null
  imageUrl: string | null
  sealed: boolean
}

export interface CatalogSearchOut {
  /** False until the index has been built for this game (Settings → Price sync). */
  indexed: boolean
  results: CatalogHit[]
}

export interface PriceChartingLookupOut {
  url: string
  path: string
  name: string
  platform: string
  prices: { loose: number | null; cib: number | null; new: number | null }
  imageUrl: string | null
}

export type MatchStatus = 'matched' | 'guessed' | 'choose' | 'notfound'

/** One decklist line and what it matched in the card search index. */
export interface ImportPreviewLine {
  lineNo: number
  quantity: number
  name: string
  setCode: string | null
  number: string | null
  finish: 'normal' | 'foil' | 'etched'
  status: MatchStatus
  /** The printing used (matched / guessed), or null. */
  match: CatalogHit | null
  /** Printings to choose from (choose), newest first. */
  candidates: CatalogHit[]
}

export interface ImportPreviewOut {
  /** False until the card search index is built for this game. */
  indexed: boolean
  lines: ImportPreviewLine[]
  skipped: { lineNo: number; text: string; reason: string }[]
}

export interface ImportResultOut {
  itemGroupId: number
  /** Copies added as new items, moved in from no group, and already there. */
  added: number
  moved: number
  present: number
}
