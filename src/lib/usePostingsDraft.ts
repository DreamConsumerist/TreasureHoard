// State for the amount-and-accounts part of a transaction (simple or split),
// shared by the transaction form and the recurring-template form. The
// components that render it are in src/components/PostingsEditor.tsx.
//
// Simple mode: Amount · From → To. It becomes two postings: debit "To",
// credit "From" (lib/ledger/postings.ts).
// Split mode: one row per posting with Debit and Credit text fields. The
// draft has no postings until every line is filled in.

import { useState } from 'react'
import { centsToInput, parseMoney } from '../../lib/ledger/money.ts'
import {
  postingsToSimple,
  simpleToPostings,
  validatePostings,
  type PostingInput,
} from '../../lib/ledger/postings.ts'

export interface SplitLine {
  key: number
  accountId: number | null
  debit: string
  credit: string
  memo: string
}

let nextKey = 1
export const line = (
  accountId: number | null = null,
  cents = 0,
  memo = '',
): SplitLine => ({
  key: nextKey++,
  accountId,
  debit: cents > 0 ? centsToInput(cents) : '',
  credit: cents < 0 ? centsToInput(-cents) : '',
  memo,
})

/** Converts a split line's text fields to a signed amount (debit +, credit −), or null if invalid. */
function lineCents(l: SplitLine): number | null {
  const debit = l.debit.trim() ? parseMoney(l.debit) : 0
  const credit = l.credit.trim() ? parseMoney(l.credit) : 0
  if (debit === null || credit === null) return null
  return debit - credit
}

/** A simple-form start with some fields left blank (e.g. Record payment has no "To" yet). */
export interface PartialSimple {
  amountCents?: number
  fromAccountId?: number | null
  toAccountId?: number | null
}

export function usePostingsDraft(
  initial?: readonly PostingInput[],
  start?: PartialSimple,
) {
  const simple: PartialSimple | null = initial?.length
    ? postingsToSimple(initial)
    : (start ?? null)
  const [mode, setMode] = useState<'simple' | 'split'>(
    initial?.length && !simple ? 'split' : 'simple',
  )
  const [amount, setAmount] = useState(
    simple?.amountCents ? centsToInput(simple.amountCents) : '',
  )
  const [fromId, setFromId] = useState<number | null>(
    simple?.fromAccountId ?? null,
  )
  const [toId, setToId] = useState<number | null>(simple?.toAccountId ?? null)
  const [lines, setLines] = useState<SplitLine[]>(() =>
    initial?.length && !simple
      ? initial.map((p) => line(p.accountId, p.amountCents, p.memo ?? ''))
      : [line(), line()],
  )

  // --- Postings from whichever mode is active ---
  let postings: PostingInput[] | null = null
  if (mode === 'simple') {
    const cents = parseMoney(amount)
    if (
      cents !== null &&
      cents > 0 &&
      fromId !== null &&
      toId !== null &&
      fromId !== toId
    ) {
      postings = simpleToPostings({
        amountCents: cents,
        fromAccountId: fromId,
        toAccountId: toId,
      })
    }
  } else {
    const built = lines.map((l) => ({ l, cents: lineCents(l) }))
    if (
      built.every(
        ({ l, cents }) => cents !== null && l.accountId !== null && cents !== 0,
      )
    ) {
      postings = built.map(({ l, cents }) => ({
        accountId: l.accountId!,
        amountCents: cents!,
        memo: l.memo.trim() || null,
      }))
    }
  }
  const splitRemaining = lines.reduce((sum, l) => sum + (lineCents(l) ?? 0), 0)
  const problems = postings
    ? validatePostings(postings)
    : ['Fill in the amount and accounts.']

  /** Replaces the draft with these postings (simple form when they fit it). */
  function load(ps: readonly PostingInput[]) {
    const asSimple = postingsToSimple(ps)
    if (asSimple) {
      setMode('simple')
      setAmount(centsToInput(asSimple.amountCents))
      setFromId(asSimple.fromAccountId)
      setToId(asSimple.toAccountId)
    } else {
      setMode('split')
      setLines(ps.map((p) => line(p.accountId, p.amountCents, p.memo ?? '')))
    }
  }

  function switchToSplit() {
    const cents = parseMoney(amount) ?? 0
    setLines([line(toId, cents), line(fromId, -cents)])
    setMode('split')
  }

  function switchToSimple() {
    const asSimple = postings ? postingsToSimple(postings) : null
    if (asSimple) {
      setAmount(centsToInput(asSimple.amountCents))
      setFromId(asSimple.fromAccountId)
      setToId(asSimple.toAccountId)
    }
    setMode('simple')
  }

  function updateLine(key: number, patch: Partial<SplitLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  return {
    mode,
    amount,
    setAmount,
    fromId,
    setFromId,
    toId,
    setToId,
    lines,
    setLines,
    updateLine,
    postings,
    problems,
    splitRemaining,
    load,
    switchToSplit,
    switchToSimple,
  }
}

export type PostingsDraft = ReturnType<typeof usePostingsDraft>
