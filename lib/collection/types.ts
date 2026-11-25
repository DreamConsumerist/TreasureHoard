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
}

export interface ItemDetailOut extends ItemOut {
  priceHistory: { asOf: string; priceCents: number }[]
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

export interface PriceChartingLookupOut {
  url: string
  path: string
  name: string
  platform: string
  prices: { loose: number | null; cib: number | null; new: number | null }
  imageUrl: string | null
}
