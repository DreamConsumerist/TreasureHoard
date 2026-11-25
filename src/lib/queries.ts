// TanStack Query hooks for the API (ledger and collection). Components call these instead of
// fetching directly, so caching, loading/error state and refetch-after-save are
// handled in one place.

import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'
import type {
  AccountCreate,
  AccountUpdate,
  RecurringInput,
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
  RecurringTemplateOut,
  Suggestion,
  TransactionOut,
  TransactionPage,
} from '../../lib/ledger/types.ts'
import type { ItemKind } from '../../lib/collection/accounting.ts'
import type {
  GroupCreate,
  GroupUpdate,
  ItemCreate,
  ItemSell,
  ItemUpdate,
} from '../../lib/collection/schemas.ts'
import type {
  CatalogSearchOut,
  CollectionCheck,
  GroupDetailOut,
  GroupOut,
  ItemDetailOut,
  ItemOut,
  PriceChartingLookupOut,
  TcgGroupOut,
  TcgProductOut,
} from '../../lib/collection/types.ts'
import type { SyncJobStatus } from '../../lib/pricing/types.ts'
import { api } from './api.ts'

export type GameKey = 'mtg' | 'onepiece' | 'riftbound'
export type {
  GroupDetailOut,
  GroupOut,
  ItemDetailOut,
  ItemOut,
  SyncJobStatus,
  TcgProductOut,
}

export type { DashboardData, RecurringTemplateOut, TransactionOut }

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
    // The Collection and everything under it: managed by the app, so hidden
    // from account pickers (the API refuses manual postings to them anyway).
    const collectionIds = new Set<number>()
    const root = flat.find((a) => a.systemKey === 'collection')
    const walk = (n: AccountNode) => {
      collectionIds.add(n.id)
      n.children.forEach(walk)
    }
    if (root) walk(root)
    return { tree, flat, byId, collectionIds }
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
        'items',
        'item',
        'collection-check',
        'price-status',
        'recurring',
        'groups',
        'group',
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

// --- Recurring ---

export function useRecurringTemplates() {
  return useQuery({
    queryKey: ['recurring'],
    queryFn: () => api<RecurringTemplateOut[]>('/recurring'),
  })
}

export function useRecurringTemplate(id: number | null) {
  return useQuery({
    queryKey: ['recurring', id],
    queryFn: () => api<RecurringTemplateOut>(`/recurring/${id}`),
    enabled: id !== null,
  })
}

export const useSaveRecurring = () =>
  useLedgerMutation(({ id, ...body }: RecurringInput & { id?: number }) =>
    id
      ? api<RecurringTemplateOut>(`/recurring/${id}`, {
          method: 'PUT',
          ...json(body),
        })
      : api<RecurringTemplateOut>('/recurring', {
          method: 'POST',
          ...json(body),
        }),
  )

export const useDeleteRecurring = () =>
  useLedgerMutation((id: number) =>
    api(`/recurring/${id}`, { method: 'DELETE' }),
  )

/**
 * Creates any recurring transactions that have come due, once per app load,
 * using the browser's local date. Refreshes everything only if it made some.
 */
export function useRecurringCatchUp() {
  const qc = useQueryClient()
  const ran = useRef(false)
  useEffect(() => {
    if (ran.current) return // React's dev double-mount
    ran.current = true
    void runCatchUp(qc)
  }, [qc])
}

/** Runs the catch-up now (also after saving a template, so past dates appear at once). */
export async function runCatchUp(qc: QueryClient): Promise<number> {
  try {
    const { created } = await api<{ created: number }>('/recurring/catch-up', {
      method: 'POST',
      ...json({ today: todayLocal() }),
    })
    if (created > 0) await qc.invalidateQueries()
    return created
  } catch (err) {
    console.error('Recurring catch-up failed:', err)
    return 0
  }
}

// --- Collection ---

export interface ItemFilters {
  kind?: ItemKind
  status: 'owned' | 'sold'
  q?: string
}

export function useItems(filters: ItemFilters) {
  return useQuery({
    queryKey: ['items', filters],
    queryFn: () => {
      const params = new URLSearchParams({ status: filters.status })
      if (filters.kind) params.set('kind', filters.kind)
      if (filters.q) params.set('q', filters.q)
      return api<ItemOut[]>(`/items?${params}`)
    },
  })
}

export function useItem(id: number) {
  return useQuery({
    queryKey: ['item', id],
    queryFn: () => api<ItemDetailOut>(`/items/${id}`),
  })
}

export function useCollectionCheck() {
  return useQuery({
    queryKey: ['collection-check'],
    queryFn: () => api<CollectionCheck>('/collection/check'),
  })
}

