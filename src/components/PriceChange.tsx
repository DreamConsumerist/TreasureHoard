// A small ▲/▼ change amount (e.g. a 7-day price move), or nothing if unknown or zero.

import { formatMoney } from '../../lib/ledger/money.ts'

export function PriceChange({
  cents,
  suffix,
  className = '',
}: {
  cents: number | null
  /** e.g. "7d", shown after the amount. */
  suffix?: string
  className?: string
}) {
  if (cents === null || cents === 0) return null
  const up = cents > 0
  return (
    <span
      className={`text-xs whitespace-nowrap tabular-nums ${
        up
          ? 'text-green-700 dark:text-green-400'
          : 'text-red-600 dark:text-red-400'
      } ${className}`}
      title={suffix === '7d' ? 'Change over the last 7 days' : undefined}
    >
      {up ? '▲' : '▼'}
      {formatMoney(Math.abs(cents))}
      {suffix && <span className="ml-0.5 text-zinc-500">{suffix}</span>}
    </span>
  )
}
