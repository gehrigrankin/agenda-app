"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  FolderPlus,
  FolderTree as FolderTreeIcon,
  History,
  Loader2,
  Pin,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
  X,
} from "lucide-react";

import { createNoteAction, moveNoteToBubbleAction } from "@/app/app/actions";
import {
  createBoardAction,
  createBubbleNoteAction,
  createSubfolderAction,
  deleteFolderToTrashAction,
  moveFolderAction,
  renameBubbleAction,
} from "@/app/app/bubbles/actions";
import { OPEN_SEARCH_EVENT } from "@/components/search/openSearch";
import type { FolderNode } from "@/lib/folderTree";
import {
  FolderTree,
  NOTE_DRAG_TYPE,
  type FolderOps,
  type TreeNoteRow,
} from "./FolderTree";
import { NoteContextMenu } from "./NoteContextMenu";

/**
 * Notes route shell across the three breakpoints of the folder-system design
 * (Turns 17d, 19b, 20a/20b):
 *
 * - <md (phone): the sectioned tree IS the Notes page — Inbox + folders with
 *   note rows inline, and Trash/Settings living here instead of nav slots.
 *   Opening a note swaps the pane for the full-screen detail with a back bar.
 * - md–xl (tablet): two panes (folder-scoped list + note). The folder tree
 *   opens as a floating flyout matching the rail's material.
 * - xl+ (desktop): three panes — docked folders-only tree, the selected
 *   folder's note list, and the note.
 *
 * Folder selection travels in the `?f=` query param (absent = Inbox, the
 * automatic home of unfiled notes), so it survives opening notes.
 */

export interface ShellDaily {
  id: string;
  title: string;
  updatedAt: string; // ISO
}

export interface ShellNote {
  id: string;
  title: string;
  preview: string;
  updatedAt: string; // ISO
  bubbleId: string | null;
}

