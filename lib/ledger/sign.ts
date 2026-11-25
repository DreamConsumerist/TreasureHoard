// Account types and the "natural sign" used for display.
//
// Storage convention: positive = debit, negative = credit. Asset and expense
// accounts normally carry debit balances, so their stored sign already reads
// naturally. Liability, income and equity accounts normally carry credit
// balances (stored negative), so the UI flips them: a credit card with
// -42000 stored shows as "$420.00" owed, and a paycheck shows as positive income.

export const ACCOUNT_TYPES = [
  'asset',
  'liability',
  'equity',
  'income',
  'expense',
] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expenses',
}

/** True for account types whose normal balance is a debit (asset, expense). */
export function isDebitNormal(type: AccountType): boolean {
  return type === 'asset' || type === 'expense'
}

/** Convert a stored (debit-positive) amount to the sign a person expects for this account type. */
export function toNatural(cents: number, type: AccountType): number {
  return isDebitNormal(type) ? cents : -cents
}
