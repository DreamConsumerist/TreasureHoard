// A slim notice while the device has no connection. The installed app still
// opens offline (its code is on the phone), but data comes only from the
// server, so this explains why nothing loads or saves.

import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

export function OfflineBar() {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )
  if (online) return null
  return (
    <p
      role="status"
      className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200"
    >
      You're offline. Nothing can load or be saved until you're back online.
    </p>
  )
}
