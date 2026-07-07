# ⚠️ Ops note (2026-07-07)

**Never run two `next dev` processes on this repo at once.** Two servers
sharing one `.next` dir corrupt each other's chunks — symptoms: blank app,
eternal daily-note spinner, `ChunkLoadError`/404 on `/_next/static/chunks/*`,
random 500s, "Load failed" TypeErrors. This bit us twice today (Claude's
verification server ran alongside the user's). Fix: `kill $(lsof -ti :3000
:3001)`, `rm -rf .next`, start ONE server.

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
  (see "known rough edges" below) was added on `claude/handoff-review-3jiyih`.

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
