# ⚠️ Ops note (2026-07-07)

**Never run two `next dev` processes on this repo at once.** Two servers
sharing one `.next` dir corrupt each other's chunks — symptoms: blank app,
eternal daily-note spinner, `ChunkLoadError`/404 on `/_next/static/chunks/*`,
random 500s, "Load failed" TypeErrors. This bit us twice today (Claude's
verification server ran alongside the user's). Fix: `kill $(lsof -ti :3000
:3001)`, `rm -rf .next`, start ONE server.

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
