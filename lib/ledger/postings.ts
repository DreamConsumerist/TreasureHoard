// Posting rules and the simple-form ↔ postings conversion.
//
// A transaction is a set of postings (account + signed amount) summing to zero.
// The simple form ("From X → To Y, amount A") covers the common two-account
// case: it debits the "to" account and credits the "from" account.
//   From Checking    → To Groceries   : spending
//   From Salary      → To Checking    : income
//   From Credit Card → To Dining      : spending on credit
//   From Checking    → To Credit Card : paying the card

export interface PostingInput {
  accountId: number
  amountCents: number
  memo?: string | null
}

export interface SimpleTransfer {
  amountCents: number // always positive
  fromAccountId: number
  toAccountId: number
}

/** Returns a list of problems; an empty list means the postings are valid. */
export function validatePostings(postings: readonly PostingInput[]): string[] {
  const errors: string[] = []
  if (postings.length < 2)
    errors.push('A transaction needs at least two postings.')
  let sum = 0
  postings.forEach((p, i) => {
    if (!Number.isSafeInteger(p.amountCents)) {
      errors.push(`Posting ${i + 1}: amount must be a whole number of cents.`)
    } else if (p.amountCents === 0) {
      errors.push(`Posting ${i + 1}: amount can't be zero.`)
    }
    sum += p.amountCents
  })
  if (errors.length === 0 && sum !== 0) {
    errors.push(`Postings must sum to zero (they're off by ${sum} cents).`)
  }
  return errors
}

export function simpleToPostings(t: SimpleTransfer): PostingInput[] {
  return [
    { accountId: t.toAccountId, amountCents: t.amountCents },
    { accountId: t.fromAccountId, amountCents: -t.amountCents },
  ]
}

/**
 * The simple-form view of a transaction, if it has one: exactly two postings,
 * equal and opposite, without memos. Otherwise null (the form opens in split mode).
 */
export function postingsToSimple(
  postings: readonly PostingInput[],
): SimpleTransfer | null {
  if (postings.length !== 2) return null
  const [a, b] = postings as [PostingInput, PostingInput]
  if (a.amountCents + b.amountCents !== 0 || a.amountCents === 0) return null
  if (a.memo || b.memo) return null
  const [to, from] = a.amountCents > 0 ? [a, b] : [b, a]
  return {
    amountCents: to.amountCents,
    fromAccountId: from.accountId,
    toAccountId: to.accountId,
  }
}
