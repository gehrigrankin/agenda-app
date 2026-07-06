"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  ChevronRight,
  Loader2,
  PanelBottomOpen,
  ScanEye,
  X,
} from "lucide-react";

import { getNoteAction, type NoteDetailResult } from "@/app/app/actions";
import { NoteEditor } from "@/components/notes/NoteEditor";

/**
 * Floating quick view of a full note over the daily home (design Turn 10):
 * steel-glow panel, breadcrumb header, the REAL NoteEditor inside (autosave /
 * tasks / links all work), Esc or ✕ back to the day. No backdrop — the day
 * stays visible behind it.
 */

/** Close on Escape while mounted (house pattern, kept local per file). */
function useEscapeKey(onEscape: () => void) {
  const handlerRef = useRef(onEscape);
  handlerRef.current = onEscape;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handlerRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}

export function QuickViewOverlay({
  noteId,
  onClose,
  onPinToDock,
}: {
  noteId: string;
  onClose: () => void;
  /** Moves the note into the bottom dock (multi-note windows), if hosted. */
  onPinToDock?: (noteId: string, title: string) => void;
}) {
  const router = useRouter();
  // undefined = loading, null = unavailable.
  const [note, setNote] = useState<NoteDetailResult | null | undefined>(
    undefined,
  );

  useEscapeKey(onClose);

  useEffect(() => {
    let cancelled = false;
    setNote(undefined);
    getNoteAction(noteId)
      .then((n) => {
        if (!cancelled) setNote(n);
      })
      .catch((err) => {
        console.error("[quick-view] load failed:", err);
        if (!cancelled) setNote(null);
      });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  return (
    <div className="absolute inset-4 z-30 flex flex-col overflow-hidden rounded-2xl border border-steel/35 bg-[#1B1E21] shadow-[0_0_0_4px_rgba(155,184,206,0.07),0_28px_60px_rgba(0,0,0,0.6)] animate-pop-in md:inset-auto md:right-[7rem] md:top-10 md:h-[80vh] md:max-h-[37.5rem] md:w-[32.5rem]">
      {/* Header: breadcrumb + open-full + close */}
      <div className="flex flex-none items-center gap-2 border-b border-white/7 bg-steel/5 px-3.5 py-3">
        <ScanEye className="h-3.5 w-3.5 flex-none text-steel" />
        <span className="flex min-w-0 items-center gap-1.5 text-[0.75rem] font-medium text-ink-400">
          {note?.bubbleTitle && (
            <>
              <span
                className="h-1.5 w-1.5 flex-none rounded-full"
                style={{ background: note.bubbleColor ?? "#9CC5AC" }}
              />
              <span className="max-w-[7.5rem] flex-none truncate">
                {note.bubbleTitle}
              </span>
              <ChevronRight className="h-[0.6875rem] w-[0.6875rem] flex-none text-ink-700" />
            </>
          )}
          <span className="min-w-0 truncate text-ink-200">
            {note ? note.title || "Untitled" : "…"}
          </span>
        </span>
        <div className="ml-auto flex flex-none items-center gap-0.5">
          {onPinToDock && (
            <button
              type="button"
              aria-label="Pin to dock"
              title="Pin to dock — keep this note open while you work"
              onClick={() => onPinToDock(noteId, note?.title ?? "")}
              className="hidden h-[1.625rem] w-[1.625rem] items-center justify-center rounded-[0.4375rem] hover:bg-white/6 md:flex"
            >
              <PanelBottomOpen className="h-3.5 w-3.5 text-ink-400" />
            </button>
          )}
          <button
            type="button"
            aria-label="Open full note"
            title="Open full note"
            onClick={() => router.push(`/app/notes/${noteId}`)}
            className="flex h-[1.625rem] w-[1.625rem] items-center justify-center rounded-[0.4375rem] hover:bg-white/6"
          >
            <ArrowUpRight className="h-3.5 w-3.5 text-ink-400" />
          </button>
          <button
            type="button"
            aria-label="Close quick view"
            onClick={onClose}
            className="flex h-[1.625rem] w-[1.625rem] items-center justify-center rounded-[0.4375rem] hover:bg-white/6"
          >
            <X className="h-3.5 w-3.5 text-ink-400" />
          </button>
        </div>
      </div>

      {/* Body: the real editor */}
      <div className="flex min-h-0 flex-1 flex-col">
        {note === undefined ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-ink-600" />
          </div>
        ) : note === null ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center">
            <p className="text-sm text-ink-500">
              This note isn&rsquo;t available — it may have been deleted.
            </p>
          </div>
        ) : (
          <NoteEditor
            key={note.id}
            noteId={note.id}
            initialTitle={note.title}
            initialContent={note.content}
            initialBubbleId={note.bubbleId}
            onTrashed={onClose}
          />
        )}
      </div>

      <div className="flex flex-none items-center justify-end border-t border-white/7 px-3.5 py-2">
        <span className="text-[0.65625rem] text-ink-600">
          esc closes back to the day · edits sync
        </span>
      </div>
    </div>
  );
}
