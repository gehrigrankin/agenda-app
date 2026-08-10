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

- **AI lives behind `src/server/ai/*` and is optional end-to-end.** One
  boundary module (`src/server/ai/client.ts`) owns the Anthropic client
  (`claude-opus-4-8`, structured outputs via `messages.parse` + zod);
  `isAiConfigured` mirrors `isDbConfigured` — with no `ANTHROPIC_API_KEY` the
  app loads and every AI feature reports "not configured" instead of erroring.
  Retrieval is deliberately NOT embeddings/RAG: notes carry a `text_content`
  plain-text mirror (refreshed on save, lazily backfilled), and candidate
  selection is term-overlap + recency ranking in JS (`src/lib/text-rank.ts`)
  at personal scale — the model only ever sees the top few candidates.
  Ambient recall makes zero model calls (it fires on every typing pause, so it
  must be fast/free/private); ask-your-notes, voice extraction, thread
  detection, week review, and automations each make one structured call.
  Automations record undo data per action (`automation_runs`) so every rule
  execution is an ordinary, revertible edit. Meeting mode reads a read-only
  ICS subscription URL (`src/lib/ics.ts` parser, no calendar-write OAuth) —
  the smallest calendar integration that powers the scaffold.

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
  shared completion state. Reconciliation works off the `taskId`s found in the
  note's serialized content on save (a `blockKey` column originally meant for
  this was never written — Lexical node keys aren't stable across loads — and
  was dropped). Full multi-note sync is post-MVP, but the model supports it now.
- **Tags are FLAT labels on tasks, not the folder tree.** The original design
  had tags-as-folder-tree (`tags.parentId`, `isPinned`, `sortOrder`); ROADMAP
  item 4 replaced it with bubbles-as-folders and left tags for "search/filter
  chips, no hierarchy UI". That's what shipped: `#tag` typed into the task
  quick-add is parsed out server-side and found-or-created, a per-row picker
  edits the set, and the Tasks filter rail filters by tag (OR-ed — a second
  tag widens the result rather than intersecting it, because AND-ing empties
  the list on the second click and reads as broken). The hierarchy columns
  survive unread; `tags.parentId` has no FK in SQL, so don't start relying on
  it without adding one. `tags_owner_name_uq` (unique on `ownerId` +
  `lower(name)`) is what makes find-or-create-by-name safe without a
  transaction — Neon HTTP has none. **Notes are not tagged yet:** `note_tags`
  is migrated but nothing reads or writes it.
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

## Product coherence decisions (2026-08-02, with the owner)

A cross-feature review found the features working individually but drifting
apart at the seams. Decisions, recorded so future work doesn't re-litigate:

- **Notes + folders are the source of truth; the bubble canvas is a VIEW of
  them.** One name everywhere: "Folders" ("Boards" terminology retires). A
  bubble that holds notes is a folder; plain bubbles can't contain notes.
  ⌘K note hits always open the note editor, never the canvas.
- **/app/calendar is the one merged time view**: ICS events + quick-add
  events (a distinct personal layer, kept long-term) + due tasks + daily-note
  markers + day-plan blocks. The drag-to-plan timeline joins the phone
  calendar's Today tab (tap-to-place).
- **Reminders become real**: PWA install + web push + scheduled sends
  (owner expects iPhone notifications; requires home-screen install on iOS).
- **Habits are not tasks**: `isHabit` occurrences never appear on task
  surfaces, never go overdue, never carry. A missed day breaks the streak
  and passes. Rule management stays per-page (/app/tasks vs /app/habits).
- **Gardener's job is "find what I forgot"** — it absorbs Lost & Found;
  stale boards get their contents resurfaced (never archived/hidden);
  merge-duplicates stays as a minor tidy; link-suggestions drop (recall +
  threads cover relatedness; recall must skip already-linked notes).
- **Every dismissal is reversible** (Gardener/Threads/meeting declines get a
  Dismissed section / un-decline). Reversibility replaces confirm dialogs.
