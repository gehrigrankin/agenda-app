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
4. ✅ **Folders** — **decided: bubbles-as-folders are THE folder system; tags
   reserved for future flat labels** (search/filter chips, no hierarchy UI).
   Bubbles opt in via `isFolder` and surface as hierarchical sidebar folders;
   notes (daily jots included) move into/out of folders via the folder menu in
   the editor header. The schema's `tags` tree keeps its data model but gets
   no folder-tree UI.
5. ✅ **Lexical editor (extend foundation)** — headings, lists, checklists,
   code, links, markdown shortcuts, slash commands, floating toolbar, task
   nodes backed by the `tasks` table (completed tasks stay visible +
   struck-through in place), `[[note-link]]` chips with a "Linked from"
   backlinks footer, and image upload/embed. (Two original caveats since
   resolved: note-link title snapshots now refresh on editor open, and an S3
   storage driver exists — see "MVP status" below.)
6. ✅ **Trash** — soft-delete + `/app/trash` view with restore and permanent
   purge.
7. ✅ **Global search + `Ctrl+K` palette** — title search over notes + bubbles,
   jump-to-result, quick-create from the query.
8. ✅ **Daily agenda / "daily jot"** — auto-created dated daily note on the
   Today page, recent dailies strip, tasks due today surfaced at top.

## MVP status: complete

All MVP items above are ✅. Two known production caveats to keep in mind:

- **Image uploads on serverless hosting** — the local storage driver writes to
  `public/uploads`, which is ephemeral on Vercel-style hosts. The S3 adapter
  now exists (see "Storage" below): set `STORAGE_DRIVER=s3` in production.
  Until then the db driver (bytes in Postgres) is the default when a database
  is configured — fine at personal scale.
- **Note-link titles refresh on open** — a `[[note-link]]` chip caches the
  target note's title at insert time; `NoteLinkTitleSyncPlugin` refreshes stale
  snapshots whenever an editor containing them opens (and autosave persists
  the fix). A chip in a note that never gets opened again can still show an
  old title until then.

Everything else below is post-MVP, grouped by theme.

## Editor / content (post-MVP)

- Templating system + template marketplace.
- Nested tabs inside notes.
- Advanced database-style tables (formulas, sorting, saved views).
- Kanban board view.
- Graph / connection view of note links.
- Multi-cursor and the full advanced hotkey set (MVP ships only basic formatting hotkeys).
- Note version history ("git blame" for notes).

## AI

Shipped (July 2026) — all behind `src/server/ai/*` (claude-opus-4-8,
structured outputs), degrading gracefully without `ANTHROPIC_API_KEY`:

- ✅ **Ask your notes** — ⌘K second gear: type a question, get an answer built
  only from your notes with tappable verbatim-quote sources.
- ✅ **Ambient recall** — margin cards in the daily editor surfacing related
  past notes while you pause (lexical ranking, no model calls).
- ✅ **Voice capture** — mic button on today's note: record, live-transcribe
  (Web Speech API), Claude extracts tasks/reminders/note-link ideas; nothing
  committed until "Keep all"; raw audio stored via the storage adapter.
- ✅ **Threads** — auto-assembled chronological topic threads across notes
  (`/app/threads`), with promote-to-note and dismiss.
- ✅ **Week in review** — drafted retrospective card on Sunday's daily note,
  insertable into the note, day references linked.
- ✅ **Note automations** — plain-language rules (`/app/automations`) run
  after a quiet period of editing; every action recorded with undo.
- ✅ **Meeting mode** — ICS-subscription calendar (settings row) offers a
  scaffold in today's note: attendees, open items from the last meeting with
  the same title, `@name ` lines become action items.

Still open:

- Auto-format and cleanup.
- Autotagging.
- Type-ahead / inline completion.
- Semantic retrieval (embeddings) if the lexical `text_content` ranking stops
  being enough at scale.
- General AI note manipulation.

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

- ✅ Real S3 storage adapter (`src/lib/storage/s3.ts`; `STORAGE_DRIVER=s3` +
  `S3_*` env vars, with optional `S3_PUBLIC_BASE_URL`/`S3_ENDPOINT` for
  CDN-fronted or S3-compatible stores).
