// Recurring transactions: the date rules and the bill-rescaling rule.
// Pure functions with no database or Netlify imports, so the frontend uses
// them too (schedule previews, the confirm dialog). The database side
// (generating due occurrences) is in lib/api/ledger/recurring.ts.

import type { PostingInput } from './postings.ts'

export const FREQUENCIES = ['week', 'month', 'year'] as const
export type Frequency = (typeof FREQUENCIES)[number]

export interface Schedule {
  frequency: Frequency
  interval: number
  startDate: string // 'YYYY-MM-DD'
  endDate?: string | null
}

const parse = (iso: string) =>
  iso.split('-').map(Number) as [number, number, number]
const iso = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const daysInMonth = (y: number, m: number) =>
  new Date(Date.UTC(y, m, 0)).getUTCDate()

/**
 * The k-th occurrence (k = 0 is the start date). Always computed from the
 * start, never from the previous occurrence, so a bill due on the 31st falls
 * on Feb 28 (or 29) and is back on Mar 31. Feb 29 yearly falls on Feb 28 in
 * other years.
 */
export function occurrenceDate(s: Schedule, k: number): string {
  const [y, m, d] = parse(s.startDate)
  if (s.frequency === 'week') {
    const t = Date.UTC(y, m - 1, d) + k * s.interval * 7 * 86_400_000
    return new Date(t).toISOString().slice(0, 10)
  }
  const months = k * s.interval * (s.frequency === 'year' ? 12 : 1)
  const total = y * 12 + (m - 1) + months
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return iso(ny, nm, Math.min(d, daysInMonth(ny, nm)))
}

/** Up to `count` occurrence dates from index `from` on, stopping at the end date. */
export function occurrencesFrom(
  s: Schedule,
  from: number,
  count: number,
): string[] {
  const out: string[] = []
  for (let k = from; out.length < count; k++) {
    const d = occurrenceDate(s, k)
    if (s.endDate && d > s.endDate) break
    out.push(d)
  }
  return out
}

/** The first occurrence index whose date is after `date` (for re-counting after a schedule edit). */
export function firstIndexAfter(s: Schedule, date: string): number {
  let k = 0
  // Bounded: a weekly schedule over a century is ~5,200 steps.
  while (k < 100_000 && occurrenceDate(s, k) <= date) k++
  return k
}

const ordinal = (n: number) => {
  const tens = n % 100
  const suffix =
    tens >= 11 && tens <= 13
      ? 'th'
      : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ??
        'th')
  return `${n}${suffix}`
}
const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** "Monthly on the 15th", "Every 2 weeks on Friday", "Yearly on Mar 3". */
export function describeSchedule(s: Schedule): string {
  const [y, m, d] = parse(s.startDate)
  const unit = { week: 'week', month: 'month', year: 'year' }[s.frequency]
  const every =
    s.interval === 1
      ? { week: 'Weekly', month: 'Monthly', year: 'Yearly' }[s.frequency]
      : `Every ${s.interval} ${unit}s`
  if (s.frequency === 'week')
    return `${every} on ${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}`
  if (s.frequency === 'month')
    return `${every} on the ${d >= 29 ? `${ordinal(d)} (or the month's last day)` : ordinal(d)}`
  return `${every} on ${MONTHS[m - 1]} ${d}`
}

/** A transaction's size: the sum of its debits (equal to its credits). */
export const transactionTotal = (
  postings: readonly { amountCents: number }[],
) => postings.reduce((s, p) => s + Math.max(p.amountCents, 0), 0)

/**
 * Scales a bill to a new total, keeping its split proportions. The "paying"
 * line is the single posting on the opposite side from all the others (the
 * Checking −$120 against Utilities +$60 and Owed to me +$60). It becomes the
 * new total, and the other lines share the same total in their old
 * proportions. Rounding uses the largest-remainder method, so the lines
 * always add up exactly: $138.41 split 50/50 is $69.21 + $69.20.
 *
 * Returns null when there's no single paying line (two accounts on each
 * side), the total isn't positive, or a line would round to zero. The UI then
 * falls back to the full editor.
 */
export function rescaleToTotal<P extends PostingInput>(
  postings: readonly P[],
  totalCents: number,
): P[] | null {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) return null
  const negatives = postings.filter((p) => p.amountCents < 0)
  const positives = postings.filter((p) => p.amountCents > 0)
  const payer =
    negatives.length === 1
      ? negatives[0]
      : positives.length === 1
        ? positives[0]
        : null
  if (!payer || negatives.length + positives.length !== postings.length)
    return null

  const others = postings.filter((p) => p !== payer)
  const weights = others.map((p) => BigInt(Math.abs(p.amountCents)))
  const weightSum = weights.reduce((a, b) => a + b, 0n)
  const total = BigInt(totalCents)
  const shares = weights.map((w, i) => ({
    i,
    floor: (total * w) / weightSum,
    rem: (total * w) % weightSum,
  }))
  let left = total - shares.reduce((a, s) => a + s.floor, 0n)
  // Hand the leftover cents to the largest remainders (earlier lines win ties).
  const byRem = [...shares].sort((a, b) =>
    a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1,
  )
  const extra = new Set<number>()
  for (const s of byRem) {
    if (left === 0n) break
    extra.add(s.i)
    left -= 1n
  }

  const payerSign = Math.sign(payer.amountCents)
  const scaled = new Map<P, number>()
  scaled.set(payer, payerSign * totalCents)
  others.forEach((p, i) => {
    const cents = Number(shares[i]!.floor) + (extra.has(i) ? 1 : 0)
    scaled.set(p, -payerSign * cents)
  })
  if ([...scaled.values()].some((c) => c === 0)) return null
  return postings.map((p) => ({ ...p, amountCents: scaled.get(p)! }))
}
