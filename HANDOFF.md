# ⚠️ Ops note (2026-07-07)

**Never run two `next dev` processes on this repo at once.** Two servers
sharing one `.next` dir corrupt each other's chunks — symptoms: blank app,
eternal daily-note spinner, `ChunkLoadError`/404 on `/_next/static/chunks/*`,
random 500s, "Load failed" TypeErrors. This bit us twice today (Claude's
verification server ran alongside the user's). Fix: `kill $(lsof -ti :3000
:3001)`, `rm -rf .next`, start ONE server.

# Session 2026-08-09 (later) — dock dead tabs, seed account wiped (PRs #79, #80)

## ⚠️ There is now only ONE account with data

The owner uses **rgrankin22@gmail.com** (`user_368szVRdV9GLCaCol5TQ8e8XIuy`,
~1000 rows). The old fixture account **gehrigspam@gmail.com**
(`user_3G6XlNsafcrl2kZCkdAV8OiyhZF`) had its 107 rows deleted at his request —
a second populated workspace kept reading as a bug ("this note isn't
available" on a note that plainly existed).

**The Clerk login was kept on purpose**, empty, as a sandbox: headless
verification needs somewhere to write that is not his real data. Repopulate
with `npx tsx scripts/seed-dummy.ts` (defaults to that owner, wipes and
reseeds, safe to re-run). `.claude/skills/verify/SKILL.md` has the rules —
never point a writing test at his account. A JSON backup of the deleted rows
was written to the session scratchpad, which is not durable; treat the wipe as
permanent.

## What changed

- **#79 The dock stops haunting you with dead tabs.** A tab is just a note id
  in `sessionStorage` and nothing checked it still named a live, owner-visible
  note, so a note trashed elsewhere left a tab that said "This note isn't
  available" on every reload forever. Now `NoteDockProvider` verifies the
  restored set once after hydration (`getNoteTitlesAction`, already
  owner-scoped and live-only) and drops the dead ids before they render or get
  written back. **A failed check leaves the tabs alone** — no answer is not
  evidence of absence. `DockBody`'s load also split into
  loading/ready/gone/error: a thrown action offers **Try again**, a missing
  note offers **Close tab**. Verified headlessly end to end.
- **#80** `.claude/skills/verify/SKILL.md` rewritten for the empty sandbox,
  plus the `Content-Type: application/json` header the sign-in-token curl
  needs (without it Clerk reports `user_id` missing).

## Resolved from last session

- **`card-anchors.ts` — kept**, and committed here rather than left untracked.
  `ROADMAP.md` now names it as the starting point for note-link windows scoped
  to the current note. Nothing imports it yet; it is a design, not a feature.

## Still open

- **Skew Protection is still OFF** (owner-only toggle). Unchanged.
- **#79 is merged but NOT deployed** — the Vercel CLI deploy was blocked by a
  permission classifier in this session and never ran.

# Session 2026-08-09 — logs, note dock, task chips, save durability (PRs #68–#78)

## ⚠️ Gotchas — read these first

**Deploying breaks every tab that is already open.** A Next.js server action is
pinned to the build that produced it, so a tab loaded before a deploy gets a
**404 on every action** — autosave included — and just says "Save failed"
forever. This cost the owner an hour of failing saves in this session. Confirm
it from the logs, don't guess:
`npx vercel logs agenda-app-orcin-nine.vercel.app --json | tail -30` — look for
`POST /app/notes/<id>` flipping from 200 to 404 at the moment of a deploy.
Mitigations shipped in #76 (stash + reload button + `deploymentId`), but the
**Vercel → agenda-app → Settings → Advanced → Skew Protection toggle is still
OFF** and only the owner can flip it. Until then: **do not deploy while he is
working**, and tell him to reload after any deploy.

**There was no browser tooling this session** (Claude-in-Chrome not connected),
which made every visual claim a round trip through the owner. Two failures came
from that and both were avoidable:
- Bullets in the Logs panel: `list-disc` markers were rendered but invisible —
  preflight strips the padding they hang in, and `marker:text-ink-600` is
  nearly the card colour. Fix was to **draw markers as glyphs in flex rows**
  (`LogContent.tsx`), which no cascade can take away. Prefer that in dense
  rails generally.
- "Why does the checkbox have a dot in it": it was the **text caret** parked in
  the decorator. One question ("does it vanish when you click elsewhere?")
  settled what three rounds of screenshot theorising could not. **Ask that
  question first.**

**Verifying a pure React renderer without a browser:** write a scratch `.tsx`
inside the repo (module resolution needs its `node_modules`) and run
`TSX_TSCONFIG_PATH=<tsconfig with jsx:react-jsx> npx tsx scratch.tsx` printing
`renderToStaticMarkup(...)`. That proved the log bullets/nesting/chips in
seconds. Delete the scratch file afterwards.

## What changed

- **#68 Logs render blocks, not text.** `note_logs.content` already stored the
  serialized nodes; the panel was printing the plain-text mirror. New
  `src/components/notes/LogContent.tsx` renders lists (incl. nesting and
  checklists), headings, quotes, code, text formats, links, note-link and task
  chips, images — and falls back to `text` for rows written before the column.
- **#68 The "↳ logs to X" marker is a button.** `LogLinkPlugin.tsx` portals it
  beside the heading (CollapsePlugin's gutter-chevron model, positioned from a
  Range over the heading text); clicking opens the target in a dock window.
- **#69 Drawn list markers + text colour** in the floating toolbar
  (`$patchStyleText`, palette swatches, "Default" clears the style).
- **#70 The dock is one tabbed window** — see `CONTEXT.md` for the reasoning.
  Large preset is shorter/wider, compact is taller/wider, plus free resize by
  dragging the **top-left** corner. #75 squared the tab radius and added a "+"
  that creates a blank note as a tab.
- **#71 Strikethrough follows the text colour** (`currentColor`, 0.1em) — a
  fixed dark line vanished on coloured runs.
- **#72/#73/#74 Task chips**: drawn sage checkbox (the native one painted
  white), titles wrap everywhere they are listed (Tasks page, home widget,
  daily plan, day timeline), Shift+Enter adds a line inside a task, Enter
  starts the next one, `contentEditable={false}` keeps the caret out.
  **Still truncating on purpose:** month-calendar cells and TimeRail blocks —
  fixed geometry, a wrapped title would spill into the next hour.
- **#75 Tab/Shift+Tab indent a task** (field on `TaskNode`, max 6, Enter
  carries the depth).
- **#76 Save durability** — stash + Restore/Discard bar + reload button +
  `deploymentId`. See the gotcha above.
- **#77/#78 Drag a task between notes** — grip on hover, sage drop line, the
  whole row rides the cursor as the drag image, source dims and removes itself
  only if the drop was accepted.

## What's in flight

Nothing half-finished. `main` is clean, every PR merged, production deployed
(`agenda-app-orcin-nine.vercel.app`), and the four stale `auto/notarium/*`
branches were deleted — their titles claimed features that had already shipped
elsewhere; the only content left on them was `package-lock.json` churn.

`src/lib/card-anchors.ts` is still **untracked** — an unfinished linked-note
card-anchor module from an earlier session. Nothing imports it. Commit it or
delete it; it has been sitting there all session.
*(Resolved in the next session: committed, see above.)*

## What's next

The owner's own todo note (`notarium log`) is the queue, and two items on it
came up repeatedly while using the dock:

1. **Tasks with parent/child + a dropdown.** #75's indent is visual only —
   there is no parent field and no collapse. That is the real ask.
2. **Note-link windows show the whole target note on insert**; he wants only
   what he has written from the current note, and the window is too short for
   it. `src/lib/card-anchors.ts` (untracked) looks like the start of exactly
   this — read its header before rewriting it.

## Open questions

- **Skew Protection toggle** — owner-only, still off (see the gotcha).
- ~~**`card-anchors.ts`** — keep or delete?~~ Kept and committed.

# Session 2026-08-08 — guest workspaces + MCP write tools (PR #67)

## ⚠️ Gotchas — read before touching tasks-on-notes

**Putting a task on a note takes TWO writes, not one.** A `task` node carrying
the id must go into the note's serialized content AND a `note_tasks` row must
exist. Use `attachTaskToNote` in `src/server/mcp-tools.ts`; never
`linkTaskToNote` alone. `reconcileNoteTasks` (`src/server/tasks.ts:590`)
rederives the whole link set from note content on every editor save, deletes
any link past its 60s grace window with no matching node, then **hard-deletes
tasks left with zero links**. A link-only attach looks correct and destroys
the user's task about a minute later. `tasks_delete` has the mirror problem —
the FK cascades the link but not the checkbox in the note body — so it strips
those nodes first.

**There is no task trash.** `tasks` has no `deletedAt`; only `notes` does.
Tasks do NOT share the notes trash. `tasks_delete` is permanent.

**Verification ops that saved real time:**
- Warm every route with `curl` before launching Playwright. Next dev compiles
  on first hit and the first `page.goto` otherwise burns its timeout and
  fails. `curl -w "%{http_code} %{redirect_url}"` verifies redirects outright.
- Editing app files mid-session forces a recompile — the next Playwright click
  lands before hydration and silently no-ops. Wait ~6s after `goto`.
- To exercise `src/server/*` directly from a throwaway script:
  `npx tsx --conditions=react-server ./probe.mts`. That flag is what lets
  `server-only` modules load outside Next. This tested the 24-table claim
  rewrite and the whole MCP surface in seconds; a browser couldn't reach it.
- Do NOT `pkill -f "next dev"` — it kills servers you didn't start (see the
  ops note at the top of this file).

## What changed

**Guest workspaces.** `/` is no longer a landing page: anyone with a workspace
(Clerk session or guest cookie) goes to `/app`, everyone else to `/sign-in`,
which carries "Continue as guest". A guest is just another `ownerId` —
Clerk mints `user_…`, we mint `guest_…`, and `src/server/*` can't tell them
apart. Resolved once in `src/app/app/owner.ts`; `requireUserId` →
`requireOwnerId`, and pages call `getOwnerId()` instead of `auth()`.
Signing up claims the guest's rows via `/app/claim` (a Route Handler, so no
layout wraps it and there's no redirect loop). New `guest_sessions` table
(migration `0024`, **already applied to the production DB**) plus a daily
`/api/cron/purge-guests` sweep at 30 days. Rationale in `CONTEXT.md`.

**MCP write tools.** 8 new, 2 extended, 66 total: `tasks_set_note`,
`tasks_update`, `tasks_delete`, `notes_update`, `people_update`,
`tags_create`, `folders_create`, `habits_create`; plus `noteId` on
`tasks_create` and `noteId`/`includeCompleted` on `tasks_list`. Nine repo
functions added across `tasks.ts`, `people.ts`, `tags.ts`, `bubbles.ts`,
`habits.ts`. Verified live in production (`tools/list` serves all 66).

## In flight

- **`src/lib/card-anchors.ts` is untracked and nothing imports it.** 187 lines,
  fully documented, from an earlier session — the linked-note "card anchor"
  boundary logic. It predates this session and was deliberately left out of
  PR #67. Either finish wiring it up or delete it; it's exactly the kind of
  orphan that survives for months.
- **Four open auto-mode PRs**, two now conflicting because of this session:
  - #66 (Settings polish) — CONFLICTING; I rewrote the Settings account block
    for guests
  - #63 (notes sidebar recents) — CONFLICTING on `NotesShell.tsx`
  - #60 — clean, but its only changed file is `package-lock.json` despite
    claiming a design pass. Likely junk.
  - #59 — clean, but titled "tests for POST /api/tasks" while only adding
    `src/lib/lexical-text.test.ts`. Title and diff disagree.

## What's next

Rebase #66 and #63 onto the new Settings/TopBar code, and decide whether #60
and #59 are worth keeping.

## Open questions

- Should tasks get a real trash (`tasks.deletedAt` + migration)? `tasks_delete`
  is permanent today, which is why its tool description steers toward
  `tasks_complete`.
- Guest claim **refuses to merge into a non-empty account** (nine owner-scoped
  unique indexes would need row-by-row reconciliation; `bubbles_owner_root_uq`
  collides by definition, and neon-http has no transaction to undo a
  half-merge). Fine for try-then-signup. Revisit only if real merges are ever
  wanted.

# Since these sessions (July 8 – Aug 2)

Everything after #28 shipped via PRs #29–#37 — see the PR list for details:
quick-note composer + cross-off/bullet plugins (#29), People as a no-AI
contacts system, mobile redesign + notes folder system (#30), calendar
quick-add events (#32), lost & found (#33), folder management + Gardener
fixes (#34), drag-notes-onto-folders (#35), recently-opened notes (#36),
voice-overlay mic-permission timeout (#37). Stale branches were pruned and
PR #1 closed on 2026-08-02; `main` is the only branch.

# Session 2026-07-07 (later) — feedback fixes after first real use

Landed on `main` as part of #28 (commit f8f734a) along with the AI feature
set below.

- **Recall cards contained** (`RecallPlugin.tsx`): cards now clamp inside the
  editor's clipping ancestor both horizontally and vertically (they used to
  spill over the panel border onto the Tasks widget / calendar row); when
  there's no room inside the panel they don't render, and the recall roundtrip
  is skipped. Failed recall fetches are now silent (a transient dev
  "Load failed" used to pop the Next error overlay).
- **Automation feedback + checkbox items**: new `append_task` action kind —
  "add it to <list>" rules now create a real `tasks` row, link it via
  `note_tasks`, and append a checkbox task node to the target note (undo
  deletes both). Runner results now carry `runId`/`canUndo`, the autosave hook
  broadcasts them (`agenda:automations-ran`), and a new `AutomationToasts`
  (mounted in AppShell) shows 'added "…" to Reading list · Undo' bottom-right.
- **Cost posture**: AI model now defaults to `claude-haiku-4-5`, overridable
  via `AI_MODEL` env (client auto-drops adaptive thinking/effort params on
  models that reject them). Realistic spend well under $1/month; automations
  are the only recurring caller and only when enabled rules exist.
- Repo verify skill added at `.claude/skills/verify/SKILL.md` (headless
  Clerk-ticket recipe, gotchas). The voice overlay's mic-permission timeout
  (see "known rough edges" below) landed later as #37.

# Session 2026-07-07 — AI feature set (design 13ab + 14abcde)

Landed on `main` as #28 (commit f8f734a, "AI feature set: ask-your-notes,
recall, voice, threads, review, automations, meeting mode"), stacked on top
of the rail-switcher work below (same PR). typecheck + lint + 109 unit tests
green; verified headlessly at
1512px (recipe now lives in `.claude/skills/verify/SKILL.md`). Migration
`drizzle/0012_secret_hercules.sql` generated AND already applied to the Neon
dev DB. `ANTHROPIC_API_KEY` is documented in `.env.example` but NOT set in
`.env.local` — AI paths verified only in their degraded "not configured"
states; set the key to exercise ask/threads/review/automations/extraction for
real.

- **Server**: `src/server/ai/{client,ask,recall,extract,review,threads,automations}.ts`
  (boundary + features), new repos `settings/threads/automations/voice/
  week-reviews/meetings/calendar.ts`, `notes.ts` gains `text_content` mirror +
  corpus + append/remove-paragraph, `tasks.ts` gains find/delete/open-for-note.
  Actions in `src/app/app/ai/actions.ts`. Pure libs: `lib/ics.ts` (+17 tests),
  `lib/text-rank.ts`, `lib/lexical-build.ts`.
- **UI**: CommandPalette ask mode (13a); RecallPlugin in daily editor (13b);
  `/app/threads` + `/app/automations` pages + rail tiles (Threads, Rules);
  WeekReviewCard above the daily note on Sundays (14d); VoiceCaptureButton in
  the daily header (14a); MeetingModeCard + connect-ICS affordance (14c);
  `@name ` line-start transformer → task (14c); autosave now triggers
  automations after a 20s quiet period (`use-note-autosave.ts`).
- Known rough edges: voice recording can't be fully tested headlessly
  (getUserMedia missing in headless-shell — hangs at "requesting
  microphone…" — now capped by a 15s permission timeout that lands in the
  overlay's error state); meeting mode needs an ICS
  URL pasted via the daily-note affordance; thread scan self-throttles to 6h
  (force via the page's Refresh button).

---

# Session 2026-07-06 — rail board switcher + large-screen scaling

Landed on `main` as part of #28 (commit f8f734a); typecheck + lint pass;
verified via headless screenshots at 1512/1920px (auth recipe: memory file
`headless-auth-verification.md`).

- **NavRail board switcher** (`src/components/layout/NavRail.tsx`): new
  `BoardsRailMenu` — same chrome as the `+` button but a sage dot, in its own
  floating group below it. Drops down the board list (same items as TopBar's
  BoardsMenu), navigates to `/app/bubbles?b=<id>`. `NavRail` now takes a
  `folders` prop, passed from `AppShell`.
- **Large screens** (UI was tuned for ~1100×600 and read tiny on big displays):
  - `globals.css`: root font-size (the rem density knob) now steps 16px → 13px
    (md) → **14px ≥1440** → **15px ≥1920**; whole UI scales with it.
  - 2xl (≥1536px) layout loosening: daily-note column 48.125→56rem
    (`DailyNoteWidget.tsx`, editor + plan card), default editor 48→54rem
    (`Editor.tsx`), home right-rail grid track 18.75→21.5rem (`.home-grid` in
    `globals.css`), mini calendar 16→18rem / Yesterday 13.75→16rem
    (`HomeClient.tsx`).
- Tuning knob if it still feels small: the px steps at `globals.css` ~lines
  76–90.
