# Roadmap

The MVP (see `README.md`) is deliberately tight. Everything below is captured so
nothing is lost — but it is **explicitly out of scope** until the MVP works
end-to-end. Grouped by theme, roughly in the order it might be tackled.

## MVP (in progress — the only thing being built now)

1. **Auth + app shell** — Clerk sign-in, protected `/app`, sidebar + content. ✅ foundation
2. **Note CRUD + autosave** — create/open/edit/soft-delete; debounced autosave of Lexical JSON.
3. **Folder/tag tree** — sidebar tree from the `tags` hierarchy; assign notes to tags; pinned folders on top; toggle immediate-only vs. include child folders.
4. **Lexical editor (extend foundation)** — task nodes backed by the `tasks` table, note-links, images. (Headings, lists, checklists, code, links, undo/redo already in the foundation.) Completed tasks stay visible + struck-through in place.
5. **Global search + `Ctrl+K` palette** — jump to note by title, quick-create, basic full-text search.
6. **Trash** — deleted notes live in Trash for X days; restore + permanent purge.
7. **Daily agenda / "daily jot"** — auto/one-click dated daily note; tasks due today surfaced at top.

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
