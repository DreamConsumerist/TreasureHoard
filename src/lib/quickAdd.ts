// Lets any page open the quick-add transaction sheet that AppShell renders.
// Kept out of AppShell.tsx so that file only exports components (which keeps
// Vite's hot reload working for it).

import { createContext, useContext } from 'react'

export const QuickAddContext = createContext<() => void>(() => {})

/** Returns a function that opens the quick-add transaction sheet. */
export const useQuickAdd = () => useContext(QuickAddContext)
