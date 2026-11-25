// Registers the service worker (installed app only; it's off in development)
// and shows a bar when a new deploy is ready. The new version only takes over
// when you press Reload, so a half-filled form is never thrown away.
//
// An installed iPhone app can stay open for days, so it also checks for a new
// version every hour while open.

import { useRegisterSW } from 'virtual:pwa-register/react'

const CHECK_EVERY_MS = 60 * 60_000

export function UpdateBar() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return
      setInterval(() => {
        if (navigator.onLine) void registration.update()
      }, CHECK_EVERY_MS)
    },
    onRegisterError(err) {
      console.error('Service worker registration failed:', err)
    },
  })

  if (!needRefresh) return null
  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 flex items-center justify-between gap-3 rounded-xl bg-zinc-900 px-4 py-3 text-sm text-white shadow-lg md:inset-x-auto md:right-4 md:bottom-4 dark:bg-zinc-100 dark:text-zinc-900"
    >
      <span>A new version of TreasureHoard is available.</span>
      <span className="flex shrink-0 gap-2">
        <button
          type="button"
          className="rounded-lg px-2 py-1 opacity-70"
          onClick={() => setNeedRefresh(false)}
        >
          Later
        </button>
        <button
          type="button"
          className="rounded-lg bg-white px-3 py-1 font-medium text-zinc-900 dark:bg-zinc-900 dark:text-white"
          onClick={() => void updateServiceWorker(true)}
        >
          Reload
        </button>
      </span>
    </div>
  )
}
