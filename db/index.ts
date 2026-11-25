// Shared Drizzle client.
//
// `drizzle-orm/netlify-db` finds the connection automatically (NETLIFY_DB_URL)
// in every Netlify environment: the local database under `netlify dev`, a
// per-deploy branch database on previews, and the production database.
// It picks the driver too: Neon's serverless driver when deployed,
// node-postgres locally.

import { drizzle } from 'drizzle-orm/netlify-db'
import * as schema from './schema.ts'

export const db = drizzle({ schema })
