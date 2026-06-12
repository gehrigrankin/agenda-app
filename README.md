# Notarium

A life tracker. Dump everything in your brain into this app so you don't have to think about it anymore — while keeping it structured and clean.

> *Analogy*: VS Code → Cursor :: Amplenote → **Notarium**

## What's here now (MVP foundation)

- **Sections** for different parts of life (Money, Health, Learning, Personal — fully customizable: create, rename, delete)
- **Folders and subfolders** inside sections for deeper organization
- **Notes with rich text** editing powered by Lexical: headings, bold/italic/underline/strikethrough, inline code, bullet/numbered lists, quotes, links, and markdown shortcuts (`# `, `- `, `**bold**`, etc.)
- **Search** across note titles and content
- **Auto-save** — edits persist as you type (currently to `localStorage`)

Data is stored client-side in `localStorage` for now. All reads/writes go through a single reducer in `src/lib/store.tsx`, so swapping in the real backend (Neon Postgres via API routes) is an isolated change.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js (App Router) + React + TypeScript |
| Styling | Tailwind CSS v4 |
| Icons | lucide-react |
| Rich text | Lexical |
| Database (planned) | Neon (Postgres) |
| Auth (planned) | Clerk |
| File storage (planned) | S3 or Firebase Storage |
| Hosting | Vercel |

## Roadmap

- [x] App shell: sections → folders → notes hierarchy
- [x] Lexical rich-text editor with toolbar + markdown shortcuts
- [x] Search
- [ ] Neon Postgres persistence (API routes + drizzle/prisma)
- [ ] Clerk authentication
- [ ] Cross-device sync (WebSocket / realtime)
- [ ] Attachments: images, files, links (S3)
- [ ] Import/export notes
- [ ] AI assistant that answers questions from your notes
- [ ] AI note manipulation ("move this selected text to a new note named…", "create tasks from this bullet list")
- [ ] Collaboration & sharing
- [ ] Google Calendar / email integrations
- [ ] Mobile (React Native) and desktop (Electron)

## Project structure

```
src/
  app/              # Next.js App Router pages
  components/
    AppShell.tsx    # Top-level layout: sidebar + editor pane
    Sidebar.tsx     # Sections/folders/notes tree, search, create/rename/delete
    NoteHeader.tsx  # Breadcrumb + title editing
    editor/         # Lexical editor + toolbar
  lib/
    types.ts        # Section / Folder / Note data model
    store.tsx       # State + persistence (localStorage for now)
```

See `.env.example` for the environment variables the planned Neon/Clerk integrations will use.
