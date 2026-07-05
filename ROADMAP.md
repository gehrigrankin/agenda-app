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
   backlinks footer, and image upload/embed. Caveats: note-link titles are
   snapshots taken at insert time (renames don't propagate to existing chips),
   and image uploads use the local-disk storage driver (see "MVP status"
   below).
6. ✅ **Trash** — soft-delete + `/app/trash` view with restore and permanent
   purge.
7. ✅ **Global search + `Ctrl+K` palette** — title search over notes + bubbles,
   jump-to-result, quick-create from the query.
8. ✅ **Daily agenda / "daily jot"** — auto-created dated daily note on the
   Today page, recent dailies strip, tasks due today surfaced at top.

## MVP status: complete

All MVP items above are ✅. Two known production caveats to keep in mind:

- **Image uploads need the S3 adapter on serverless hosting** — the local
  storage driver writes to `public/uploads`, which is ephemeral on Vercel-style
  hosts. Ship the S3 adapter (see "Storage" below) before relying on images in
  production.
- **Note-link titles are snapshots** — a `[[note-link]]` chip caches the target
  note's title at insert time; renaming the target doesn't update existing
  chips (the link itself stays correct).

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
