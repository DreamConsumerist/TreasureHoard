// Money helpers. Amounts are integer cents everywhere; these are the only
// places that convert between cents and human-readable text.
//
// Parsing is done on the string itself, never with parseFloat(x) * 100, which
// produces float errors (e.g. 1.15 * 100 = 114.99999999999999).

const MONEY_PATTERN = /^(-)?(\d*)(?:\.(\d{0,2}))?$/

/**
 * Parse user input like "12", "12.5", "1,234.56", "$-3.10" into integer cents.
 * Returns null for anything that isn't a valid amount (including more than two
 * decimal places, or an empty string).
 */
export function parseMoney(input: string): number | null {
  const cleaned = input.trim().replace(/[$,\s]/g, '')
  const match = MONEY_PATTERN.exec(cleaned)
  if (!match) return null
  const [, minus, whole = '', frac = ''] = match
  if (whole === '' && frac === '') return null // "", "-", "." and "-." aren't amounts
  const cents = Number(whole || '0') * 100 + Number(frac.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents)) return null
  return minus && cents !== 0 ? -cents : cents
}

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

/** Format cents for display: 123456 → "$1,234.56", -500 → "-$5.00". */
export function formatMoney(cents: number): string {
  return usd.format(cents / 100)
}

/** Format cents for an editable input field: 123456 → "1234.56", -5 → "-0.05". */
export function centsToInput(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const whole = Math.trunc(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')
  return `${sign}${whole}.${frac}`
}