export function useTcgGroups(game: GameKey | null) {
  return useQuery({
    queryKey: ['tcg-groups', game],
    queryFn: () => api<TcgGroupOut[]>(`/catalog/tcg/groups?game=${game}`),
    enabled: game !== null,
    staleTime: 60 * 60_000,
  })
}

export function useTcgProducts(game: GameKey | null, groupId: number | null) {
  return useQuery({
    queryKey: ['tcg-products', game, groupId],
    queryFn: () =>
      api<TcgProductOut[]>(
        `/catalog/tcg/products?game=${game}&groupId=${groupId}`,
      ),
    enabled: game !== null && groupId !== null,
    staleTime: 60 * 60_000,
  })
}

/** Name search across every set (the card search index). */
export function useCatalogSearch(
  game: GameKey | null,
  q: string,
  sealed?: boolean,
) {
  return useQuery({
    queryKey: ['catalog-search', game, q, sealed],
    queryFn: () => {
      const params = new URLSearchParams({ game: game!, q })
      if (sealed !== undefined) params.set('sealed', String(sealed))
      return api<CatalogSearchOut>(`/catalog/tcg/search?${params}`)
    },
    enabled: game !== null && q.trim().length >= 2,
    placeholderData: (prev) => prev, // keep results while typing
    staleTime: 5 * 60_000,
  })
}

export const usePriceChartingLookup = () =>
  useMutation({
    mutationFn: (url: string) =>
      api<PriceChartingLookupOut>('/catalog/pricecharting', {
        method: 'POST',
        ...json({ url }),
      }),
  })

export const useCreateItem = () =>
  useLedgerMutation((body: ItemCreate) =>
    api<ItemOut>('/items', { method: 'POST', ...json(body) }),
  )

export const useUpdateItem = () =>
  useLedgerMutation(({ id, ...body }: ItemUpdate & { id: number }) =>
    api<ItemOut>(`/items/${id}`, { method: 'PATCH', ...json(body) }),
  )

export const useSellItem = () =>
  useLedgerMutation(({ id, ...body }: ItemSell & { id: number }) =>
    api<ItemOut>(`/items/${id}/sell`, { method: 'POST', ...json(body) }),
  )

export const useUndoSale = () =>
  useLedgerMutation((id: number) =>
    api<ItemOut>(`/items/${id}/sale`, { method: 'DELETE' }),
  )

export const useDeleteItem = () =>
  useLedgerMutation((id: number) => api(`/items/${id}`, { method: 'DELETE' }))

// --- Collection groups ---

export function useGroups() {
  return useQuery({
    queryKey: ['groups'],
    queryFn: () => api<GroupOut[]>('/groups'),
  })
}

export function useGroup(id: number) {
  return useQuery({
    queryKey: ['group', id],
    queryFn: () => api<GroupDetailOut>(`/groups/${id}`),
  })
}

export const useCreateGroup = () =>
  useLedgerMutation((body: GroupCreate) =>
    api<GroupDetailOut>('/groups', { method: 'POST', ...json(body) }),
  )

export const useUpdateGroup = () =>
  useLedgerMutation(({ id, ...body }: GroupUpdate & { id: number }) =>
    api<GroupDetailOut>(`/groups/${id}`, { method: 'PATCH', ...json(body) }),
  )

export const useDeleteGroup = () =>
  useLedgerMutation((id: number) => api(`/groups/${id}`, { method: 'DELETE' }))

export const useAddToGroup = () =>
  useLedgerMutation(({ id, itemIds }: { id: number; itemIds: number[] }) =>
    api<GroupDetailOut>(`/groups/${id}/items`, {
      method: 'POST',
      ...json({ itemIds }),
    }),
  )

// --- Price sync ---

/**
 * Latest sync run per job. Polls every 3 s while a run is going; when one
 * finishes, refreshes everything that shows prices.
 */
export function usePriceStatus() {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['price-status'],
    queryFn: () => api<SyncJobStatus[]>('/prices/status'),
    refetchInterval: (q) =>
      q.state.data?.some((s) => s.last?.status === 'running') ? 3000 : false,
  })
  const running = query.data?.some((s) => s.last?.status === 'running') ?? false
  const wasRunning = useRef(running)
  useEffect(() => {
    if (wasRunning.current && !running) {
      for (const key of [
        'items',
        'item',
        'dashboard',
        'groups',
        'group',
        'catalog-search',
      ])
        void qc.invalidateQueries({ queryKey: [key] })
    }
    wasRunning.current = running
  }, [running, qc])
  return query
}

export function useStartSync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (job: 'tcg' | 'games' | 'catalog') =>
      api<{ runId: number }>('/prices/sync', {
        method: 'POST',
        ...json({ job }),
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['price-status'] }),
  })
}
