// Thin wrapper around fetch for calling our /api endpoints.
//
// - Sends and parses JSON.
// - A 401 means the session is missing or expired: send the browser to /login.
// - Any other non-2xx response becomes a thrown Error with the server's message,
//   which TanStack Query surfaces as the query's `error`.

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })

  if (res.status === 401 && path !== '/login') {
    window.location.assign('/login')
    throw new Error('Not logged in')
  }

  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const message =
      typeof data === 'object' && data !== null && 'error' in data
        ? String(data.error)
        : `Request failed (${res.status})`
    throw new Error(message)
  }
  return data as T
}
