// PriceCharting: prices for games and hardware, read from the public product
// page. (Their API costs $50/month; scraping this narrowly for personal use is
// an accepted risk, see ARCHITECTURE.md.)
//
// Rules that keep it polite and contained:
//   * only stored product URLs are fetched; no crawling, no search;
//   * one request per user action (here) or per item per weekly sync (Step 4);
//   * an honest User-Agent;
//   * all parsing lives in parsePriceChartingPage, so a markup change means
//     fixing this one function (a saved page in tests/fixtures catches it).

import * as cheerio from 'cheerio'
import { parseMoney } from '../ledger/money.ts'
import { SOURCE_HEADERS, USER_AGENT } from './http.ts'

export { USER_AGENT }

export type GameVariant = 'loose' | 'cib' | 'new'

export interface PriceChartingPage {
  name: string
  prices: Record<GameVariant, number | null>
  /** The product photo (240px wide), or null if the page has none. */
  imageUrl: string | null
}

// Page cell ids for each variant: "used" is PriceCharting's name for loose.
const CELL_IDS: Record<GameVariant, string> = {
  loose: 'used_price',
  cib: 'complete_price',
  new: 'new_price',
}

/** Parses a product page. Throws if it doesn't look like one (so a layout change fails loudly). */
export function parsePriceChartingPage(html: string): PriceChartingPage {
  const $ = cheerio.load(html)
  const title = $('h1#product_name')
  if (title.length === 0)
    throw new Error('Not a PriceCharting product page (no product name)')
  // The h1 also holds a link to the platform; keep only the product's own text.
  const name = title
    .contents()
    .filter((_, node) => node.type === 'text')
    .text()
    .replace(/\s+/g, ' ')
    .trim()

  const prices = {} as Record<GameVariant, number | null>
  let found = 0
  for (const [variant, id] of Object.entries(CELL_IDS) as [
    GameVariant,
    string,
  ][]) {
    const cell = $(`td#${id}`)
    if (cell.length > 0) found++
    // The first .js-price is the price; a later one inside .change is the day's movement.
    const text = cell.find('.js-price').first().text().trim()
    prices[variant] = text ? parseMoney(text) : null
  }
  if (found === 0)
    throw new Error('No price cells found on the PriceCharting page')
  // The cover photo; only an absolute https URL is kept (no-image pages use a
  // relative placeholder path).
  const src = $('#product_details .cover img').first().attr('src')?.trim()
  const imageUrl = src?.startsWith('https://') ? src : null

  return {
    name: name || title.text().replace(/\s+/g, ' ').trim(),
    prices,
    imageUrl,
  }
}

/**
 * Validates and normalizes a pasted PriceCharting product URL. Returns the
 * canonical URL and the platform slug from its path, or null if it isn't one.
 */
/**
 * One path segment in a single canonical spelling, so the same product always
 * gets the same price key: decoded, lowercased, then strictly re-encoded.
 * encodeURIComponent leaves ! ' ( ) * alone, but PriceCharting writes ' as
 * %27, so those are encoded too. Null if the segment's encoding is broken.
 */
function canonicalSegment(segment: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    return null
  }
  return encodeURIComponent(decoded.toLowerCase()).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

export function normalizePriceChartingUrl(
  input: string,
): { url: string; path: string; platform: string } | null {
  let u: URL
  try {
    u = new URL(input.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  if (
    u.hostname !== 'www.pricecharting.com' &&
    u.hostname !== 'pricecharting.com'
  )
    return null
  // Any characters within the two path segments: product slugs can carry
  // punctuation, e.g. clive-barker%27s-hellraiser-revival.
  const match = /^\/game\/([^/]+)\/([^/]+)\/?$/.exec(u.pathname)
  if (!match) return null
  const platform = canonicalSegment(match[1]!)
  const product = canonicalSegment(match[2]!)
  if (!platform || !product) return null
  const path = `/game/${platform}/${product}`
  return { url: `https://www.pricecharting.com${path}`, path, platform }
}

/** "nintendo-3ds" → "Nintendo 3DS" (a best guess; the user can edit it). */
export function platformLabel(slug: string): string {
  const special: Record<string, string> = {
    ds: 'DS',
    '3ds': '3DS',
    ps: 'PS',
    psp: 'PSP',
    gba: 'GBA',
    gbc: 'GBC',
    nes: 'NES',
    snes: 'SNES',
    n64: 'N64',
    pc: 'PC',
  }
  return slug
    .split('-')
    .map(
      (w) =>
        special[w] ??
        (/^ps\d$/.test(w)
          ? w.toUpperCase()
          : w.charAt(0).toUpperCase() + w.slice(1)),
    )
    .join(' ')
}

/** Fetches and parses one product page. */
export async function fetchPriceChartingPage(
  fetchFn: typeof fetch,
  url: string,
): Promise<PriceChartingPage> {
  const res = await fetchFn(url, { headers: SOURCE_HEADERS })
  if (!res.ok) throw new Error(`PriceCharting returned ${res.status}`)
  return parsePriceChartingPage(await res.text())
}
