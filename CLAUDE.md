# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A notes + agenda app: notes with a Lexical rich-text editor, first-class tasks, a "bubble map" (infinite pan/zoom canvas of nested bubbles that doubles as the folder system), daily jots, trash, and a Ctrl+K palette. The MVP is complete; `ROADMAP.md` tracks post-MVP work and `CONTEXT.md` records architectural decisions and their rationale — read those when making design-level choices.

# Instructions (must follow)
- use sub agents to save xost on tasks that done require the advanced reasoning of Fable and ensure the quality of the work remains consistent to what you would do on your own.

## Commands

- `npm run dev` — dev server
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — next lint
- `npm run build` — runs `scripts/predeploy-migrate.ts` then `next build`; migrations only run on Vercel, so local builds never need the DB
- Database (reads `DATABASE_URL` from `.env.local`):
  - `npm run db:generate` — generate SQL migrations from `src/db/schema.ts` into `drizzle/` (committed)
  - `npm run db:migrate` — apply migrations
  - `npm run db:push` — push schema directly (quick local iteration, no migration file)
  - `npm run db:studio`, `npm run db:seed`

- `npm run test` — Vitest unit tests for the pure lib modules (`src/lib/*.test.ts`); no DB or auth needed

## Stack

Next.js App Router + TypeScript + Tailwind v4 + lucide-react; Lexical editor; Clerk auth; Neon Postgres via Drizzle ORM (`neon-http` driver — **no interactive transactions**; swap to `neon-serverless` Pool if ever needed).

## Architecture

Layering (enforce this):

1. **`src/db/`** — Drizzle schema (`schema.ts`) and client. Only `src/server/*` touches the DB directly.
2. **`src/server/`** — data-access layer (`notes.ts`, `tasks.ts`, `bubbles.ts`, `recurring.ts`), all `import "server-only"`. No auth here; functions take `ownerId` explicitly.
3. **Server actions** (`src/app/app/actions.ts`, `src/app/app/bubbles/actions.ts`) — wrap the repo layer, enforce Clerk auth via `requireUserId()`, call `revalidatePath`. UI components call these, never drizzle.
4. **Components** (`src/components/`) — grouped by feature: `bubbles/` (canvas), `editor/` (Lexical + custom nodes/plugins), `notes/`, `today/`, `layout/`, `search/`.

Key data-model decisions (details in `CONTEXT.md` and the `schema.ts` header comment):

- **No local users table.** `ownerId` columns store the Clerk user id; every query must be owner-scoped.
- **Tasks are first-class rows** in `tasks`, linked to notes via `note_tasks` (reconciled from the `taskId`s found in the note's serialized content on save) — never embedded in note JSON. One task can appear in multiple notes with shared completion state.
- **Bubbles are the folder system.** Bubbles opt in via `isFolder` and surface as sidebar folders; notes with a `bubbleId` live inside a bubble and are excluded from the main notes list. The `tags` table's hierarchy exists in the schema but has no folder-tree UI (tags reserved for future flat labels).
- **Soft delete** via `notes.deletedAt` powers Trash.
- **Daily jot** = a note with `dailyDate`; unique `(ownerId, dailyDate)` index enforces one per day.
- Note content is serialized Lexical editor state stored as JSONB.
- **Graceful DB degradation:** `isDbConfigured` in `src/db/index.ts` — the app must load (with empty reads) when `DATABASE_URL` is unset; don't add code that throws at import time on a missing DB.

Schema changes: edit `src/db/schema.ts`, then `npm run db:generate` and commit the generated files in `drizzle/`.

## Bubble canvas

`src/components/bubbles/BubbleCanvas.tsx` is the heart of the bubble map: shelf-packed containers laid out once in world coordinates, pan/zoom via a single CSS transform, semantic zoom (detail vs. tile mode), screen-pixel-capped chrome, and a "dissolving" focused container. Read its header comment before touching layout or zoom behavior — the design intent is app-like, not canvas-like.

## Environment

`.env.local` (gitignored): `DATABASE_URL` (Neon pooled), `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`. See `.env.example`. Image uploads use a pluggable `StorageAdapter` (`src/lib/storage/`) with three drivers: `local` (dev, writes to `public/uploads` — ephemeral on Vercel), `db` (bytes in Postgres, the default when a DB is configured), and `s3` (production path; set `STORAGE_DRIVER=s3` + the `S3_*` vars).
