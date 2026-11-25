# Plan: Step 1 — Foundation

**Goal:** a deployed, password-protected, empty app shell that can talk to the database. No finance features yet. Everything later in the project builds on this.

**Done when:**
- `npm run dev` runs the full app locally (frontend, API, auth, local database) from one command.
- Visiting any page without logging in sends you to `/login`.
- After logging in, the home page shows "Database: connected", proven by a real query.
- A push to `dev` produces a working branch deploy, and a merge to `main` produces a working production site.

---

## 1. Project scaffold

**What:** create the React + TypeScript app with Vite.

- Command: `npm create vite@latest` with the `react-ts` template. The folder already has files, so I'll scaffold into a temp folder and move the files in, so nothing gets overwritten.
- **Vite** is the build tool and dev server. In development it serves the source files directly and reloads instantly on save. For production it bundles everything into static files in `dist/`, which Netlify serves from its CDN.
- **TypeScript** in strict mode.

**Also added:**
- **Tailwind CSS v4** (`@tailwindcss/vite` plugin): utility-class styling, so you write `class="p-4 text-sm"` instead of separate CSS files. v4 needs no config file, just one `@import "tailwindcss"` in the main CSS.
- **React Router**: client-side routing (`/`, `/login`, later `/ledger` and so on). Netlify gets one rewrite rule so any URL serves `index.html` and the router takes over.
- **TanStack Query**: fetches data from the API and caches it, handling loading and error states. Only used for the health check in this step.

## 2. Netlify configuration

**What:** `netlify.toml` at the repo root, telling Netlify how to build and serve the app.

```toml
[build]
  command   = "npm run build"
  publish   = "dist"                     # Vite's output folder

[functions]
  directory = "netlify/functions"

[[redirects]]                            # SPA fallback for React Router
  from   = "/*"
  to     = "/index.html"
  status = 200
```

- **Netlify CLI** goes in as a dev dependency (`netlify-cli`), so it's pinned per project and run with `npx netlify`. Main commands:
  - `netlify dev`: runs Vite, the functions, the edge functions and a local database together, behaving like production.
  - `netlify login`, `netlify link`: connect this folder to your Netlify site.
- **Functions** (`netlify/functions/`) are Node.js code that runs on demand. Each file becomes an endpoint.
- **Edge Functions** (`netlify/edge-functions/`) run on Deno at Netlify's CDN edge, *before* a request reaches the page or function. That makes them the right place for the auth check.

## 3. API skeleton

**What:** one function, `netlify/functions/api.mts`, mounted at `/api/*`, using **Hono** for routing.

- **Hono** is a small, fast router built on web-standard `Request`/`Response`. It lets us define `app.get("/api/health", …)` style routes in one function instead of one file per endpoint. That keeps cold starts and config simple, and it's fully typed.
- Endpoints in this step:
  - `POST /api/login`: checks the password and sets the session cookie.
  - `POST /api/logout`: clears the cookie.
  - `GET /api/health`: runs `SELECT 1` against the database and returns `{ db: "ok" }` or an error.

## 4. Database: Netlify Database + Drizzle

**What:** add Netlify Database and wire up Drizzle. This is **Netlify Database** (`@netlify/database`), the current product, not the older "Netlify DB" / `@netlify/neon` extension.

**How it works:**
- **Production:** Netlify sees `@netlify/database` in the project and provisions a Postgres database on the first deploy.
- **Deploy previews and branch deploys:** each one gets its **own database branch, forked from production data**. Testing on `dev` can't damage real data.
- **Local:** `netlify dev` starts a **local Postgres on your machine** and stops it with the dev server. It's completely separate from production.
- **Connection:** automatic. Code imports the Drizzle adapter and the connection string is filled in by the environment (`NETLIFY_DB_URL`). We don't manage a database URL ourselves.

**Setup (done manually rather than with the interactive `netlify database init`, so it fits our folder layout):**
```
npm install @netlify/database drizzle-orm@beta
npm install -D drizzle-kit@beta
```
- `drizzle-orm@beta` is what Netlify's docs specify. The Netlify adapter lives in the upcoming Drizzle 1.0, which is published under the `beta` tag.
- `db/schema.ts`: tables defined in TypeScript. **Empty in this step**; the ledger tables come in step 2.
- `db/index.ts`:
  ```ts
  import { drizzle } from "drizzle-orm/netlify-db";
  import * as schema from "./schema";
  export const db = drizzle({ schema });
  ```
- `drizzle.config.ts` points drizzle-kit's output at Netlify's migrations folder:
  ```ts
  export default defineConfig({
    dialect: "postgresql",
    schema: "./db/schema.ts",
    out: "netlify/database/migrations",
  });
  ```