/** "2:15 PM" if updated today (client-local), else "Jul 3". */
function formatWhen(iso: string, now: Date): string {
  const d = new Date(iso);
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function findWithParent(
  tree: FolderNode[],
  id: string | null,
): { node: FolderNode; parent: FolderNode | null } | null {
  if (!id) return null;
  const stack: { node: FolderNode; parent: FolderNode | null }[] = tree.map(
    (node) => ({ node, parent: null }),
  );
  while (stack.length) {
    const entry = stack.pop()!;
    if (entry.node.id === id) return entry;
    for (const child of entry.node.children) {
      stack.push({ node: child, parent: entry.node });
    }
  }
  return null;
}

export function NotesShell({
  daily,
  inboxNotes,
  tree,
  folderNotes,
  recentNotes,
  children,
}: {
  daily: ShellDaily | null;
  inboxNotes: ShellNote[];
  tree: FolderNode[];
  folderNotes: ShellNote[];
  /** Most recently opened live notes, for the list pane's bottom section. */
  recentNotes: { id: string; title: string; openedAt: string }[];
  children: React.ReactNode;
}) {
  const params = useParams();
  const activeId = typeof params.id === "string" ? params.id : null;
  const searchParams = useSearchParams();
  const router = useRouter();

  const folderIds = useMemo(() => {
    const ids = new Set<string>();
    const walk = (nodes: FolderNode[]) => {
      for (const n of nodes) {
        ids.add(n.id);
        walk(n.children);
      }
    };
    walk(tree);
    return ids;
  }, [tree]);

  const rawFolder = searchParams.get("f");
  const selectedId = rawFolder && folderIds.has(rawFolder) ? rawFolder : null;
  const selected = useMemo(
    () => findWithParent(tree, selectedId),
    [tree, selectedId],
  );

  const notesByFolder = useMemo(() => {
    const map = new Map<string, ShellNote[]>();
    for (const note of folderNotes) {
      if (!note.bubbleId) continue;
      const list = map.get(note.bubbleId);
      if (list) list.push(note);
      else map.set(note.bubbleId, [note]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    return map;
  }, [folderNotes]);

  const inboxCount = inboxNotes.length;
  const listNotes = selectedId
    ? (notesByFolder.get(selectedId) ?? [])
    : inboxNotes;

  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const [menu, setMenu] = useState<{
    id: string;
    title: string;
    x: number;
    y: number;
  } | null>(null);
  const [isCreating, startCreate] = useTransition();

  // Time labels are client-local; render them after mount so SSR markup stays
  // deterministic (the server's timezone would otherwise leak in).
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
  }, []);

  const folderQuery = selectedId ? `?f=${selectedId}` : "";

  const selectFolder = (id: string | null) => {
    const query = id ? `?f=${id}` : "";
    router.push(
      activeId ? `/app/notes/${activeId}${query}` : `/app/notes${query}`,
    );
    setFlyoutOpen(false);
  };

  // Folder management for the tree. Delete is the safe variant (subtree
  // notes go to Trash, not the void); if the selection pointed anywhere into
  // a deleted subtree, the ?f guard above resolves it back to Inbox after
  // the refresh. All four just round-trip the server and refresh.
  const folderOps = {
    onDelete: (id: string) => {
      void deleteFolderToTrashAction(id)
        .then(() => {
          if (selectedId === id) selectFolder(null);
          router.refresh();
        })
        .catch((err) => console.error("[notes] delete folder failed:", err));
    },
    onRename: (id: string, title: string) => {
      void renameBubbleAction(id, title)
        .then(() => router.refresh())
        .catch((err) => console.error("[notes] rename folder failed:", err));
    },
    onCreateChild: (parentId: string, title: string) => {
      void createSubfolderAction(parentId, title)
        .then(() => router.refresh())
        .catch((err) => console.error("[notes] create subfolder failed:", err));
    },
    onMove: (id: string, newParentId: string | null) => {
      void moveFolderAction(id, newParentId)
        .then(() => router.refresh())
        .catch((err) => console.error("[notes] move folder failed:", err));
    },
    // A note dragged from the list pane onto a folder row (or the Inbox row,
    // which unfiles it).
    onFileNote: (noteId: string, folderId: string | null) => {
      void moveNoteToBubbleAction(noteId, folderId)
        .then(() => router.refresh())
        .catch((err) => console.error("[notes] file note failed:", err));
    },
  };

  const createNoteHere = () => {
    startCreate(async () => {
      try {
        if (!selectedId) {
          await createNoteAction(); // redirects to the new note
          return;
        }
        const id = await createBubbleNoteAction(selectedId, "Untitled");
        router.push(`/app/notes/${id}?f=${selectedId}`);
        router.refresh();
      } catch (err) {
        console.error("[notes] create failed:", err);
      }
    });
  };

  const inboxTreeNotes: TreeNoteRow[] = inboxNotes.map((n) => ({
    id: n.id,
    title: n.title,
  }));

  const listTitle = selected ? selected.node.title : "Inbox";
  const listCrumb = selected?.parent?.title ?? null;

  return (
    <>
      {/* ── Desktop (xl+): docked folders-only tree (Turn 20a) ── */}
      <aside className="hidden w-[15.5rem] flex-none flex-col border-r border-white/7 bg-white/2 xl:flex">
        <div className="flex flex-none items-center px-4 pb-1 pt-3.5">
          <span className="flex-1 text-[0.65625rem] font-medium uppercase tracking-[0.14em] text-ink-600">
            Folders
          </span>
          <NewBoardButton onCreated={(id) => selectFolder(id)} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <FolderTree
            tree={tree}
            inboxCount={inboxCount}
            variant="pane"
            selectedId={selectedId}
            onSelect={selectFolder}
            ops={folderOps}
          />
        </div>
      </aside>

      {/* ── List pane (md+) / sectioned-tree page (<md) ── */}
      <div
        className={`w-full flex-none flex-col overflow-hidden md:flex md:w-[18.75rem] md:border-r md:border-white/7 ${
          activeId ? "hidden" : "flex"
        }`}
      >
        {/* Phone: the Notes tab is the sectioned tree (Turns 17d/19b). */}
        <div className="flex min-h-0 flex-1 flex-col md:hidden">
          <div className="flex flex-none items-center px-4 pb-3 pt-3.5">
            <span className="text-2xl font-semibold text-ink-100">Notes</span>
            <button
              type="button"
              aria-label="New note"
              disabled={isCreating}
              onClick={createNoteHere}
              className="ml-auto flex h-11 w-11 items-center justify-center rounded-full border border-white/8 bg-white/5 disabled:opacity-60"
            >
              {isCreating ? (
                <Loader2 className="h-5 w-5 animate-spin text-ink-300" />
              ) : (
                <Plus className="h-5 w-5 text-ink-300" />
              )}
            </button>
          </div>
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT))
            }
            className="mx-4 mb-1.5 flex h-10 flex-none items-center gap-2.5 rounded-[0.6875rem] border border-white/7 bg-white/4 px-3.5 text-left"
          >
            <Search className="h-[0.9375rem] w-[0.9375rem] text-ink-600" />
            <span className="text-[0.84375rem] text-ink-600">Search notes</span>
          </button>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {daily && (
              <Link
                href={`/app/notes/${daily.id}`}
                className="mt-2 block rounded-[0.5625rem] border border-sage/35 bg-sage/10 p-3"
              >
                <span className="flex items-center gap-2">
                  <Sun className="h-3.5 w-3.5 flex-none text-sage" />
                  <span className="min-w-0 flex-1 truncate text-[0.84375rem] font-semibold text-ink-100">
                    {daily.title}
                  </span>
                  <Pin className="h-3 w-3 flex-none text-sage" />
                </span>
                <span className="mt-1 block text-xs text-[#9CB3A4]">
                  Daily note
                  {now ? ` · last written ${formatWhen(daily.updatedAt, now)}` : ""}
                </span>
              </Link>
            )}

            <FolderTree
              tree={tree}
              inboxCount={inboxCount}
              variant="phone"
              inboxNotes={inboxTreeNotes}
              notesByFolder={notesByFolder}
              noteHref={(id) => `/app/notes/${id}`}
              ops={folderOps}
            />

            {/* Trash + Settings live here on phone, not in the tab bar (17d). */}
            <div className="mt-4 overflow-hidden rounded-2xl border border-white/7 bg-white/2">
              <Link
                href="/app/trash"
                className="flex h-12 items-center gap-3 px-3.5"
              >
                <Trash2 className="h-[1.0625rem] w-[1.0625rem] text-ink-400" />
                <span className="flex-1 text-[0.875rem] font-medium text-ink-200">
                  Trash
                </span>
                <ChevronRight className="h-4 w-4 text-ink-600" />
              </Link>
              <Link
                href="/app/settings"
                className="flex h-12 items-center gap-3 border-t border-white/6 px-3.5"
              >
                <Settings className="h-[1.0625rem] w-[1.0625rem] text-ink-400" />
                <span className="flex-1 text-[0.875rem] font-medium text-ink-200">
                  Settings
                </span>
                <ChevronRight className="h-4 w-4 text-ink-600" />
              </Link>
            </div>
          </div>
        </div>

        {/* md+: the selected folder's note list (Turn 20a middle pane). */}
        <div className="hidden min-h-0 flex-1 flex-col md:flex">
          <div className="flex flex-none flex-col gap-0.5 px-3.5 pb-2.5 pt-4">
            {listCrumb && (
              <span className="text-[0.6875rem] text-ink-600">
                {listCrumb} /
              </span>
            )}
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[1.125rem] font-semibold text-ink-100">
                {listTitle}
              </span>
              {/* Tablet (md–xl): the tree opens as a flyout off this button. */}
              <button
                type="button"
                aria-label="Folders"
                onClick={() => setFlyoutOpen(true)}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/8 bg-white/5 hover:bg-white/10 xl:hidden"
              >
                <FolderTreeIcon className="h-3.5 w-3.5 text-ink-300" />
              </button>
              <button
                type="button"
                aria-label="New note"
                disabled={isCreating}
                onClick={createNoteHere}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/8 bg-white/5 hover:bg-white/10 disabled:opacity-60"
              >
                {isCreating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-300" />
                ) : (
                  <Plus className="h-3.5 w-3.5 text-ink-300" />
                )}
              </button>
            </div>
            <span className="text-[0.6875rem] text-ink-600">
              {listNotes.length} {listNotes.length === 1 ? "note" : "notes"}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {!selectedId && daily && (
              <Link
                href={`/app/notes/${daily.id}${folderQuery}`}
                className={`mx-2 mb-1.5 block rounded-[0.5625rem] border p-2.5 ${
                  activeId === daily.id
                    ? "border-sage/50 bg-sage/15"
                    : "border-sage/35 bg-sage/10 hover:bg-sage/15"
                }`}
              >
                <span className="flex items-center gap-2">
                  <Sun className="h-[0.8125rem] w-[0.8125rem] flex-none text-sage" />
                  <span className="min-w-0 flex-1 truncate text-[0.78125rem] font-semibold leading-[1.3] text-ink-100">
                    {daily.title}
                  </span>
                  <Pin className="h-[0.6875rem] w-[0.6875rem] flex-none text-sage" />
                </span>
                <span className="mt-1 block text-[0.6875rem] leading-normal text-[#9CB3A4]">
                  Daily note
                  {now ? ` · last written ${formatWhen(daily.updatedAt, now)}` : ""}
                </span>
              </Link>
            )}

            {listNotes.length === 0 ? (
              <p className="px-3.5 py-4 text-[0.75rem] leading-relaxed text-ink-600">
                {selectedId
                  ? "No notes in this folder yet — create one with the + above."
                  : "No notes yet — create one with the + above."}
              </p>
            ) : (
              listNotes.map((n) => (
                <Link
                  key={n.id}
                  href={`/app/notes/${n.id}${folderQuery}`}
                  draggable
                  onDragStart={(e) => {
                    // Filing gesture: drop this row on a folder in the tree.
                    e.dataTransfer.setData(NOTE_DRAG_TYPE, n.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({
                      id: n.id,
                      title: n.title,
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                  className={`flex flex-col gap-1 border-b border-white/5 px-3.5 py-3 ${
                    activeId === n.id
                      ? "bg-sage/8 shadow-[inset_2px_0_0_var(--color-sage)]"
                      : "hover:bg-white/3"
                  }`}
                >
                  <span className="flex items-baseline gap-2">
                    <span
                      className={`min-w-0 flex-1 truncate text-[0.8125rem] font-medium leading-[1.3] ${
                        activeId === n.id ? "text-ink-100" : "text-ink-200"
                      }`}
                    >
                      {n.title || "Untitled"}
                    </span>
                    <span className="flex-none text-[0.625rem] font-medium text-ink-600">
                      {now ? formatWhen(n.updatedAt, now) : ""}
                    </span>
                  </span>
                  <span className="truncate text-[0.6875rem] leading-normal text-[#7B837F]">
                    {n.preview || "Empty note"}
                  </span>
                </Link>
              ))
            )}

            {/* Recently opened — always at the bottom; earns its keep most
                when the list above is empty. Skips notes already visible. */}
            {(() => {
              const visible = new Set(listNotes.map((n) => n.id));
              if (daily) visible.add(daily.id);
              if (activeId) visible.add(activeId);
              const recents = recentNotes.filter((r) => !visible.has(r.id));
              if (recents.length === 0) return null;
              return (
                <div className="mt-2 border-t border-white/5 pb-3 pt-3">
                  <div className="flex items-center gap-1.5 px-3.5 pb-1">
                    <History className="h-3 w-3 flex-none text-ink-600" />
                    <span className="text-[0.625rem] font-medium uppercase tracking-[0.14em] text-ink-600">
                      Recently opened
                    </span>
                  </div>
                  {recents.map((r) => (
                    <Link
                      key={r.id}
                      href={`/app/notes/${r.id}${folderQuery}`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(NOTE_DRAG_TYPE, r.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      className="flex items-baseline gap-2 px-3.5 py-1.5 hover:bg-white/3"
                    >
                      <span className="min-w-0 flex-1 truncate text-[0.78125rem] text-ink-300">
                        {r.title || "Untitled"}
                      </span>
                      <span className="flex-none text-[0.625rem] text-ink-600">
                        {now ? formatWhen(r.openedAt, now) : ""}
                      </span>
                    </Link>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* ── Detail pane ── */}
      <div
        className={`min-w-0 flex-1 flex-col border-l border-white/7 md:flex ${
          activeId ? "flex" : "hidden"
        }`}
      >
        {/* Phone back bar (Turn 17c): full-screen editor, one way out. */}
        {activeId && (
          <div className="flex h-11 flex-none items-center border-b border-white/7 px-1 md:hidden">
            <Link
              href={`/app/notes${folderQuery}`}
              className="flex h-11 items-center gap-0.5 px-2 text-[0.9375rem] font-medium text-sage"
            >
              <ChevronLeft className="h-5 w-5" />
              Notes
            </Link>
          </div>
        )}
        <div className="min-h-0 flex-1">{children}</div>
      </div>

      {/* ── Tablet flyout (Turn 20b) ── */}
      {flyoutOpen && (
        <FoldersFlyout
          tree={tree}
          inboxCount={inboxCount}
          selectedId={selectedId}
          onSelect={selectFolder}
          ops={folderOps}
          onClose={() => setFlyoutOpen(false)}
        />
      )}

      {menu && (
        <NoteContextMenu
          id={menu.id}
          title={menu.title}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

/**
 * Floating folder tree for tablet widths, anchored beside the nav rail and
 * matching its glassy material. Dismisses on tap-away, Escape, or a pick.
 */
function FoldersFlyout({
  tree,
  inboxCount,
  selectedId,
  onSelect,
  ops,
  onClose,
}: {
  tree: FolderNode[];
  inboxCount: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  ops: FolderOps;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <button
        type="button"
        aria-label="Close folders"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default bg-black/35"
      />
      <div className="fixed bottom-5 left-[5.25rem] top-[4.5rem] z-50 flex w-[18.75rem] flex-col overflow-hidden rounded-2xl border border-white/10 bg-bar/95 shadow-[0_16px_40px_rgba(0,0,0,0.55)] backdrop-blur-[10px]">
        <div className="flex flex-none items-center gap-2.5 px-4 pb-1 pt-3.5">
          <span className="flex-1 text-[1rem] font-semibold text-ink-100">
            Folders
          </span>
          <NewBoardButton onCreated={(id) => onSelect(id)} />
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-m-1 p-1 text-ink-400 hover:text-ink-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          <FolderTree
            tree={tree}
            inboxCount={inboxCount}
            variant="pane"
            selectedId={selectedId}
            onSelect={onSelect}
            ops={ops}
          />
        </div>
      </div>
    </>
  );
}

/**
 * The folder-plus button on tree headers: expands to an inline name prompt,
 * creates a top-level board (folder bubble) and selects it.
 */
function NewBoardButton({ onCreated }: { onCreated: (id: string) => void }) {
  const router = useRouter();
  const [prompting, setPrompting] = useState(false);
  const [draft, setDraft] = useState("");
  const [isCreating, startCreate] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (prompting) inputRef.current?.focus();
  }, [prompting]);

  const submit = () => {
    const title = draft.trim();
    if (!title || isCreating) return;
    startCreate(async () => {
      try {
        const id = await createBoardAction(title);
        setPrompting(false);
        setDraft("");
        router.refresh();
        onCreated(id);
      } catch (err) {
        console.error("[notes] new folder failed:", err);
      }
    });
  };

  if (prompting) {
    return (
      <input
        ref={inputRef}
        value={draft}
        disabled={isCreating}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") {
            setPrompting(false);
            setDraft("");
          }
        }}
        onBlur={() => {
          if (!draft.trim()) setPrompting(false);
        }}
        placeholder="Folder name…"
        className="w-32 border-b border-sage/50 bg-transparent px-0.5 py-0.5 text-xs text-ink-100 outline-none placeholder:text-ink-600 disabled:opacity-60"
      />
    );
  }

  return (
    <button
      type="button"
      aria-label="New folder"
      title="New folder"
      onClick={() => setPrompting(true)}
      className="-m-1 p-1 text-ink-500 hover:text-ink-200"
    >
      <FolderPlus className="h-4 w-4" />
    </button>
  );
}
