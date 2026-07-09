"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import {
  Copy,
  FileText,
  Loader2,
  PanelRight,
  Pencil,
  Pin,
  Plus,
  Sun,
  Trash2,
} from "lucide-react";

import {
  createNoteAction,
  duplicateNoteAction,
  renameNoteAction,
  trashNoteAction,
} from "@/app/app/actions";
import { useNoteDock } from "@/components/notes/NoteDockProvider";

/**
 * Notes list pane (design Turn 9a): the daily note pinned first as the
 * sage-tinted row, then standalone notes with time + one-line preview. On
 * mobile the pane hides once a note is open (the detail takes the screen).
 */

export interface DailyRowData {
  id: string;
  title: string;
  updatedAt: string; // ISO
}

export interface NoteRowData {
  id: string;
  title: string;
  preview: string;
  updatedAt: string; // ISO
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

/**
 * Detail container: on mobile it only shows once a note is selected (the list
 * pane and detail swap); on md+ both panes are always visible.
 */
export function NotesDetailPane({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const activeId = typeof params.id === "string" ? params.id : null;
  return (
    <div
      className={`min-w-0 flex-1 border-l border-white/7 md:block ${
        activeId ? "block" : "hidden"
      }`}
    >
      {children}
    </div>
  );
}

export function NotesListPane({
  daily,
  notes,
}: {
  daily: DailyRowData | null;
  notes: NoteRowData[];
}) {
  const params = useParams();
  const activeId = typeof params.id === "string" ? params.id : null;
  const [isCreating, startCreate] = useTransition();

  // Time labels are client-local; render them after mount so SSR markup stays
  // deterministic (the server's timezone would otherwise leak in).
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
  }, []);

  // Right-click context menu on a standard note row (not the pinned daily row).
  const [menu, setMenu] = useState<{
    id: string;
    title: string;
    x: number;
    y: number;
  } | null>(null);

