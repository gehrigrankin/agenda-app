"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { Copy, FileText, PanelRight, Pencil, Trash2 } from "lucide-react";

import {
  duplicateNoteAction,
  renameNoteAction,
  trashNoteAction,
} from "@/app/app/actions";
import { useNoteDock } from "@/components/notes/NoteDockProvider";

/**
 * Right-click action menu for a note row: open / open in a floating dock tab /
 * rename (inline) / duplicate / delete. Fixed-position, clamped to the
 * viewport once its real size is known. Follows the app's popover pattern
 * (see CreateMenu in NavRail.tsx): a full-screen backdrop button closes it,
 * Escape closes it. The list is server-rendered from props, so mutations
 * `router.refresh()` to pick up the change.
 */
export function NoteContextMenu({
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
