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

- **UI density is rem-based; the root font-size is the knob — and it's pinned
  in absolute px.** All chrome and type — including Tailwind arbitrary values,
  which used to be hard px — are sized in rem; `globals.css` sets the root to
  16px on mobile and 13px on `md+`. Rationale for 13px: laptops at 125–150% OS
  scaling only get ~1100–1400 CSS px of viewport, where a 16px-base design
  read comically oversized ("made for 70 year olds"). Rem scaling was chosen
  over CSS `zoom` because `zoom` changes the coordinate space and breaks every
  rect-positioned floating element (Lexical typeahead menus, portaled
  popovers, Clerk's popup).
  **Two hard-learned rules from shipping this** (the owner's browser has an
  enlarged default font size, e.g. Edge font settings / Windows accessibility):
  (1) the root font-size must be absolute px, never `%`/unset — a %-based root
  tracks the browser default and inflated the whole layout ~1.25×, overflowing
  the viewport; (2) Tailwind v4 breakpoints must be overridden in px in
  `@theme` — the rem defaults resolve against the browser default font size
  inside media queries, which silently shifts every breakpoint (`lg` becomes
  1536px at a 24px default) and collapses the responsive layout.
  Keep new sizes in rem (`text-[0.78125rem]`, not `text-[12.5px]`); hairline
  borders/rings stay px on purpose. World-space bubble-canvas sizing (inline
  styles, screen-px-capped chrome) is intentionally not rem — the canvas has
  its own zoom model.
- **The home has two layout modes, split at `xl` (1280px).** ≥xl: the fixed
  no-scroll dashboard (daily note + right rail side by side). Below xl —
  snapped windows, small laptops, phones — everything stacks full-width and
  the page scrolls, with widgets at natural height. Two hard-learned rules:
  the old `lg` (1024) threshold put the 3-column dashboard on ~1029px windows
  where it had no room; and in the stacked mode the main column must NOT keep
  the dashboard's `flex-1 min-h-0` (they made widgets shrink below content
  and overlap through the translucent panels — the longstanding "phone looks
  broken" bug).
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