  return (
    <div
      className={`w-full flex-none flex-col overflow-y-auto border-r border-white/7 p-2 md:flex md:w-[18.75rem] ${
        activeId ? "hidden" : "flex"
      }`}
    >
      <div className="flex flex-none items-center gap-2 px-2 pb-2 pt-1.5">
        <FileText className="h-3.5 w-3.5 text-steel" />
        <span className="text-[0.8125rem] font-semibold text-ink-100">Notes</span>
        <span className="text-[0.6875rem] text-ink-600">{notes.length}</span>
        <button
          type="button"
          aria-label="New note"
          disabled={isCreating}
          onClick={() => startCreate(() => createNoteAction())}
          className="ml-auto flex h-[1.375rem] w-[1.375rem] items-center justify-center rounded-md bg-white/6 hover:bg-white/10 disabled:opacity-60"
        >
          {isCreating ? (
            <Loader2 className="h-3 w-3 animate-spin text-ink-400" />
          ) : (
            <Plus className="h-3 w-3 text-ink-400" />
          )}
        </button>
      </div>

      {daily && (
        <>
          <Link
            href={`/app/notes/${daily.id}`}
            className={`block rounded-[0.5625rem] border p-2.5 ${
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
          <div className="mx-1.5 my-1.5 h-px flex-none bg-white/6" />
        </>
      )}

      {notes.length === 0 ? (
        <p className="px-2.5 py-4 text-[0.75rem] text-ink-600">
          No notes yet — create one with the + above.
        </p>
      ) : (
        notes.map((n) => (
          <Link
            key={n.id}
            href={`/app/notes/${n.id}`}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ id: n.id, title: n.title, x: e.clientX, y: e.clientY });
            }}
            className={`block rounded-[0.5rem] px-2.5 py-2.5 ${
              activeId === n.id ? "bg-white/6" : "hover:bg-white/4"
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[0.78125rem] font-medium leading-[1.3] text-ink-200">
                {n.title || "Untitled"}
              </span>
              <span className="flex-none text-[0.625rem] font-medium text-ink-600">
                {now ? formatWhen(n.updatedAt, now) : ""}
              </span>
            </span>
            <span className="mt-1 block truncate text-[0.6875rem] leading-normal text-[#7B837F]">
              {n.preview || "Empty note"}
            </span>
          </Link>
        ))
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
    </div>
  );
}

/**
 * Right-click action menu for a note row: open / open in a floating dock tab /
 * rename (inline) / duplicate / delete. Fixed-position, clamped to the
 * viewport once its real size is known. Follows the app's popover pattern
 * (see CreateMenu in NavRail.tsx): a full-screen backdrop button closes it,
 * Escape closes it. The list is server-rendered from props, so mutations
 * `router.refresh()` to pick up the change.
 */
function NoteContextMenu({
  id,
  title,
  x,
  y,
  onClose,
}: {
  id: string;
  title: string;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const dock = useNoteDock();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(title);
  const [, startAction] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (renaming) inputRef.current?.focus();
  }, [renaming]);

  // Menu dimensions are only known post-mount; clamp so it never runs off
  // the viewport near the pane's edges.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    const clampedX = Math.min(x, Math.max(margin, window.innerWidth - rect.width - margin));
    const clampedY = Math.min(y, Math.max(margin, window.innerHeight - rect.height - margin));
    setPos({ x: Math.max(margin, clampedX), y: Math.max(margin, clampedY) });
  }, [x, y, renaming]);

  const commitRename = () => {
    const next = draft.trim();
    onClose();
    if (!next || next === title) return;
    startAction(async () => {
      try {
        await renameNoteAction(id, next);
        router.refresh();
      } catch (err) {
        console.error("[notes] rename failed:", err);
      }
    });
  };

  const duplicate = () => {
    onClose();
    startAction(async () => {
      try {
        await duplicateNoteAction(id);
        router.refresh();
      } catch (err) {
        console.error("[notes] duplicate failed:", err);
      }
    });
  };

  const del = () => {
    onClose();
    // If the note being deleted is the one currently open in the detail
    // pane, refreshing in place would re-fetch a now-404ing route — navigate
    // back to the notes list instead.
    const isOpen = pathname === `/app/notes/${id}`;
    startAction(async () => {
      try {
        await trashNoteAction(id);
        if (isOpen) {
          router.push("/app/notes");
        } else {
          router.refresh();
        }
      } catch (err) {
        console.error("[notes] delete failed:", err);
      }
    });
  };

  const ITEM =
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-ink-200 hover:bg-white/6";

  return (
    <>
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default"
      />
      <div
        ref={menuRef}
        style={{ left: pos.x, top: pos.y }}
        className="fixed z-50 w-48 rounded-xl border border-white/10 bg-panel p-1.5 shadow-2xl"
      >
        {renaming ? (
          <div className="px-2 py-1.5">
            <p className="pb-1 text-[0.65625rem] font-medium uppercase tracking-wide text-ink-500">
              Rename
            </p>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
              }}
              placeholder="Untitled"
              className="w-full border-b border-sage/50 bg-transparent px-0.5 py-1 text-sm text-ink-100 outline-none placeholder:text-ink-600"
            />
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                onClose();
                router.push(`/app/notes/${id}`);
              }}
              className={ITEM}
            >
              <FileText className="h-3.5 w-3.5 text-sage" />
              Open
            </button>
            {dock && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  dock.open(id, title);
                }}
                className={ITEM}
              >
                <PanelRight className="h-3.5 w-3.5 text-sage" />
                Open in floating tab
              </button>
            )}
            <button type="button" onClick={() => setRenaming(true)} className={ITEM}>
              <Pencil className="h-3.5 w-3.5 text-sage" />
              Rename
            </button>
            <button type="button" onClick={duplicate} className={ITEM}>
              <Copy className="h-3.5 w-3.5 text-sage" />
              Duplicate
            </button>
            <div className="my-1 h-px bg-white/6" />
            <button
              type="button"
              onClick={del}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-red-400 hover:bg-red-500/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </>
        )}
      </div>
    </>
  );
}
