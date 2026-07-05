# Roadmap

The MVP (see `README.md`) is deliberately tight. Everything below is captured so
nothing is lost — but it is **explicitly out of scope** until the MVP works
end-to-end. Grouped by theme, roughly in the order it might be tackled.

## MVP (in progress — the only thing being built now)

Status legend: ✅ done · 🟡 partial · ⬜ not started

1. ✅ **Auth + app shell** — Clerk sign-in, protected `/app`, sidebar + content.
2. ✅ **Note CRUD + autosave** — create/open/edit/soft-delete; debounced autosave
   of Lexical JSON (flushes on unmount/tab close; skips no-change saves).
3. ✅ **Bubble map** *(unplanned addition)* — infinite pan/zoom canvas of nested
   bubbles with semantic zoom; notes live inside bubbles; bubbles can opt in as
   sidebar folders. Grew outside the original plan but shipped first.
4. 🟡 **Folder/tag tree** — the `tags` hierarchy from the schema has no UI.
   Bubbles-as-folders now covers part of this (hierarchical sidebar folders
   holding notes). **Decide before building:** commit to bubbles as THE
   organizing structure (and drop tags-as-folders), or build the tag tree as
   originally specced. Don't build both.
5. 🟡 **Lexical editor (extend foundation)** — headings, lists, checklists,
   code, links, markdown shortcuts, slash commands, floating toolbar all work.
   Still missing: task nodes backed by the `tasks` table, note-links, images.
   Completed tasks stay visible + struck-through in place.
6. 🟡 **Trash** — soft-delete works (notes keep `deletedAt` and disappear from
   lists), but there is no Trash view: no restore, no permanent purge, and the
   sidebar "Trash" link is a dead placeholder.
7. ⬜ **Global search + `Ctrl+K` palette** — jump to note by title,
   quick-create, basic full-text search. Sidebar "Search" link + ⌘K hint are
   dead placeholders.
8. ⬜ **Daily agenda / "daily jot"** — auto/one-click dated daily note; tasks
   due today surfaced at top. Schema is ready (`dailyDate` + partial unique
   index); the `/app` "Today" page is still a placeholder.

## Next up (recommended order)

1. **Trash view** (finish #6) — smallest effort, biggest safety win: today a
   trashed note is unrecoverable from the UI even though the row still exists.
   Needs `listTrashedNotes` / `restoreNote` / `purgeNote` repo fns, a
   `/app/trash` page, and wiring the dead sidebar link.
2. **Daily jot** (#8) — it's the app's namesake and the schema is done. A
   "today" note auto-created on first visit to `/app`, plus a date header and
   recent dailies. Turns the placeholder Today page into the daily driver.
3. **Search + ⌘K palette** (#7) — title `ILIKE` search over notes + bubbles
   first (cheap), palette with jump/quick-create; full-text (Postgres
   `tsvector`) can come later.
4. **Task nodes in the editor** (#5, the hard part) — custom Lexical node
   synced to the `tasks` table via `note_tasks.blockKey`. Biggest scope and
   risk in the MVP; do it after the quick wins above.
5. **Folders decision** (#4) — pick bubbles-as-folders or the tag tree, then
   do the chosen one. If bubbles win, tags can be repurposed later as flat
   labels for search/filtering.
6. **Note-links, then images** (rest of #5) — links are pure Lexical work;
   images need the real storage adapter first (see Storage below).

## Editor / content (post-MVP)

- Templating system + template marketplace.
- Nested tabs inside notes.
- Advanced database-style tables (formulas, sorting, saved views).
- Kanban board view.
- Graph / connection view of note links.
- Multi-cursor and the full advanced hotkey set (MVP ships only basic formatting hotkeys).
- Note version history ("git blame" for notes).

## AI

- Auto-format and cleanup.
- Daily plan builder.
- Autotagging.
- Q&A over notes (RAG).
- Type-ahead / inline completion.
- Voice-to-note.
- General AI note manipulation.

> When these land, default to the latest Claude models (e.g. Opus 4.x) via the
> Anthropic API. Keep AI code behind a clear service boundary (e.g.
> `src/server/ai/*`) so it stays optional.

## Dashboard / widgets

- Dashboard + widget system.
- Widget marketplace.
- Bank / transaction widgets.

## Integrations

- Calendar integrations (Google / Apple, subscribed calendars).
- Email-to-note.
- Web clipper.
- Scan-document, screenshot-to-task.
- Apple Reminders sync.

## Platforms

- Mobile / iPad (React Native).
- Desktop (Electron).
- Phone & lock-screen widgets.
- Siri commands.

## Sync / data / collaboration

- Real-time cross-device sync.
- Offline mode.
- Note encryption.
- Collaboration / sharing.
- Multi-workspace.
- Contacts system.

## Storage

- Real S3 storage adapter (interface already stubbed in `src/lib/storage`).
