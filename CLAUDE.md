# TreasureHoard

TreasureHoard: a single-user personal finance app, a double-entry general ledger plus an inventory of trading cards and video games with market valuations. Design and rationale live in [ARCHITECTURE.md](ARCHITECTURE.md); step-by-step plans live in [docs/plans/](docs/plans/).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | `netlify dev` on http://localhost:8888: Vite, functions, edge functions and a local Postgres together |
| `npm run build` | Type-check every tsconfig (`tsc -b`), then build the frontend into `dist/` |
| `npm test` | Run Vitest once (`npm run test:watch` to keep it running) |
| `npm run lint` | oxlint |
| `npm run format` | Prettier on code (Markdown is excluded and formatted by hand) |
| `npm run db:generate` | drizzle-kit: `db/schema.ts` → new SQL migration in `netlify/database/migrations/` |
| `npm run db:migrate` | Apply pending migrations to the **local** database (deploys apply them automatically) |
| `npm run db:status` | Show applied and pending migrations |
| `npm run hash-password` | Prompt for a password and print its hash for `APP_PASSWORD_HASH` |
| `npm run gen-secret` | Print a random value for `SESSION_SECRET` |

Always open the app through port **8888** (Netlify's dev proxy), not Vite's 5173. Only 8888 runs the functions and edge functions.

## Layout

- `src/`: React frontend (routes in `src/routes/`, API client in `src/lib/api.ts`)
- `netlify/functions/api.mts`: the REST API (Hono), mounted at `/api/*`
- `netlify/edge-functions/auth.ts`: session check in front of `/api/*`
- `netlify/database/migrations/`: generated SQL migrations (never edit after deploy)
- `lib/`: shared server-side logic, no Netlify dependencies (`lib/auth/` = password hashing and session tokens)
- `db/`: Drizzle schema (`schema.ts`) and client (`index.ts`)
- `scripts/`: one-off TypeScript scripts, run with `tsx`
- `tests/`: Vitest tests

## Conventions

- **Branches:** work on `dev`. Merge to `main` only at milestones, since each production deploy costs 15 of the account's 300 monthly Netlify credits. Pushes to `dev` make free branch deploys.
- **Money** is integer cents, never floats.
- **Imports** include the `.ts` extension (`'../lib/auth/session.ts'`). Edge functions run on Deno, which requires it, so it's used everywhere for consistency.
- `lib/auth/session.ts` (and anything an edge function imports) must use only web-standard APIs, no `node:` modules.
- TypeScript is strict. Three tsconfigs: `tsconfig.app.json` (browser, `src/`), `tsconfig.server.json` (functions, edge, lib, db, scripts, tests), `tsconfig.node.json` (Vite and drizzle config).
- Migrations: change `db/schema.ts` → `npm run db:generate` → `npm run db:migrate` → commit the generated SQL. Changes must be backward-compatible (no down migrations).
- Secrets live only in Netlify environment variables. `.env.example` lists the names.
