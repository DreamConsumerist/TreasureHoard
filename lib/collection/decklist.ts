// Decklist import, the pure parts: reading a pasted decklist, and deciding
// which copies of a card a deck already has. Shared by the API (which acts on
// it) and the review screen (which shows it), so both agree.
//
// Reads Moxfield, Archidekt and MTG Arena exports, and plain "4 Card Name":
//   1 Ghalta, Primal Hunger (RIX) 130 *F*
//   1x Ghalta, Primal Hunger (rix) 130 *F* [Commander{top}] ^Have,#37d67a^
//   1 Ghalta, Primal Hunger (RIX) 130
//   1 Ghalta, Primal Hunger

export type Finish = 'normal' | 'foil' | 'etched'

export interface DeckLine {
  /** 1-based line number of its first appearance in the pasted text. */
  lineNo: number
  quantity: number
  name: string
  /** Set code as written (e.g. RIX), uppercased; null if not given. */
  setCode: string | null
  /** Collector number as written (e.g. 130, 130s, RIX-130); null if not given. */
  number: string | null
  finish: Finish
}

export interface SkippedLine {
  lineNo: number
  text: string
  reason: string
}

const MAX_QUANTITY = 1000

// Section headers deckbuilders put between cards. Cards under a Maybeboard /
// Considering header (or tagged that way by Archidekt) are left out: they're
// cards being considered, not cards in the deck.
const HEADER =
  /^(?:\/\/\s*)?(commander|commanders|companion|deck|main|mainboard|sideboard|maybeboard|maybe|considering|about|tokens?|lands?|creatures?|instants?|sorceries|artifacts?|enchantments?|planeswalkers?|battles?|other|spells?)\b[^:]*:?\s*(?:\(\d+\))?$/i
const MAYBE = /^(maybeboard|maybe|considering)$/i

/**
 * Parses pasted decklist text. Unreadable lines are returned as `skipped`
 * with a reason; duplicates (same name, set, number and finish) are combined.
 */
export function parseDecklist(text: string): {
  lines: DeckLine[]
  skipped: SkippedLine[]
} {
  const lines: DeckLine[] = []
  const skipped: SkippedLine[] = []
  const byKey = new Map<string, DeckLine>()
  let inMaybe = false

  text.split(/\r?\n/).forEach((rawLine, i) => {
    const lineNo = i + 1
    let s = rawLine.trim()
    if (s === '') return
    if (s.startsWith('#')) return

    const header = HEADER.exec(s)
    if (header && !/^\d/.test(s)) {
      inMaybe = MAYBE.test(header[1]!)
      return
    }
    if (s.startsWith('//')) return // a comment
    if (/^name\s/i.test(s)) return // "Name My Deck" (Arena)

    // Archidekt: [Category{flags}] tags and ^label,#color^ markers.
    const tags = [...s.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1]!)
    s = s.replace(/\[[^\]]*\]/g, ' ').replace(/\^[^^]*\^/g, ' ')

    // Finish markers: *F* foil, *E* etched. Other *X* markers (alters) are dropped.
    let finish: Finish = 'normal'
    if (/\*E\*/i.test(s)) finish = 'etched'
    else if (/\*F\*/i.test(s)) finish = 'foil'
    s = s
      .replace(/\*[A-Za-z]+\*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (inMaybe || tags.some((t) => /maybe|considering/i.test(t))) {
      skipped.push({ lineNo, text: rawLine.trim(), reason: 'maybeboard' })
      return
    }

    // Quantity: "4 Name", "4x Name". A line without one counts as 1.
    let quantity = 1
    const q = /^(\d+)\s*x?\s+(.+)$/i.exec(s)
    if (q) {
      quantity = Number(q[1])
      s = q[2]!
    }
    if (quantity < 1 || quantity > MAX_QUANTITY) {
      skipped.push({ lineNo, text: rawLine.trim(), reason: 'quantity' })
      return
    }

    // "Name (SET) NUMBER" or "Name (SET)".
    let setCode: string | null = null
    let number: string | null = null
    const withNumber = /^(.+?)\s+\(([A-Za-z0-9]{2,8})\)\s+(\S+)$/.exec(s)
    const withSet = /^(.+?)\s+\(([A-Za-z0-9]{2,8})\)$/.exec(s)
    if (withNumber) {
      s = withNumber[1]!
      setCode = withNumber[2]!.toUpperCase()
      number = withNumber[3]!
    } else if (withSet) {
      s = withSet[1]!
      setCode = withSet[2]!.toUpperCase()
    }
    const name = s.trim()
    if (name === '' || /^\d+$/.test(name)) {
      skipped.push({ lineNo, text: rawLine.trim(), reason: 'unreadable' })
      return
    }

    const key = [
      name.toLowerCase(),
      setCode,
      number?.toLowerCase(),
      finish,
    ].join('|')
    const existing = byKey.get(key)
    if (existing) {
      existing.quantity = Math.min(existing.quantity + quantity, MAX_QUANTITY)
      return
    }
    const line = { lineNo, quantity, name, setCode, number, finish }
    byKey.set(key, line)
    lines.push(line)
  })
  return { lines, skipped }
}

/** TCGplayer's sub-type for a finish. Etched cards are their own product, sold as Foil. */
export const subTypeFor = (finish: Finish) =>
  finish === 'normal' ? 'Normal' : 'Foil'

/** An owned, unsold copy (row) of the same printing and finish. */
export interface OwnedRow {
  itemId: number
  quantity: number
  /** Its collection group, or null if in none. */
  itemGroupId: number | null
}

export interface LinePlan {
  /** Copies already in the target group: not imported again. */
  present: number
  /** Copies taken from rows in no group (moved, or split off, into the group). */
  fromUngrouped: { itemId: number; quantity: number }[]
  /** Copies to add as new items. */
  add: number
  /** Copies in other groups: never touched, only reported. */
  elsewhere: number
}

/**
 * How a deck gets `wanted` copies of a card:
 *   1. copies already in the target group count as present;
 *   2. copies in no group are used next (moved into the group);
 *   3. the rest are added new.
 * Copies in other groups are left alone: a card in another deck doesn't stop
 * this deck getting its own copy. With useExisting false, everything is new.
 */
export function planLine(
  wanted: number,
  owned: readonly OwnedRow[],
  targetGroupId: number | null,
  useExisting = true,
): LinePlan {
  const inGroup = owned
    .filter((o) => targetGroupId !== null && o.itemGroupId === targetGroupId)
    .reduce((s, o) => s + o.quantity, 0)
  const elsewhere = owned
    .filter((o) => o.itemGroupId !== null && o.itemGroupId !== targetGroupId)
    .reduce((s, o) => s + o.quantity, 0)
  if (!useExisting)
    return { present: 0, fromUngrouped: [], add: wanted, elsewhere }

  const present = Math.min(inGroup, wanted)
  let need = wanted - present
  const fromUngrouped: LinePlan['fromUngrouped'] = []
  // Smallest rows first, so whole rows move before any row is split.
  for (const o of [...owned]
    .filter((x) => x.itemGroupId === null)
    .sort((a, b) => a.quantity - b.quantity || a.itemId - b.itemId)) {
    if (need === 0) break
    const take = Math.min(o.quantity, need)
    fromUngrouped.push({ itemId: o.itemId, quantity: take })
    need -= take
  }
  return { present, fromUngrouped, add: need, elsewhere }
}
