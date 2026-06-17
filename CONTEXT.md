# CONTEXT — decisions & current state

A scratchpad so future threads have context. Update as decisions are made.

## Current state (foundation)

The foundation (Steps 2–4 of the rebuild prompt) is in place:

- Next.js (App Router) + TypeScript + Tailwind v4 + lucide-react.
- Clerk auth wired (middleware-protected `/app`, sign-in/up routes, `UserButton`).
- Drizzle schema for all entities + migration tooling.
- Neon Postgres client (`src/db`).
- Lexical editor base (rich text, lists, checklists, code, links, undo/redo).
- App shell: protected `/app` with sidebar + editor pane.
- Storage adapter interface + local-disk stub.
- Dev seed script.

**Not yet built:** the 7 MVP features themselves (Note CRUD, tag tree, task
nodes, search/palette, trash, daily agenda). Foundation stops here by design;
checking in before building features.

## Key decisions & the *why*

- **This was a near-greenfield rebuild, not a port.** The prior repo was a
  broken Create React App skeleton with Auth0 stubs and **no Lexical editor**
  (the prompt assumed a Next.js + Lexical repo to salvage — that code wasn't
  here; the user believes it's on an old machine). Nothing meaningful was
  ported. See README "Reused vs. rebuilt".
- **Branch:** work is on the platform-managed session branch
  `claude/new-session-sxr05c` (not `rebuild/foundation` as the prompt's example
  named) to satisfy the harness's branch policy. `main` is untouched — that's
  the real hard constraint, and it holds. Old work remains fully recoverable.
- **Clerk over Auth0.** Per the prompt and confirmed by the user ("I have Clerk
  setup already"). No local users table — Clerk is the identity source of
  truth; `ownerId` columns store the Clerk user id.
- **Tasks are first-class.** Stored in `tasks`, linked to notes via `note_tasks`
  (not embedded in note JSON), so one task can appear in multiple notes with a
  shared completion state. `note_tasks.blockKey` ties a task row to its Lexical
  node for reconciliation. Full multi-note sync is post-MVP, but the model
  supports it now.
- **Tags == folder tree.** Self-referential `tags.parentId`; `isPinned` for
  pinned folders; `sortOrder` for manual ordering.
- **Soft delete** via `notes.deletedAt` powers Trash.
- **Daily jot** modeled as a note with a `dailyDate`; a unique
  `(ownerId, dailyDate)` index enforces one per day.
- **DB driver:** `neon-http` (serverless-friendly, no interactive transactions).
  Swap to the `neon-serverless` Pool driver if atomic multi-statement
  transactions are needed — schema/queries unchanged.
- **Storage** behind a `StorageAdapter` interface; local-disk stub now, S3
  drops in later via `STORAGE_DRIVER`.
- **Data layer isolation:** all DB access lives in `src/server/*` (`server-only`
  guarded). UI/editor never import drizzle directly.

## Layout map

- `src/app` — routes (landing, `(auth)` sign-in/up, protected `/app` shell).
- `src/components/editor` — Lexical editor, theme, plugins.
- `src/components/layout` — sidebar / shell UI.
- `src/db` — drizzle schema + client.
- `src/server` — data-access functions (the place server actions call into).
- `src/lib/storage` — storage adapter + local stub.
- `drizzle/` — generated SQL migrations.
- `scripts/seed.ts` — dev seed.

## Conventions

- `@/*` path alias → `src/*`.
- Keep deferred features (AI, widgets, integrations) out of the tree until
  scheduled; they have obvious homes (`src/server/ai`, etc.) when they land.
