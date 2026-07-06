"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FileText,
  Loader2,
  Minus,
  X,
} from "lucide-react";

import { getNoteAction, type NoteDetailResult } from "@/app/app/actions";
import { NoteEditor } from "@/components/notes/NoteEditor";

/**
 * Multi-note dock: opening a note link on the home lands it here as a
 * floating editor window anchored bottom-right, so a few notes can be worked
 * on side by side (copy/paste between them). State lives in NoteDockProvider
 * at the app-shell level, so windows and tabs persist across /app pages.
 * Windows open LARGE by default — near-full height, capped so two fit side
 * by side — with a per-window compact toggle. Minimized notes collapse to
 * pills styled like miniature windows (solid surface + steel ring) so they
 * read as chrome, not canvas; the shell reserves a bottom strip for them so
 * they don't cover page controls. Desktop only — floating windows don't fit
 * phones.
 */

export interface DockNote {
  id: string;
  /** Live title, reported by the window once the note loads ("" until then). */
  title: string;
}

export function NoteDock({
  notes,
  expandedIds,
  onToggle,
  onClose,
  onTitle,
}: {
  notes: DockNote[];
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onClose: (id: string) => void;
  onTitle: (id: string, title: string) => void;
}) {
  if (notes.length === 0) return null;
  return (
    <div className="pointer-events-none absolute bottom-3 right-4 z-40 hidden items-end gap-2.5 md:flex">
      {notes.map((n) =>
        expandedIds.has(n.id) ? (
          <DockWindow
            key={n.id}
            note={n}
            onMinimize={() => onToggle(n.id)}
            onClose={() => onClose(n.id)}
            onTitle={(t) => onTitle(n.id, t)}
          />
        ) : (
          <button
            key={n.id}
            type="button"
            onClick={() => onToggle(n.id)}
            title={n.title || "Untitled"}
            className="pointer-events-auto flex max-w-[13rem] items-center gap-2 rounded-full border border-steel/35 bg-[#1B1E21] py-2 pl-3.5 pr-2 shadow-[0_0_0_3px_rgba(155,184,206,0.08),0_10px_30px_rgba(0,0,0,0.55)] hover:border-steel/60 hover:bg-[#22262B]"
          >
            <FileText className="h-3.5 w-3.5 flex-none text-steel" />
            <span className="min-w-0 flex-1 truncate text-[0.75rem] font-medium text-ink-100">
              {n.title || "Untitled"}
            </span>
            <span
              role="button"
              tabIndex={0}
              aria-label="Close"
              onClick={(e) => {
                e.stopPropagation();
                onClose(n.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onClose(n.id);
                }
              }}
              className="flex h-5 w-5 flex-none items-center justify-center rounded-full hover:bg-white/10"
            >
              <X className="h-3 w-3 text-ink-500" />
            </span>
          </button>
        ),
      )}
    </div>
  );
}

function DockWindow({
  note,
  onMinimize,
  onClose,
  onTitle,
}: {
  note: DockNote;
  onMinimize: () => void;
  onClose: () => void;
  onTitle: (title: string) => void;
}) {
  const router = useRouter();
  // Large by default: the dock exists to work on two notes at once, so a
  // window is a real workspace — near-full height, two fit side by side.
  const [large, setLarge] = useState(true);
  // undefined = loading, null = unavailable.
  const [detail, setDetail] = useState<NoteDetailResult | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;
    getNoteAction(note.id)
      .then((n) => {
        if (cancelled) return;
        setDetail(n);
        if (n) onTitle(n.title || "Untitled");
      })
      .catch((err) => {
        console.error("[dock] load failed:", err);
        if (!cancelled) setDetail(null);
      });
    return () => {
      cancelled = true;
    };
    // onTitle is stable enough for a one-shot report.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  return (
    <div
      className={`pointer-events-auto flex flex-col overflow-hidden rounded-2xl border border-steel/30 bg-[#1B1E21] shadow-[0_0_0_4px_rgba(155,184,206,0.06),0_24px_56px_rgba(0,0,0,0.6)] animate-pop-in ${
        large
          ? "h-[calc(100dvh-7.5rem)] w-[min(34rem,42vw)]"
          : "h-[26rem] max-h-[70vh] w-[21rem]"
      }`}
    >
      <div className="flex flex-none items-center gap-2 border-b border-white/7 bg-steel/5 px-3 py-2">
        <FileText className="h-3.5 w-3.5 flex-none text-steel" />
        <span className="min-w-0 flex-1 truncate text-[0.78125rem] font-medium text-ink-200">
          {note.title || (detail === undefined ? "…" : "Untitled")}
        </span>
        <button
          type="button"
          aria-label={large ? "Compact window" : "Expand window"}
          title={large ? "Compact window" : "Expand window"}
          onClick={() => setLarge((v) => !v)}
          className="flex h-[1.375rem] w-[1.375rem] flex-none items-center justify-center rounded-md hover:bg-white/6"
        >
          {large ? (
            <ChevronsDownUp className="h-3 w-3 text-ink-400" />
          ) : (
            <ChevronsUpDown className="h-3 w-3 text-ink-400" />
          )}
        </button>
        <button
          type="button"
          aria-label="Open full note"
          title="Open full note"
          onClick={() => router.push(`/app/notes/${note.id}`)}
          className="flex h-[1.375rem] w-[1.375rem] flex-none items-center justify-center rounded-md hover:bg-white/6"
        >
          <ArrowUpRight className="h-3 w-3 text-ink-400" />
        </button>
        <button
          type="button"
          aria-label="Minimize"
          title="Minimize"
          onClick={onMinimize}
          className="flex h-[1.375rem] w-[1.375rem] flex-none items-center justify-center rounded-md hover:bg-white/6"
        >
          <Minus className="h-3 w-3 text-ink-400" />
        </button>
        <button
          type="button"
          aria-label="Close"
          title="Close"
          onClick={onClose}
          className="flex h-[1.375rem] w-[1.375rem] flex-none items-center justify-center rounded-md hover:bg-white/6"
        >
          <X className="h-3 w-3 text-ink-400" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {detail === undefined ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-ink-600" />
          </div>
        ) : detail === null ? (
          <div className="flex flex-1 items-center justify-center p-4 text-center">
            <p className="text-[0.78125rem] text-ink-500">
              This note isn&rsquo;t available.
            </p>
          </div>
        ) : (
          <NoteEditor
            key={detail.id}
            noteId={detail.id}
            initialTitle={detail.title}
            initialContent={detail.content}
            initialBubbleId={detail.bubbleId}
            onTrashed={onClose}
          />
        )}
      </div>
    </div>
  );
}
