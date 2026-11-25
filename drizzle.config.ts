import { defineConfig } from 'drizzle-kit'

// drizzle-kit reads the schema and writes SQL migrations into the folder
// Netlify watches. Netlify applies new migrations automatically on deploy;
// locally, run `npm run db:migrate`.
export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema.ts',
  out: 'netlify/database/migrations',
})