- **Carried tasks have one home**: the tasks widget's CARRIED OVER section.
  Other surfaces (plan card, meeting card, week review) reference counts,
  not re-rendered rows.
- **Home interruption budget**: at most ONE full card above the daily editor
  (meeting > plan > week review); the rest collapse into a single digest
  chip row.
- **Capture honesty**: the inbox email address was a demo facade (no inbound
  path exists) — it comes out; PWA share-target becomes the real capture
  path (inbound email later, when a domain exists). Voice memos get an
  "unsaved memo" nudge + minimal recovery list. Undated tasks get an
  "Unscheduled" section on /app/tasks; voice-extracted tasks link back to
  their daily note. Notes gains a browsable Dailies section.
- **Threads stays**, but persisted threads render without an API key (the
  key gates only new scans).

Sequencing: bug/trust fixes first, then phases in the order container model →
calendar/time → habits → resurfacing → capture/PWA. See ROADMAP.md.

## Guest workspaces (2026-08-08, with the owner)

`/` stopped being a landing page. It redirects: anyone with a workspace —
Clerk session or guest cookie — lands on `/app`, everyone else on `/sign-in`,
where "continue as guest" lives. There is no "open app" button any more.

- **A guest is just another `ownerId`.** No local users table was ever needed,
  so a guest costs no schema: Clerk mints `user_…`, we mint `guest_…`, and
  `src/server/*` cannot tell the difference. The split is resolved once, in
  `src/app/app/owner.ts` (`getOwnerId` / `requireOwnerId`, which replaced the
  Clerk-only `requireUserId`).
- **The cookie is the credential**, so it is httpOnly and holds 122 bits of
  UUID entropy; `parseGuestOwnerId` is the trust boundary and only a
  well-formed id ever becomes an `ownerId`. Middleware treats a valid guest
  cookie as authorization for `/app`.
- **Rejected: keying guests by IP address.** Everyone behind one NAT would
  share a workspace, and switching WiFi→cellular would silently orphan it.
  **Rejected: localStorage.** The whole repo layer is server-side; a
  localStorage guest means a second implementation of the app.
- **Guests get the full app**, not a demo — the point is that the work is real
  enough to be worth keeping.
- **Signing up claims the workspace.** `/app/claim` (a Route Handler, so no
  layout wraps it and there is no redirect loop) rewrites `ownerId` across the
  24 owner-scoped tables. It **refuses to merge into a non-empty account**:
  nine owner-scoped unique indexes would need row-by-row reconciliation
  (`bubbles_owner_root_uq` collides by definition), and neon-http has no
  transaction to roll back a half-merge. The case that matters — try, then
  sign up — always lands on an empty account.
- **30-day retention.** `guest_sessions` exists only to record that a
  workspace exists and when it was last seen; inferring liveness from row
  timestamps would delete an old note out from under an active guest. The
  daily `/api/cron/purge-guests` sweep deletes abandoned and already-claimed
  guests. Both claim and purge retire the `guest_sessions` row LAST, so an
  interrupted run resumes instead of reporting success.

## Note dock, task chips, and save durability (2026-08-09, with the owner)

The dock stopped being a row of windows and tasks became draggable objects;
both changes came out of using the thing, and both have an ordering hazard
underneath them worth knowing about.

- **One tabbed window, not three floating ones.** Three side-by-side editors
  ate the screen they were floating over, each spent a title bar on one
  document, and the row had no answer for a fourth note. The dock is now a
  single window with a tab strip (`NoteDock.tsx`), capacity 3 → 8. **Only the
  focused tab mounts an editor**: a background tab with a live editor would
  autosave a document nobody is looking at, and the debounced save already
  flushes on unmount, so switching tabs commits pending edits rather than
  dropping them. The full-page guard survived in a better form — the tab
  stays, focus moves to a sibling, and the window refuses to mount an editor
  for the note the page behind it is already editing.
- **Resize from the top-left only.** The window is anchored bottom-right, so
  that is the one corner that resizes without fighting the anchor. A dragged
  size wins over the preset until a preset button is pressed.
