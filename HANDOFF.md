# ⚠️ Ops note (2026-07-07)

**Never run two `next dev` processes on this repo at once.** Two servers
sharing one `.next` dir corrupt each other's chunks — symptoms: blank app,
eternal daily-note spinner, `ChunkLoadError`/404 on `/_next/static/chunks/*`,
random 500s, "Load failed" TypeErrors. This bit us twice today (Claude's
verification server ran alongside the user's). Fix: `kill $(lsof -ti :3000
:3001)`, `rm -rf .next`, start ONE server. A stray detached server from the
Claude session may still be running at handoff time — the kill above clears it.

# Session 2026-07-07 (later) — feedback fixes after first real use

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
  Clerk-ticket recipe, gotchas). Known cosmetic gap: voice overlay has no
  timeout on a never-answered mic permission prompt.

# Session 2026-07-07 — AI feature set (design 13ab + 14abcde)

Uncommitted on `main`, stacked on top of the still-uncommitted rail-switcher
work below. typecheck + lint + 109 unit tests green; verified headlessly at
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
  microphone…"; consider a timeout on that state); meeting mode needs an ICS
  URL pasted via the daily-note affordance; thread scan self-throttles to 6h
  (force via the page's Refresh button).

---

# Session 2026-07-06 — rail board switcher + large-screen scaling

Uncommitted on `main`; typecheck + lint pass; verified via headless screenshots
at 1512/1920px (auth recipe: memory file `headless-auth-verification.md`).

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

---

# STALE (historical) — Redesign handoff, Notes App Redesign (Turn 10 home + Turn 9 semantics)

Everything below predates PRs #15–#27; its "not done" list has since shipped
(/app/notes exists, jots migrated & table dropped). Kept for reference only.

Full plan: ~/.claude/plans/buzzing-watching-lobster.md
Design HTML copy: ~/.claude/jobs/e7fb5bf0/tmp/design.html
Seeded test account: gehrigspam@gmail.com (owner user_3G6XlNsafcrl2kZCkdAV8OiyhZF, scripts/seed-dummy.ts)

## Done (typechecked after each phase)
- Phase 1 — Dark-only theme: `.dark` forced on <html>, @custom-variant dark,
  design tokens in @theme (sage/steel/tan/panel/ink ramp), Geist via
  next/font/google, editor checklist/link recolor, daily-gutter CSS.
- Phase 2 — New shell everywhere: TopBar (Boards dropdown, day switcher ?d=,
  ⌘K pill), floating NavRail, mobile bottom bar, /app/tasks page,
  old Sidebar/BubbleTree/NotesFolders/NoteList/NewNoteButton deleted.
- Phase 3 — TimedParagraphNode (+ per-composer node replacement in daily
  variant), TimestampPlugin (stamp-on-first-content, minute-cluster gutter),
  Editor variant/contentClassName/editorRef props.
- Phase 4 — Home rebuilt: HomeClient grid, DailyNoteWidget (real daily editor,
  autosave extracted to src/lib/hooks/use-note-autosave.ts and NoteEditor
  refactored onto it), MiniCalendar, PinnedBoardWidget, YesterdayWidget,
  TasksWidget (TaskDock successor); new actions getDailyNoteAction /
  listDailyNoteDatesAction / getDaySummaryAction; revalidate removed from
  getOrCreateTodayNoteAction.
- Phase 5 — ~95%: LinkedNoteCardNode, LexicalPreview (live task checkboxes),
  NotePreviewProvider (batched previews + QuickViewContext), QuickViewOverlay
  (real NoteEditor inside), LinkedTodayWidget (+ "link" append), NoteLinkPlugin
  daily card mode, collectNoteLinkIds + save-gate widened, HomeClient wired.
  REMAINING: DailyNoteWidget needs the new `onNoteLoaded` prop added; then
  `npm run typecheck && npm run lint`.

## Not done yet
- Phase 6 — /app/notes route: nested layout (list pane + [id] detail), pinned
  daily row. Server query `listNotesWithPreview` ALREADY EXISTS in
  src/server/notes.ts.
- Phase 7 — scripts/migrate-jots-to-daily.ts (--dry-run default, srcJotId
  idempotency, one write/day, no server/* imports) then delete
  src/components/today/*, DailyJot, TodayTasks, jot actions, src/server/jots.ts
  (keep jots TABLE with a legacy comment).
- Phase 8 — full manual verification: shell on all routes, bubbles-canvas rail
  overlap check, timestamps/cards/quick-view flows, day switcher, regressions
  (bubbles, trash), migration dry-run→apply→re-apply idempotency.
```

When you come back, "continue the redesign — check the task list and plan file" is enough for any session to pick it up exactly where it stands.