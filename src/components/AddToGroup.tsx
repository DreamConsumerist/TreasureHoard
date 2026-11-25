// "Add to group…" for selected items: pick an existing group or name a new
// one. Items already in another group are moved (one group per item).

import { useState, type FormEvent } from 'react'
import { useAddToGroup, useCreateGroup, useGroups } from '../lib/queries.ts'

export function AddToGroup({
  itemIds,
  onDone,
  onCancel,
}: {
  itemIds: number[]
  onDone: (groupId: number) => void
  onCancel: () => void
}) {
  const groups = useGroups()
  const create = useCreateGroup()
  const add = useAddToGroup()
  const [choice, setChoice] = useState<string>('new')
  const [name, setName] = useState('')
  const busy = create.isPending || add.isPending
  const error = create.error ?? add.error
  const canSave =
    itemIds.length > 0 && !busy && (choice !== 'new' || name.trim() !== '')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSave) return
    const id =
      choice === 'new'
        ? (await create.mutateAsync({ name: name.trim() })).id
        : Number(choice)
    await add.mutateAsync({ id, itemIds })
    onDone(id)
  }

  return (
    <form
      onSubmit={(e) => void submit(e).catch(() => {})}
      className="flex flex-wrap items-end gap-2"
    >
      <label className="block space-y-1">
        <span className="label">Group</span>
        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className="input w-auto"
        >
          <option value="new">New group…</option>
          {groups.data?.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      {choice === 'new' && (
        <label className="block space-y-1">
          <span className="label">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ghalta deck"
            className="input"
            autoFocus
          />
        </label>
      )}
      <button type="submit" disabled={!canSave} className="btn-primary py-2">
        {busy
          ? 'Saving…'
          : `Add ${itemIds.length} item${itemIds.length === 1 ? '' : 's'}`}
      </button>
      <button type="button" onClick={onCancel} className="btn py-2">
        Cancel
      </button>
      {error && <p className="w-full text-sm text-red-600">{error.message}</p>}
    </form>
  )
}