- **A dragged task writes its destination link BEFORE any save.** Dropping a
  task moves a block between two documents that autosave on independent
  debounces. If the source note saved first, the task would hold zero links
  for a moment — precisely the state `reconcileNoteTasks` step 3 reads as
  "the user deleted this" before hard-deleting the row. `linkTaskToNoteAction`
  writes the destination link on drop, ahead of both saves, so that window
  never exists. The source removes its own copy on `dragend` and only when
  `dropEffect === "move"`, so a drag that ends nowhere costs nothing.
- **Task indent lives on the node, not the tree.** A `DecoratorNode` has no
  `indent` (that is `ElementNode`), so Tab/Shift+Tab move a field on
  `TaskNode` that the DOM wrapper turns into a margin. The block stays a
  **top-level sibling** — nesting tasks inside list items would change what
  "the blocks under this heading" means to `note-logs` and to
  `reconcileNoteTasks`.
- **A task chip is `contentEditable={false}`.** It lives inside the note's
  contenteditable, and without that the browser parks the text caret inside
  the row, where it blinks in the middle of the checkbox and reads as a stray
  dot. Same fix, same reason, as `LinkedNoteCardNode`. It also makes Lexical
  select the chip as a node, so Backspace deletes the whole task.
- **A failed save is assumed to be version skew, and treated as recoverable.**
  A Next.js server action is pinned to the build that produced it: a tab whose
  bundle predates a deploy gets a 404 on every action, autosave included,
  silently, until it is reloaded. Three responses: `deploymentId` in
  `next.config.ts` (needs **Skew Protection** enabled in the Vercel project —
  still off as of this writing), a `localStorage` stash of any document the
  server refused with a Restore/Discard bar on next load, and a save indicator
  that is a *button* saying "reload" instead of a red label. The stash is
  never applied automatically — the copy on screen may be the newer one.

## Card anchors, task nesting, and the autosave baseline (2026-08-10)

Three decisions from the same session, and the first two are the same decision
twice: **derived structure beats a stored pointer whenever a thing can appear
in more than one document.**

- **A linked-note card owns a SECTION of the note it embeds**, marked by a
  `card-anchor` block appended to that note (`src/lib/card-anchors.ts`). The
  card shows the blocks after its anchor, up to the next anchor. Headings do
  NOT close a section — only the next anchor does, so two cards can never claim
  the same paragraph, which is the failure mode that matters when the blocks
  belong to somebody else's note.
- **A card SPLICES on save; it never overwrites.** It holds a slice of another
  document, so writing the whole thing back would delete every part it cannot
  see. `neon-http` has no interactive transactions, so this is read-modify-write
  with a small race — strictly narrower than the whole-document copy it
  replaced. A missing anchor at save time is REPORTED, never re-appended:
  re-adding it would resurrect writing the user just deleted over there.
- **Task nesting has no `parent_id`, on purpose** (`src/lib/task-tree.ts`).
  `note_tasks` is many-to-many with shared completion, so one task can sit in
  several notes; a global parent column would force a single nesting on a task
  that is legitimately nested differently in each. Children are the CONSECUTIVE
  run of following tasks at greater indent, and a non-task block ends the run —
  otherwise folding a parent would swallow a paragraph written between two
  tasks.
- **The autosave baseline is compared structurally, not by string.**
  `useNoteAutosave` must ignore the editor's mount-time normalization fire (it
  would bump `updatedAt` on mere opening) but must NOT ignore a real first
  edit. Those were indistinguishable while the rule was "the first fire is the
  baseline", and since `OnChangePlugin` runs with `ignoreSelectionChange`, a
  document needing no normalization fires nothing at mount — so the first
  genuine edit was silently dropped. Typing hid it; a one-shot change (folding
  a task, collapsing a card) was lost outright. The fix compares the fire to
  the loaded content with `deepEqual`, because jsonb canonicalizes key order
  and the round-tripped copy never stringifies identically to Lexical's own
  serialization.

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
