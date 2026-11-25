// Builds the chart-of-accounts tree from the flat list the API returns.

import type { AccountType } from './sign.ts'

export interface AccountRow {
  id: number
  name: string
  type: AccountType
  parentId: number | null
  systemKey: string | null
  archived: boolean
  balanceCents: number // this account's own postings (debit-positive)
  clearedBalanceCents: number
  /** This account's side of its opening entry (debit-positive), if it has one. */
  openingBalanceCents: number | null
  openingDate: string | null
}

export interface AccountNode extends AccountRow {
  /** Full name, e.g. "Collection: Cards". */
  path: string
  depth: number
  /** Own balance plus every descendant's (debit-positive). */
  totalCents: number
  children: AccountNode[]
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name)

/** Returns the top-level accounts, each with nested children sorted by name. */
export function buildAccountTree(rows: readonly AccountRow[]): AccountNode[] {
  const nodes = new Map<number, AccountNode>()
  for (const row of rows) {
    nodes.set(row.id, {
      ...row,
      path: row.name,
      depth: 0,
      totalCents: 0,
      children: [],
    })
  }
  const roots: AccountNode[] = []
  for (const node of nodes.values()) {
    const parent = node.parentId === null ? undefined : nodes.get(node.parentId)
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const finish = (
    node: AccountNode,
    parentPath: string | null,
    depth: number,
  ): number => {
    node.path = parentPath ? `${parentPath}: ${node.name}` : node.name
    node.depth = depth
    node.children.sort(byName)
    node.totalCents =
      node.balanceCents +
      node.children.reduce(
        (sum, child) => sum + finish(child, node.path, depth + 1),
        0,
      )
    return node.totalCents
  }
  roots.sort(byName)
  for (const root of roots) finish(root, null, 0)
  return roots
}

/** Depth-first flattening of the tree, e.g. for pickers and indented lists. */
export function flattenTree(roots: readonly AccountNode[]): AccountNode[] {
  const out: AccountNode[] = []
  const walk = (nodes: readonly AccountNode[]) => {
    for (const n of nodes) {
      out.push(n)
      walk(n.children)
    }
  }
  walk(roots)
  return out
}