**Migrations, end to end:**
1. Change `db/schema.ts`.
2. `npm run db:generate` → drizzle-kit compares the schema to the last snapshot and writes a SQL migration file into `netlify/database/migrations/`.
3. `npm run db:migrate` → applies it to your **local** database. Netlify doesn't do this automatically locally.
4. Commit and push → Netlify applies it to the preview or production database **just before publishing**. If it fails, the deploy is blocked and the previous version stays live.

There are no down migrations, so changes must be backward-compatible, and deployed migrations are never edited.

⚠️ **To verify in step 2:** Netlify's docs say to point drizzle-kit at that folder but don't show the generated file layout. Drizzle names files `0000_name.sql`, which matches Netlify's `<number>_<slug>` rule. Drizzle also writes snapshot metadata alongside, and I'll confirm Netlify ignores it. Step 1 has no tables, so the first real migration (step 2) is where this gets tested.

## 5. Authentication

**What:** a single password gate, with the work split between a Node function and an edge function.

**Flow:**
1. You submit a password on `/login`, which POSTs to `/api/login`.
2. The function hashes the submitted password with **scrypt** (Node's built-in, deliberately slow hash) and compares it to `APP_PASSWORD_HASH` using a constant-time comparison. The plain password is never stored anywhere.
3. On success it creates a session token: `expiry timestamp + HMAC-SHA256 signature` using `SESSION_SECRET`. It's sent as a cookie: `HttpOnly` (JavaScript can't read it), `Secure` (HTTPS only), `SameSite=Strict` (not sent on requests from other sites), 30-day expiry.
4. The **edge function** (`netlify/edge-functions/auth.ts`) runs on every request and verifies the signature and expiry using Web Crypto. That's a cheap HMAC check, not the slow password hash.
   - `/api/*` without a valid session → `401`.
   - A page request without a valid session → redirect to `/login`.
   - Always allowed: `/login`, `/api/login`, and the static JS/CSS bundles.

**Why the static bundles are public:** they contain only app code, no data. All of your data is behind `/api/*`, which is strictly gated. Gating the bundles would break the login page itself.

**Why a signed cookie rather than a sessions table:** a single user doesn't need server-side sessions, and the edge function can verify the cookie without a database round trip (which also avoids waking the database and spending credits). The trade-off is that individual sessions can't be revoked. Rotating `SESSION_SECRET` logs out everything at once, which is enough here.

**Why not Netlify's built-in password protection:** it's only available on the Pro plan.

**Setup helper:** `scripts/hash-password.ts`. Run `npm run hash-password` and it prompts for your chosen password and prints the hash to paste into the environment variables.

**Brute-force protection:** a fixed ~1 second delay on failed logins. Together with a long password, that's sufficient for a single-user app.

## 6. Environment variables and secrets

