// The database type the API code accepts. Both the Netlify driver (db/index.ts)
// and the in-memory PGlite driver used by tests extend this base class, so the
// same route code runs against either.
//
// Kept separate from db/index.ts because importing that file connects to the
// database immediately.

import type { PgAsyncDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type * as schema from './schema.ts'

export type Db = PgAsyncDatabase<PgQueryResultHKT, typeof schema>
