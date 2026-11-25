import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  fetchPriceChartingPage,
  normalizePriceChartingUrl,
  parsePriceChartingPage,
  platformLabel,
  USER_AGENT,
} from '../../lib/pricing/pricecharting.ts'

// A real product page, saved 2026-11-24. If PriceCharting changes its markup,
// re-save a page and this test shows exactly what broke.
const fixture = readFileSync(
  'tests/fixtures/pricecharting/super-mario-world.html',
  'utf-8',
)

describe('parsePriceChartingPage', () => {
  it('reads the name, loose / CIB / new prices and cover photo from a real page', () => {
    expect(parsePriceChartingPage(fixture)).toEqual({
      name: 'Super Mario World',
      prices: { loose: 1989, cib: 63503, new: 188000 },
      imageUrl:
        'https://storage.googleapis.com/images.pricecharting.com/w4tqsjcg7clrvypq/240.jpg',
    })
  })

  it("ignores the day's change amount that follows each price", () => {
    // The used_price cell also contains "+$0.40"; only $19.89 should be read.
    expect(parsePriceChartingPage(fixture).prices.loose).toBe(1989)
  })

  it('returns null for a missing price', () => {
    // Cells must sit in a table: HTML parsers drop stray <td>s, as browsers do.
    const html = `<h1 id="product_name">Obscure Game <a>Platform</a></h1>
      <table><tr>
        <td id="used_price"><span class="price js-price">$5.00</span></td>
        <td id="complete_price"><span class="price js-price">-</span></td>
      </tr></table>`
    expect(parsePriceChartingPage(html).prices).toEqual({
      loose: 500,
      cib: null,
      new: null,
    })
  })

  it('has no image when the page has no cover photo, or only a relative placeholder', () => {
    const page = (cover: string) =>
      parsePriceChartingPage(`<h1 id="product_name">Game</h1>
        <div id="product_details">${cover}</div>
        <table><tr><td id="used_price"><span class="js-price">$1.00</span></td></tr></table>`)
    expect(page('').imageUrl).toBeNull()
    expect(
      page(
        '<div class="cover"><img src="/images/no-image-available.png"></div>',
      ).imageUrl,
    ).toBeNull()
  })

  it('throws on a page that is not a product page', () => {
    expect(() =>
      parsePriceChartingPage('<html><body>Search results</body></html>'),
    ).toThrow()
  })
})

describe('normalizePriceChartingUrl', () => {
  it('accepts product URLs and canonicalizes them', () => {
    expect(
      normalizePriceChartingUrl(
        'https://pricecharting.com/game/Nintendo-3DS/Some-Game/?q=1',
      ),
    ).toEqual({
      url: 'https://www.pricecharting.com/game/nintendo-3ds/some-game',
      path: '/game/nintendo-3ds/some-game',
      platform: 'nintendo-3ds',
    })
  })

  it.each([
    'not a url',
    'https://evil.example.com/game/snes/x',
    'https://www.pricecharting.com/search-products?q=mario',
    'https://www.pricecharting.com/console/super-nintendo',
    'ftp://www.pricecharting.com/game/snes/x',
  ])('rejects %s', (input) => {
    expect(normalizePriceChartingUrl(input)).toBeNull()
  })
})

describe('platformLabel', () => {
  it('makes a readable guess from the URL slug', () => {
    expect(platformLabel('nintendo-3ds')).toBe('Nintendo 3DS')
    expect(platformLabel('super-nintendo')).toBe('Super Nintendo')
    expect(platformLabel('playstation-5')).toBe('Playstation 5')
    expect(platformLabel('ps2')).toBe('PS2')
  })
})

describe('fetchPriceChartingPage', () => {
  it('sends the honest User-Agent and parses the response', async () => {
    let sentAgent: string | null = null
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      sentAgent = new Headers(init?.headers).get('User-Agent')
      return new Response(fixture)
    }) as typeof fetch
    const page = await fetchPriceChartingPage(
      fakeFetch,
      'https://www.pricecharting.com/game/super-nintendo/super-mario-world',
    )
    expect(sentAgent).toBe(USER_AGENT)
    expect(page.name).toBe('Super Mario World')
  })

  it('throws on an HTTP error', async () => {
    const fakeFetch = (async () =>
      new Response('', { status: 404 })) as unknown as typeof fetch
    await expect(
      fetchPriceChartingPage(
        fakeFetch,
        'https://www.pricecharting.com/game/a/b',
      ),
    ).rejects.toThrow('404')
  })
})
