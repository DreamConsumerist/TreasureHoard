import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
  type AccountType,
} from '../../lib/ledger/sign.ts'
import { useAccounts } from '../lib/queries.ts'

/**
 * Account selector: a native <select> grouped by type, showing full paths
 * ("Collection: Cards"). Native selects are keyboard-searchable on desktop
 * and use the phone's own picker on mobile. Archived accounts are hidden,
 * except the currently selected one (so editing an old transaction still shows it).
 */
export function AccountPicker({
  value,
  onChange,
  types = ACCOUNT_TYPES,
  placeholder = 'Choose account…',
  allowNone = false,
  excludeId,
  className = '',
  ...rest
}: {
  value: number | null
  onChange: (id: number | null) => void
  types?: readonly AccountType[]
  placeholder?: string
  allowNone?: boolean
  excludeId?: number
  className?: string
  'aria-label'?: string
  required?: boolean
}) {
  const { flat } = useAccounts()
  return (
    <select
      {...rest}
      value={value ?? ''}
      onChange={(e) =>
        onChange(e.target.value === '' ? null : Number(e.target.value))
      }
      className={`input ${className}`}
    >
      <option value="" disabled={!allowNone}>
        {placeholder}
      </option>
      {types.map((type) => {
        const options = flat.filter(
          (a) =>
            a.type === type &&
            a.id !== excludeId &&
            (!a.archived || a.id === value),
        )
        if (options.length === 0) return null
        return (
          <optgroup key={type} label={ACCOUNT_TYPE_LABELS[type]}>
            {options.map((a) => (
              <option key={a.id} value={a.id}>
                {a.path}
              </option>
            ))}
          </optgroup>
        )
      })}
    </select>
  )
}
