// The recurring-template editor: the same amount-and-accounts entry as a
// transaction (PostingsEditor.tsx), plus a schedule. It previews the next
// dates live, so month-end handling is visible before saving, and says how
// many past dates will be created when the start date is in the past.

import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import type { PostingInput } from '../../lib/ledger/postings.ts'
import {
  describeSchedule,
  occurrencesFrom,
  type Frequency,
  type Schedule,
} from '../../lib/ledger/recurring.ts'
import {
  runCatchUp,
  todayLocal,
  useSaveRecurring,
  type RecurringTemplateOut,
} from '../lib/queries.ts'
import {
  DraftAccounts,
  DraftAmount,
  DraftModeToggle,
} from './PostingsEditor.tsx'
import { usePostingsDraft } from '../lib/usePostingsDraft.ts'

export interface RecurringPrefill {
  description?: string
  postings?: PostingInput[]
  startDate?: string
}

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

export function RecurringForm({
  initial,
  prefill,
  onSaved,
}: {
  initial?: RecurringTemplateOut
  prefill?: RecurringPrefill
  onSaved: () => void
}) {
  const draft = usePostingsDraft(initial?.postings ?? prefill?.postings)
  const [description, setDescription] = useState(
    initial?.description ?? prefill?.description ?? '',
  )
  const [frequency, setFrequency] = useState<Frequency>(
    initial?.frequency ?? 'month',
  )
  const [interval, setIntervalText] = useState(String(initial?.interval ?? 1))
  const [startDate, setStartDate] = useState(
    initial?.startDate ?? prefill?.startDate ?? todayLocal(),
  )
  const [endDate, setEndDate] = useState(initial?.endDate ?? '')
  const [variable, setVariable] = useState(initial?.variable ?? false)
  const [active, setActive] = useState(initial?.active ?? true)
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const save = useSaveRecurring()
  const qc = useQueryClient()

  const n = Number(interval)
  const intervalOk = Number.isInteger(n) && n >= 1 && n <= 99
  const endOk = !endDate || endDate >= startDate
  const schedule: Schedule | null = intervalOk
    ? { frequency, interval: n, startDate, endDate: endDate || null }
    : null

  // What the schedule will do from here on.
  const today = todayLocal()
  const scheduleChanged =
    !initial ||
    initial.frequency !== frequency ||
    initial.interval !== n ||
    initial.startDate !== startDate
  let preview: string[] = []
  let pastCount = 0
  if (schedule) {
    if (!initial) {
      // A new template creates every date up to today straight away.
      pastCount = occurrencesFrom(schedule, 0, 1000).filter(
        (d) => d <= today,
      ).length
      preview = occurrencesFrom(schedule, pastCount, 3)
    } else if (scheduleChanged) {
      // The server restarts after the last date already created; from today
      // on is the closest the form can show without asking it.
      preview = occurrencesFrom(schedule, 0, 1000)
        .filter((d) => d >= today)
        .slice(0, 3)
    } else {
      preview = occurrencesFrom(schedule, 0, 1000)
        .filter((d) => d >= (initial.nextDue ?? today))
        .slice(0, 3)
    }
  }

  const canSave =
    description.trim() !== '' &&
    draft.problems.length === 0 &&
    intervalOk &&
    endOk &&
    !save.isPending

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSave || !draft.postings) return
    save.mutate(
      {
        id: initial?.id,
        description: description.trim(),
        notes: notes.trim() || null,
        frequency,
        interval: n,
        startDate,
        endDate: endDate || null,
        variable,
        active,
        postings: draft.postings,
      },
      {
        onSuccess: async () => {
          await runCatchUp(qc) // past and today's dates appear straight away
          onSaved()
        },
      },
    )
  }

  const unit = { week: 'week', month: 'month', year: 'year' }[frequency]

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <DraftAmount
        draft={draft}
        label={variable ? 'Usual amount (an estimate)' : 'Amount'}
      />

      <label className="block space-y-1">
        <span className="label">Description</span>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Rent, Paycheck, Electric…"
          className="input"
          required
        />
      </label>

      <DraftAccounts draft={draft} />

      <fieldset className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <legend className="label px-1">Schedule</legend>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block space-y-1">
            <span className="label">Every</span>
            <input
              type="number"
              min={1}
              max={99}
              value={interval}
              onChange={(e) => setIntervalText(e.target.value)}
              className="input w-20"
              aria-label="Interval"
            />
          </label>
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as Frequency)}
            className="input w-auto"
            aria-label="Frequency"
          >
            <option value="week">{n === 1 ? 'week' : 'weeks'}</option>
            <option value="month">{n === 1 ? 'month' : 'months'}</option>
            <option value="year">{n === 1 ? 'year' : 'years'}</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <label className="block space-y-1">
            <span className="label">First date</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="input"
              required
            />
          </label>
          <label className="block space-y-1">
            <span className="label">Last date (optional)</span>
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="input"
            />
          </label>
        </div>
        {!intervalOk && (
          <p className="text-sm text-red-600">Choose every 1 to 99 {unit}s.</p>
        )}
        {!endOk && (
          <p className="text-sm text-red-600">
            The last date is before the first.
          </p>
        )}
        {schedule && endOk && (
          <div className="text-sm text-zinc-500">
            <div className="font-medium text-zinc-700 dark:text-zinc-300">
              {describeSchedule(schedule)}
            </div>
            {preview.length > 0 ? (
              <div>Next: {preview.map(longDate).join(' · ')}</div>
            ) : (
              <div>No more dates: the last date has passed.</div>
            )}
            {pastCount > 0 && (
              <div className="text-amber-700 dark:text-amber-400">
                {pastCount === 1
                  ? 'The first date is today or earlier: it will be created as pending when you save.'
                  : `${pastCount} dates are today or earlier: they will be created as pending when you save.`}
              </div>
            )}
          </div>
        )}
      </fieldset>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={variable}
          onChange={(e) => setVariable(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">Amount varies</span>
          <span className="block text-zinc-500">
            Like utilities: each one arrives with an estimate (your last
            confirmed amount), and you enter the real total when confirming.
          </span>
        </span>
      </label>

      {initial && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Active (untick to pause)
        </label>
      )}

      <label className="block space-y-1">
        <span className="label">Notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="input"
        />
      </label>

      {initial && (
        <p className="text-xs text-zinc-500">
          Changes apply from the next one on. Ones already created keep their
          amounts; edit those individually.
        </p>
      )}

      {save.error && (
        <p className="text-sm text-red-600">{save.error.message}</p>
      )}

      <div className="flex items-center justify-between gap-2">
        <DraftModeToggle draft={draft} />
        <button
          type="submit"
          disabled={!canSave}
          className="btn-primary px-5 py-2"
        >
          {save.isPending
            ? 'Saving…'
            : initial
              ? 'Save changes'
              : 'Add recurring'}
        </button>
      </div>
    </form>
  )
}
