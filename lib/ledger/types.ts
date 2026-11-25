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
  /** The recurring template that generated this transaction, if any. */
  recurringTemplateId: number | null
  postings: PostingOut[]
  /** Only when listing one account: this transaction's net effect on it, and the balance after it. */
  accountAmountCents?: number
  runningBalanceCents?: number
  /** Single-transaction reads only: the collection item this belongs to, if any. */
  linkedItemId?: number | null
}

export interface TransactionPage {
  items: TransactionOut[]
  nextCursor: string | null
}

export interface DashboardData {
  bookNetWorthCents: number
  cashCents: number
  /** The Collection subtree's balance: the collection at cost. */
  collectionCostCents: number
  /** Unsold items at their latest price (never-priced items at cost). */
  collectionMarketCents: number
  /** Book net worth with the collection at market value instead of cost. */
  marketNetWorthCents: number
  /** Biggest 7-day changes in owned items' total value. */
  movers: Mover[]
  spending: {
    thisMonthCents: number
    lastMonthCents: number
    topCategories: { accountId: number; name: string; cents: number }[]
  }
  recent: TransactionOut[]
  recurring: {
    /** Pending transactions made by templates, oldest first: waiting to be confirmed. */
    due: DueOccurrence[]
    /** Occurrences in the next 7 days (not created yet). */
    upcoming: UpcomingOccurrence[]
  }
  /** Sub-accounts of "Owed to me" with a balance: who owes you what. */
  owedToYou: OwedToYou[]
}

export interface DueOccurrence {
  transaction: TransactionOut
  /** The template's amount varies: ask for the real total when confirming. */
  variable: boolean
}

export interface UpcomingOccurrence {
  templateId: number
  description: string
  date: string
  amountCents: number
  variable: boolean
}

export interface OwedToYou {
  accountId: number
  name: string
  balanceCents: number
  /** Date of the last money received against this account (a credit to it). */
  lastPaymentDate: string | null
}

export interface RecurringTemplateOut {
  id: number
  description: string
  notes: string | null
  frequency: 'week' | 'month' | 'year'
  interval: number
  startDate: string
  endDate: string | null
  variable: boolean
  active: boolean
  postings: PostingOut[]
  /** Next date to be created, or null if paused or past its end date. */
  nextDue: string | null
  /** The next three dates (for display). */
  upcoming: string[]
  /** Its occurrences still waiting to be confirmed. */
  pendingCount: number
}

export interface Mover {
  itemId: number
  name: string
  imageUrl: string | null
  quantity: number
  valueCents: number
  changeCents: number
}

export interface Suggestion {
  description: string
  postings: PostingOut[]
}
