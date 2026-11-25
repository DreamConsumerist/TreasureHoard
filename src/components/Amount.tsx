import { formatMoney } from '../../lib/ledger/money.ts'

/** A formatted money amount. `tone` colors negatives red (e.g. a balance that went below zero). */
export function Amount({
  cents,
  tone = false,
  className = '',
}: {
  cents: number
  tone?: boolean
  className?: string
}) {
  const color = tone && cents < 0 ? 'text-red-600 dark:text-red-400' : ''
  return (
    <span className={`tabular-nums ${color} ${className}`}>
      {formatMoney(cents)}
    </span>
  )
}
