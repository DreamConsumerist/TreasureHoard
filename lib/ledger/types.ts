// API response shapes shared by the server routes and the frontend.
// Kept free of server imports so the browser build can use them.

export interface PostingOut {
  id: number
  accountId: number
  amountCents: number
  memo: string | null
}

export interface TransactionOut {
  id: number
  date: string
  description: string
  notes: string | null
  status: 'pending' | 'cleared'
  kind: 'normal' | 'opening'
  postings: PostingOut[]
  /** Only when listing one account: this transaction's net effect on it, and the balance after it. */
  accountAmountCents?: number
  runningBalanceCents?: number
}

export interface TransactionPage {
  items: TransactionOut[]
  nextCursor: string | null
}

export interface DashboardData {
  bookNetWorthCents: number
  cashCents: number
  spending: {
    thisMonthCents: number
    lastMonthCents: number
    topCategories: { accountId: number; name: string; cents: number }[]
  }
  recent: TransactionOut[]
}

export interface Suggestion {
  description: string
  postings: PostingOut[]
}
