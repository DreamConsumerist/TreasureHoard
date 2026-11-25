// TanStack Query hooks for the ledger API. Components call these instead of
// fetching directly, so caching, loading/error state and refetch-after-save are
// handled in one place.

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useMemo } from 'react'
import type {
  AccountCreate,
  AccountUpdate,
  TransactionInput,
} from '../../lib/ledger/schemas.ts'
import {
  buildAccountTree,
  flattenTree,
  type AccountNode,
  type AccountRow,
} from '../../lib/ledger/tree.ts'
import type {
  DashboardData,
  Suggestion,
  TransactionOut,
  TransactionPage,
} from '../../lib/ledger/types.ts'
import { api } from './api.ts'

export type { DashboardData, TransactionOut }

export interface TransactionFilters {
  accountId?: number
  q?: string
  status?: 'pending' | 'cleared'
  includeOpening?: boolean
}

/** Today's date in the browser's own timezone, as 'YYYY-MM-DD'. */
export function todayLocal(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const json = (body: unknown) => ({ body: JSON.stringify(body) })

// --- Accounts ---

export function useAccounts() {
  const query = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<AccountRow[]>('/accounts'),
  })
  // Derived views, recomputed only when the data changes.
  const derived = useMemo(() => {
    const rows = query.data ?? []
    const tree = buildAccountTree(rows)
    const flat = flattenTree(tree)
    const byId = new Map<number, AccountNode>(flat.map((a) => [a.id, a]))
    return { tree, flat, byId }
  }, [query.data])
  return { ...query, ...derived }
}

// --- Transactions ---

export function useTransactions(filters: TransactionFilters) {
  return useInfiniteQuery({
    queryKey: ['transactions', filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      if (filters.accountId) params.set('accountId', String(filters.accountId))
      if (filters.q) params.set('q', filters.q)
      if (filters.status) params.set('status', filters.status)
      if (filters.includeOpening) params.set('includeOpening', 'true')
      if (pageParam) params.set('cursor', pageParam)
      return api<TransactionPage>(`/transactions?${params}`)
    },
    getNextPageParam: (last) => last.nextCursor,
  })
}

export function useTransaction(id: number | null) {
  return useQuery({
    queryKey: ['transaction', id],
    queryFn: () => api<TransactionOut>(`/transactions/${id}`),
    enabled: id !== null,
  })
}

export function useSuggestions(q: string) {
  return useQuery({
    queryKey: ['suggest', q],
    queryFn: () =>
      api<Suggestion[]>(`/transactions/suggest?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
    staleTime: 60_000,
  })
}

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardData>(`/dashboard?today=${todayLocal()}`),
  })
}

// --- Mutations: every write refreshes balances, lists and the dashboard ---

function useLedgerMutation<TVars, TResult>(
  fn: (vars: TVars) => Promise<TResult>,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of [
        'accounts',
        'transactions',
        'transaction',
        'dashboard',
        'suggest',
      ]) {
        void qc.invalidateQueries({ queryKey: [key] })
      }
    },
  })
}

export const useCreateAccount = () =>
  useLedgerMutation((body: AccountCreate) =>
    api<AccountRow>('/accounts', { method: 'POST', ...json(body) }),
  )

export const useUpdateAccount = () =>
  useLedgerMutation(({ id, ...body }: AccountUpdate & { id: number }) =>
    api<AccountRow>(`/accounts/${id}`, { method: 'PATCH', ...json(body) }),
  )

export const useDeleteAccount = () =>
  useLedgerMutation((id: number) =>
    api(`/accounts/${id}`, { method: 'DELETE' }),
  )

export const useSaveTransaction = () =>
  useLedgerMutation(({ id, ...body }: TransactionInput & { id?: number }) =>
    id
      ? api<TransactionOut>(`/transactions/${id}`, {
          method: 'PUT',
          ...json(body),
        })
      : api<TransactionOut>('/transactions', { method: 'POST', ...json(body) }),
  )

export const useDeleteTransaction = () =>
  useLedgerMutation((id: number) =>
    api(`/transactions/${id}`, { method: 'DELETE' }),
  )
