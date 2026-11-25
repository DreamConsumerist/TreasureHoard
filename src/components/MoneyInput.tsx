import type { InputHTMLAttributes } from 'react'
import { parseMoney } from '../../lib/ledger/money.ts'

/**
 * A text field for money, with a fixed "$" shown inside the field's left edge.
 * The "$" is display only: it isn't part of the value (parseMoney would accept
 * it anyway), so typing or pasting with or without it works the same.
 *
 * It keeps the raw text (so typing "12." isn't reformatted mid-keystroke) and
 * flags it invalid if parseMoney rejects it. inputMode="decimal" brings up the
 * numeric keypad on phones. `large` is for the main amount field.
 */
export function MoneyInput({
  value,
  onChange,
  large = false,
  className = '',
  ...rest
}: {
  value: string
  onChange: (value: string) => void
  large?: boolean
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const invalid = value.trim() !== '' && parseMoney(value) === null
  const size = large ? 'text-2xl' : 'text-base'
  return (
    <div className={`relative ${className}`}>
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 left-3 flex items-center text-zinc-500 ${size}`}
      >
        $
      </span>
      <input
        {...rest}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid}
        className={`input tabular-nums ${size} ${large ? 'pl-8' : 'pl-7'} ${invalid ? 'border-red-500 dark:border-red-500' : ''}`}
      />
    </div>
  )
}
