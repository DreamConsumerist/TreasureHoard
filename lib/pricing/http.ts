// Shared by the price-source clients.

/**
 * Sent on every request to a price source. TCGCSV refuses requests that don't
 * identify their application (Node's default "node" agent gets a 401), and
 * PriceCharting gets the same honest name rather than a disguised browser.
 */
export const USER_AGENT = 'TreasureHoard personal collection tracker'

export const SOURCE_HEADERS = { 'User-Agent': USER_AGENT } as const
