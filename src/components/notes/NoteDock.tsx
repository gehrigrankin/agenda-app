"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, FileText, Loader2, Minus, X } from "lucide-react";

import { getNoteAction, type NoteDetailResult } from "@/app/app/actions";
import { NoteEditor } from "@/components/notes/NoteEditor";

/**
 * Multi-note dock (home view): notes pinned from the quick view live as tabs
 * anchored to the bottom-right — LinkedIn-messaging style. Each tab pops a
 * floating editor window above it; several can be open side by side. Desktop
 * only (floating windows don't fit phones).
 */

export interface DockNote {
  id: string;
  title: string;
}

export function NoteDock({
  notes,
  expandedIds,
  onToggle,
  onClose,
}: {
  notes: DockNote[];
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onClose: (id: string) => void;
}) {
  if (notes.length === 0) return null;
  return (
    <div className="pointer-events-none absolute bottom-0 right-4 z-40 hidden items-end gap-2 md:flex">
      {notes.map((n) => (
        <DockItem
          key={n.id}
          note={n}
          expanded={expandedIds.has(n.id)}
          onToggle={() => onToggle(n.id)}
          onClose={() => onClose(n.id)}
        />
      ))}
    </div>
  );
}

function DockItem({
  note,
  expanded,
  onToggle,
  onClose,
}: {
  note: DockNote;
  expanded: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  return (
    <div className="pointer-events-auto flex w-[19rem] flex-col justify-end">
      {expanded && <DockWindow noteId={note.id} onTrashed={onClose} />}
      {/* The tab: title + close, always visible at the bottom edge. */}
      <div
        className={`flex items-center gap-2 border border-white/10 bg-bar px-3 py-2 shadow-[0_-6px_24px_rgba(0,0,0,0.4)] ${
          expanded
            ? "rounded-b-none border-t-0"
            : "rounded-t-xl"
        }`}
      >
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={expanded}
        >
          <FileText className="h-3.5 w-3.5 flex-none text-steel" />
          <span className="min-w-0 flex-1 truncate text-[0.78125rem] font-medium text-ink-200">
            {note.title || "Untitled"}
          </span>
          <Minus
            className={`h-3 w-3 flex-none text-ink-600 ${expanded ? "" : "rotate-180"}`}
            aria-hidden
          />
        </button>
        <button
          type="button"
          aria-label={`Close ${note.title || "note"}`}
          onClick={onClose}
          className="flex h-5 w-5 flex-none items-center justify-center rounded-md hover:bg-white/8"
        >
          <X className="h-3 w-3 text-ink-500" />
        </button>
      </div>
    </div>
  );
}

function DockWindow({
  noteId,
  onTrashed,
}: {
  noteId: string;
  onTrashed: () => void;
}) {
  const router = useRouter();
  // undefined = loading, null = unavailable.
  const [note, setNote] = useState<NoteDetailResult | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;
    getNoteAction(noteId)
      .then((n) => {
        if (!cancelled) setNote(n);
      })
      .catch((err) => {
        console.error("[dock] load failed:", err);
        if (!cancelled) setNote(null);
      });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  return (
    <div className="animate-pop-in flex h-[26rem] max-h-[70vh] flex-col overflow-hidden rounded-t-xl border border-b-0 border-white/10 bg-[#1B1E21] shadow-[0_-12px_40px_rgba(0,0,0,0.55)]">
      <div className="flex flex-none items-center justify-end border-b border-white/7 bg-steel/5 px-2 py-1.5">
        <button
          type="button"
          aria-label="Open full note"
          title="Open full note"
          onClick={() => router.push(`/app/notes/${noteId}`)}
          className="flex h-[1.375rem] w-[1.375rem] items-center justify-center rounded-md hover:bg-white/6"
        >
          <ArrowUpRight className="h-3 w-3 text-ink-400" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {note === undefined ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-ink-600" />
          </div>
        ) : note === null ? (
          <div className="flex flex-1 items-center justify-center p-4 text-center">
            <p className="text-[0.78125rem] text-ink-500">
              This note isn&rsquo;t available.
            </p>
          </div>
        ) : (
          <NoteEditor
            key={note.id}
            noteId={note.id}
            initialTitle={note.title}
            initialContent={note.content}
            initialBubbleId={note.bubbleId}
            onTrashed={onTrashed}
          />
        )}
      </div>
    </div>
  );
}
