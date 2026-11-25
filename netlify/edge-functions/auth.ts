// Auth gate, running at Netlify's edge (Deno) before any API function starts.
//
// Requests to /api/* need a valid session cookie; otherwise they get 401 here
// and never reach (or wake) the API function or database. /api/login is
// excluded so you can log in.
//
// Pages and JS/CSS bundles are deliberately NOT gated: they contain app code
// only, never data. When the app gets a 401 from the API, it sends the browser
// to /login itself (src/lib/api.ts).

import type { Config, Context } from '@netlify/edge-functions'
import { SESSION_COOKIE, verifySessionToken } from '../../lib/auth/session.ts'

export default async (_req: Request, context: Context) => {
  const secret = Netlify.env.get('SESSION_SECRET')
  const token = context.cookies.get(SESSION_COOKIE)
  if (secret && token && (await verifySessionToken(token, secret))) {
    return // continue to the API function
  }
  return Response.json({ error: 'Unauthorized' }, { status: 401 })
}

export const config: Config = {
  path: '/api/*',
  excludedPath: ['/api/login'],
}
