# Agenda

A notes + agenda app. Notes, first-class tasks, a folder/tag tree, and a daily
agenda — built on a clean, extensible foundation.

This repo currently contains the **foundation** (stack, data model, app shell,
editor base). The MVP features are tracked in `ROADMAP.md`; architectural
decisions and current state live in `CONTEXT.md`.

## Stack

- **Next.js** (App Router) + **TypeScript** + **Tailwind CSS v4** + **lucide-react**
- **Lexical** editor
- **Clerk** authentication
- **Neon** (Postgres) via **Drizzle ORM**
- Pluggable storage adapter (local-disk stub now; S3-ready interface)

## Getting started

### 1. Install

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

- `DATABASE_URL` — your Neon Postgres connection string (pooled).
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` — from the Clerk dashboard.

See `.env.example` for the full, documented list. **Never commit secrets** —
`.env.local` is gitignored.

### 3. Set up the database

Generate and apply migrations against your Neon database:

```bash
npm run db:generate   # generate SQL from src/db/schema.ts (committed to drizzle/)
npm run db:migrate    # apply migrations to the database
# or, for quick local iteration:
npm run db:push       # push schema directly without a migration file
```

Optional dev seed:

```bash
npm run db:seed
```

### 4. Run

```bash
npm run dev
```

Open http://localhost:3000. Sign in, then `/app` is the protected workspace.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (next config) |
| `npm run db:generate` | Generate Drizzle migrations |
| `npm run db:migrate` | Apply migrations |
| `npm run db:push` | Push schema (no migration file) |
| `npm run db:studio` | Drizzle Studio |
| `npm run db:seed` | Seed dev data |

## Project layout

```
src/
  app/                # App Router routes
    page.tsx          # landing
    sign-in, sign-up  # Clerk auth pages
    app/              # protected shell (sidebar + editor pane)
  components/
    editor/           # Lexical editor, theme, plugins
    layout/           # sidebar / shell UI
  db/                 # Drizzle schema + Neon client
  server/             # data-access layer (server-only)
  lib/storage/        # storage adapter + local stub
  middleware.ts       # Clerk route protection
drizzle/              # generated SQL migrations
scripts/seed.ts       # dev seed
```

## Reused vs. rebuilt

This was effectively a **greenfield rebuild**. The previous repo was a Create
React App skeleton with Auth0 stubs and **no Lexical editor** — the editor work
the rebuild was meant to salvage was not present in this repo. As a result:

- **Reused:** essentially nothing in code — only the conceptual app-shell idea
  (sidebar + content) and the `agenda-app` name. The old CRA source was removed.
- **Rebuilt from scratch:** the entire stack, data model, auth, app shell, and
  Lexical editor base.

The previous code remains intact on `main` and in history — nothing was
force-pushed, rewritten, or deleted.

## Roadmap & context

- `ROADMAP.md` — the full product vision, grouped and explicitly deferred.
- `CONTEXT.md` — architectural decisions and current state.