| Variable | Set by | Purpose |
|---|---|---|
| `NETLIFY_DB_URL` | Netlify (automatic, per environment) | Database connection; never set by hand |
| `APP_PASSWORD_HASH` | You, via the hash script | Login check |
| `SESSION_SECRET` | You, a random 32+ byte value (I'll give you a command) | Signs session cookies |

- Set the two secrets in the Netlify UI (Project configuration → Environment variables) for **all deploy contexts and local development**. `netlify dev` pulls them down automatically once the folder is linked.
- `.env.example` is committed with the variable *names* only, documenting what's needed.

## 7. Repo hygiene and tooling

- **`.gitignore`:** `node_modules/`, `dist/`, `.netlify/`, `.env*` (except `.env.example`), and `imports/` for real bank exports later.
- **ESLint:** comes with the Vite template. Catches common bugs.
- **Prettier:** consistent formatting, so diffs show only real changes.
- **Vitest:** the test runner. It uses the same config as Vite, so tests "just work" with TypeScript. Step 1 tests:
  - the session token: sign, verify, rejects a tampered token, rejects an expired one
  - password verification
- **tsx:** runs TypeScript scripts directly (`scripts/*.ts`) without a build step.
- **Project `CLAUDE.md`:** commands, conventions, the branch workflow, and a pointer to `ARCHITECTURE.md`.

**npm scripts:**
```
dev            netlify dev
build          type check + vite build
test           vitest
lint           eslint
format         prettier --write
db:generate    drizzle-kit generate              (schema → SQL migration)
db:migrate     netlify database migrations apply (local DB only)
db:status      netlify database status
hash-password  tsx scripts/hash-password.ts
```

## 8. Resulting file tree

```
TreasureHoard/
├─ netlify.toml
├─ package.json
├─ vite.config.ts  tsconfig*.json  drizzle.config.ts  eslint.config.js
├─ .gitignore  .env.example  .prettierrc  CLAUDE.md  ARCHITECTURE.md  README.md
├─ index.html
├─ src/
│  ├─ main.tsx              # React entry: router + query client
│  ├─ index.css             # Tailwind import
│  ├─ routes/
│  │  ├─ Home.tsx           # shows the DB health status
│  │  └─ Login.tsx
│  └─ lib/api.ts            # fetch wrapper; on 401, redirect to /login
├─ netlify/
│  ├─ functions/api.mts     # Hono app: login, logout, health
│  ├─ edge-functions/auth.ts
│  └─ database/migrations/  # empty until step 2
├─ lib/
│  └─ auth/                 # password hashing + session token (shared, tested)
├─ db/
│  ├─ schema.ts
│  └─ index.ts
├─ scripts/hash-password.ts
├─ tests/auth.test.ts
└─ docs/plans/01-foundation.md   # this file
```

## 9. Order of work

| # | Task | Who |
|---|---|---|
| 1 | Create the `dev` branch locally; all step 1 work happens there | Claude |
| 2 | Scaffold Vite + React + TS, Tailwind, Router, Query | Claude |
| 3 | Tooling: ESLint, Prettier, Vitest, tsx, scripts, `.gitignore`, project `CLAUDE.md` | Claude |
| 4 | Auth library + tests | Claude |
| 5 | Hono API function, edge function, login page | Claude |
| 6 | Install `@netlify/database` + Drizzle, `db/` files, health check | Claude |
| 7 | `npx netlify login` (opens a browser) | **You** |
| 8 | Create the site: Netlify UI → Add new project → Import from Git → `TreasureHoard` (originally `Personal-Finance-App`; renamed 2026-11-24). Production branch `main`. Then enable **branch deploys for `dev`** (Project configuration → Build & deploy → Branches and deploy contexts) | **You**, with my guidance |
| 9 | `npx netlify link` in the project folder | **You** |
| 10 | Choose a password, run the hash script, generate the session secret, set both env vars in the UI | **You**, with my commands |
| 11 | Verify locally with `npm run dev` | Both |
| 12 | Commit and push `dev` → branch deploy; verify login and DB health on the preview URL | Claude commits when you say so; both verify |
| 13 | Merge `dev` → `main` → first real production deploy; verify the live site | When you say so |

Claude stops at each **You** step with exact instructions. After the step, you'll get a full technical rundown of what was built.

**Credit note:** importing the repo in task 8 triggers an immediate production deploy of `main`. At that point `main` holds only the docs, so it's one 15-credit deploy of an empty site, a one-time cost. Task 13 is the second. After that, production deploys happen only at milestones.

## Deviations during implementation

Recorded as tasks 1–6 were built (2026-11-24):

1. **Auth gate covers `/api/*` only, not pages.** Under `netlify dev`, Vite serves the app's source from many paths (`/src/*`, `/@vite/*`, `/node_modules/*`…), so gating pages at the edge would have needed a fragile allow-list. Pages hold no data, so the app itself redirects to `/login` when the API answers 401 (`src/lib/api.ts`).
2. **Auth is checked twice:** at the edge, and again as Hono middleware inside `api.mts`. The second check is cheap insurance against the edge config drifting.
3. **TypeScript 6.0, not 7.** The Vite template installs TypeScript 7 (the Go port), but Netlify CLI's function bundler (`precinct` → `@typescript-eslint/typescript-estree`) loads TypeScript's JavaScript API and crashed with TypeScript 7. It supports up to 6.0.
4. **oxlint instead of ESLint.** It's the new Vite template default.
5. **`hono/netlify` adapter not used.** It's deprecated. The function exports `(req) => app.fetch(req)` directly.
6. **Prettier skips Markdown** (`.prettierignore`), so hand-formatted docs aren't reflowed.
7. **Local env vars must come from Netlify or a `.env` file.** The local edge runtime doesn't inherit variables from the shell. Values containing `$` (like the password hash) must be single-quoted in a `.env` file, or the loader may treat `$…` as variable references. Once the folder is linked, variables set in the Netlify UI are injected automatically.

8. **The SPA fallback rule is generated at build time, not in `netlify.toml`.** As planned in section 2, the rule (`/* → /index.html`) also applied under `netlify dev`. There it rewrote Vite's dev-only module requests (`/src/main.tsx`, `/@vite/client`) to `index.html`, so the app failed to load locally. The step 1 smoke test only requested pages, not scripts, so it missed this. Fix: a small Vite plugin in `vite.config.ts` writes `dist/_redirects` during production builds only, and `[dev] publish = "public"` stops `netlify dev` from reading `dist/`. Vite's dev server does its own SPA fallback locally.

## Decisions to confirm

Defaults chosen; say if you want any changed:

1. **Hono** for API routing, rather than hand-written routing or one function per endpoint.
2. **Tailwind v4** for styling.
3. **React Router** for client routing. TanStack Router is a typed alternative with more setup.
4. **30-day** sessions.
5. **Prettier** for formatting. It's optional; some people prefer ESLint alone.
6. **Manual database setup** instead of the interactive `netlify database init`, so files land where our layout expects them. Same result, fewer steps for you.
