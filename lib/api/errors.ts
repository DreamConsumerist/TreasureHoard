// Error handling shared by all routes. Every error response has the shape
// { error: string, issues?: [...] }, which src/lib/api.ts already understands.

import type { Context, ErrorHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ZodType } from 'zod'
import { zValidator } from '@hono/zod-validator'

/** Throw from a route to send `{ error: message }` with the given status. */
export function fail(status: ContentfulStatusCode, message: string): never {
  throw new HTTPException(status, { message })
}

/**
 * Postgres error code from a database error. Drizzle wraps driver errors, so
 * this walks the `cause` chain. Codes: 23505 unique violation, 23514 check
 * violation (also raised by the ledger balance trigger), 23503 foreign key.
 */
export function pgErrorCode(err: unknown): string | undefined {
  for (
    let e: unknown = err, i = 0;
    e && i < 5;
    e = (e as { cause?: unknown }).cause, i++
  ) {
    const code = (e as { code?: unknown }).code
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code
  }
  return undefined
}

export const handleError: ErrorHandler = (err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status)
  }
  switch (pgErrorCode(err)) {
    case '23505':
      return c.json(
        { error: 'That conflicts with an existing record (duplicate name?)' },
        409,
      )
    case '23514':
      return c.json(
        { error: 'Rejected by a database rule (unbalanced or zero amount)' },
        400,
      )
    case '23503':
      return c.json(
        { error: 'Referenced record is missing or still in use' },
        409,
      )
  }
  console.error('Unhandled API error:', err)
  return c.json({ error: 'Internal server error' }, 500)
}

/** zValidator that answers invalid input with a 400 in our error shape. */
export function validate<T extends ZodType, Target extends 'json' | 'query'>(
  target: Target,
  schema: T,
) {
  return zValidator(target, schema, (result, c: Context) => {
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }))
      return c.json(
        { error: issues[0]?.message ?? 'Invalid request', issues },
        400,
      )
    }
  })
}

/** Parses a positive integer route parameter, or 404s. */
export function idParam(value: string): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) fail(404, 'Not found')
  return id
}
