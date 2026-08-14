"use client";

import { useEffect, useRef, useState } from "react";
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

import {
  getNoteAction,
  quickCreateNoteAction,
  type NoteDetailResult,
} from "@/app/app/actions";
import { NoteEditor } from "@/components/notes/NoteEditor";
import type { DockPreset } from "@/components/notes/NoteDockProvider";
import { NoteTabStrip } from "@/components/notes/NoteTabStrip";

/**
 * The note dock: one floating, TABBED editor window anchored bottom-right, so
 * several notes can be kept to hand and switched between like files in a code
 * editor. Opening a note link from the home, a card, or a log marker lands it
 * here as a tab.
 *
 * Only the focused tab mounts a NoteEditor. That's deliberate on two counts:
 * a background tab holding a live editor would autosave a document nobody is
 * looking at, and the debounced save flushes on unmount (see
 * use-debounced-callback), so switching away commits pending edits rather than
 * dropping them.
 *
 * Sizing is the user's. Two presets — large and compact, both tabbed — plus a
 * free drag from the TOP-LEFT corner: the window is pinned to the bottom-right
 * of the content area, so that is the corner that grows it, and dragging it is
 * the only resize gesture that doesn't fight the anchor. A dragged size wins
 * over the preset until a preset is picked again. Desktop only — floating
 * windows don't fit phones.
 */

export interface DockNote {
  id: string;
  /** Live title, reported by the window once the note loads ("" until then). */
  title: string;
}

/** An explicit, dragged window size in pixels. */
export interface DockSize {
  w: number;
  h: number;
}

/** Small enough to be out of the way, big enough to still be an editor. */
const MIN_W = 320;
const MIN_H = 260;
/** Keep the window off the very edges of the viewport while dragging. */
const VIEWPORT_MARGIN = 48;

const PRESET_CLASS: Record<DockPreset, string> = {
  // Shorter than full-height and wider than a column: the window is a place to
  // work, not a wall, and the page behind it stays partly readable.
  large: "h-[min(48rem,calc(100dvh-9rem))] w-[min(40rem,48vw)]",
  // Compact is a glance, not a squint — tall enough for a screenful of note.
  compact: "h-[min(34rem,calc(100dvh-9rem))] w-[min(26rem,44vw)]",
};

export function NoteDock({
  notes,
  activeId,
  minimized,
  preset,
  size,
  pageNoteId,
  onActivate,
  onOpen,
  onClose,
  onCloseAll,
  onTitle,
  onMinimize,
  onRestore,
  onPreset,
  onResize,
}: {
  notes: DockNote[];
  activeId: string | null;
  minimized: boolean;
  preset: DockPreset;
  size: DockSize | null;
  /** The note open full-page behind the dock, if any — never given an editor. */
  pageNoteId: string | null;
  onActivate: (id: string) => void;
  onOpen: (noteId: string, title?: string) => void;
  onClose: (id: string) => void;
  onCloseAll: () => void;
  onTitle: (id: string, title: string) => void;
  onMinimize: () => void;
  onRestore: () => void;
  onPreset: (preset: DockPreset) => void;
  onResize: (size: DockSize | null) => void;
}) {
  if (notes.length === 0) return null;
  const active = notes.find((n) => n.id === activeId) ?? null;

  return (
    <div className="pointer-events-none absolute bottom-3 right-4 z-40 hidden items-end md:flex">
      {minimized ? (
        <button
          type="button"
          onClick={onRestore}
          title={active?.title || "Untitled"}
          className="pointer-events-auto flex max-w-[15rem] items-center gap-2 rounded-full border border-steel/35 bg-[#1B1E21] py-2 pl-3.5 pr-2 shadow-[0_0_0_3px_rgba(155,184,206,0.08),0_10px_30px_rgba(0,0,0,0.55)] hover:border-steel/60 hover:bg-[#22262B]"
        >
          <FileText className="h-3.5 w-3.5 flex-none text-steel" />
          <span className="min-w-0 flex-1 truncate text-[0.75rem] font-medium text-ink-100">
            {active?.title || "Untitled"}
          </span>
          {notes.length > 1 && (
            <span className="flex-none rounded-full bg-white/10 px-1.5 text-[0.625rem] tabular-nums text-ink-300">
              {notes.length}
            </span>
          )}
          <span
            role="button"
            tabIndex={0}
            aria-label="Close all tabs"
            onClick={(e) => {
              e.stopPropagation();
              onCloseAll();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onCloseAll();
              }
            }}
            className="flex h-5 w-5 flex-none items-center justify-center rounded-full hover:bg-white/10"
          >
            <X className="h-3 w-3 text-ink-500" />
          </span>
        </button>
      ) : (
        <DockWindow
          notes={notes}
          active={active}
          preset={preset}
          size={size}
          pageNoteId={pageNoteId}
          onActivate={onActivate}
          onOpen={onOpen}
          onClose={onClose}
          onCloseAll={onCloseAll}
          onTitle={onTitle}
          onMinimize={onMinimize}
          onPreset={onPreset}
          onResize={onResize}
        />
      )}
    </div>
  );
}

function DockWindow({
  notes,
  active,
  preset,
  size,
  pageNoteId,
  onActivate,
  onOpen,
  onClose,
  onCloseAll,
  onTitle,
  onMinimize,
  onPreset,
  onResize,
}: {
  notes: DockNote[];
  active: DockNote | null;
  preset: DockPreset;
  size: DockSize | null;
  pageNoteId: string | null;
  onActivate: (id: string) => void;
  onOpen: (noteId: string, title?: string) => void;
  onClose: (id: string) => void;
  onCloseAll: () => void;
  onTitle: (id: string, title: string) => void;
  onMinimize: () => void;
  onPreset: (preset: DockPreset) => void;
  onResize: (size: DockSize | null) => void;
}) {
  const router = useRouter();
  const windowRef = useRef<HTMLDivElement | null>(null);
  const [creating, setCreating] = useState(false);
  // Live size during a drag. Committing only on release keeps every pointermove
  // out of the provider (and out of sessionStorage).
  const [dragging, setDragging] = useState<DockSize | null>(null);
  const applied = dragging ?? size;

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = windowRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startW = rect.width;
    const startH = rect.height;
    event.preventDefault();

    // Dragging up and to the left grows the window: it's pinned at its
    // bottom-right, so both deltas are inverted.
    let latest: DockSize = { w: startW, h: startH };
    const onMove = (e: PointerEvent) => {
      latest = {
        w: clamp(
          startW + (startX - e.clientX),
          MIN_W,
          window.innerWidth - VIEWPORT_MARGIN,
        ),
        h: clamp(
          startH + (startY - e.clientY),
          MIN_H,
          window.innerHeight - VIEWPORT_MARGIN,
        ),
      };
      setDragging(latest);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDragging(null);
      onResize(latest);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  /**
   * A blank note, opened as a tab. Untitled on purpose — the point of the
   * button is somewhere to start typing, and the note takes its name from the
   * title line once there is one.
   */
  const newTab = () => {
    if (creating) return;
    setCreating(true);
    quickCreateNoteAction("")
      .then((note) => onOpen(note.id, note.title))
      .catch((err) => console.error("[dock] new tab failed:", err))
      .finally(() => setCreating(false));
  };

  const applyPreset = (next: DockPreset) => {
    onPreset(next);
    // A preset is a fresh answer to "how big", so it clears the dragged size —
    // otherwise the button would look broken for anyone who had resized.
    onResize(null);
  };

  return (
    <div
      ref={windowRef}
      style={applied ? { width: applied.w, height: applied.h } : undefined}
      className={`pointer-events-auto relative flex flex-col overflow-hidden rounded-2xl border border-steel/30 bg-[#1B1E21] shadow-[0_0_0_4px_rgba(155,184,206,0.06),0_24px_56px_rgba(0,0,0,0.6)] animate-pop-in ${
        applied ? "" : PRESET_CLASS[preset]
      }`}
    >
      {/* Resize grip. A corner rather than an edge: the window is anchored
          bottom-right, so this is the only handle that moves one corner and
          leaves the anchor alone. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize window"
        title="Drag to resize"
        onPointerDown={startResize}
        className="group absolute left-0 top-0 z-20 h-5 w-5 cursor-nwse-resize"
      >
        <span className="pointer-events-none absolute left-1.5 top-1.5 h-2 w-2 rounded-tl-[3px] border-l-2 border-t-2 border-steel/40 transition-colors group-hover:border-steel" />
      </div>

      {/* Tab strip — the window's title bar, with its controls on the right. */}
      <div className="flex flex-none items-center gap-1 border-b border-white/7 bg-black/25 pl-6 pr-1.5 pt-1.5">
        <NoteTabStrip
          notes={notes}
          activeId={active?.id ?? null}
          onActivate={onActivate}
          onClose={onClose}
          onNewTab={newTab}
          newTabDisabled={creating}
        />

        <div className="flex flex-none items-center gap-0.5 pb-1.5">
          <WindowButton
            label={preset === "large" ? "Compact window" : "Expand window"}
            onClick={() =>
              applyPreset(preset === "large" ? "compact" : "large")
            }
          >
            {preset === "large" ? (
              <ChevronsDownUp className="h-3 w-3" />
            ) : (
              <ChevronsUpDown className="h-3 w-3" />
            )}
          </WindowButton>
          {active && (
            <WindowButton
              label="Open full note"
              onClick={() => router.push(`/app/notes/${active.id}`)}
            >
              <ArrowUpRight className="h-3 w-3" />
            </WindowButton>
          )}
          <WindowButton label="Minimize" onClick={onMinimize}>
            <Minus className="h-3 w-3" />
          </WindowButton>
          <WindowButton label="Close all tabs" onClick={onCloseAll}>
            <X className="h-3 w-3" />
          </WindowButton>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {!active ? null : active.id === pageNoteId ? (
          // The page behind is already editing this note; a second live editor
          // would race its autosave.
          <div className="flex flex-1 items-center justify-center p-4 text-center">
            <p className="text-[0.78125rem] text-ink-500">
              Open on the page behind this window.
            </p>
          </div>
        ) : (
          <DockBody
            key={active.id}
            noteId={active.id}
            onTitle={(t) => onTitle(active.id, t)}
            onTrashed={() => onClose(active.id)}
            onCloseTab={() => onClose(active.id)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The focused tab's editor. Keyed by note id, so switching tabs remounts.
 *
 * A failed load and a note that no longer exists used to collapse into one
 * dead-end message, which is the worst of both: a transient DB hiccup looked
 * permanent, and a genuinely gone note left a tab that says the same thing on
 * every reload. They're separated here — a failure offers a retry, a missing
 * note offers the only thing left to do with the tab, which is close it.
 */
type DockLoad =
  | { status: "loading" }
  | { status: "ready"; detail: NoteDetailResult }
  | { status: "gone" }
  | { status: "error" };

function DockBody({
  noteId,
  onTitle,
  onTrashed,
  onCloseTab,
}: {
  noteId: string;
  onTitle: (title: string) => void;
  onTrashed: () => void;
  onCloseTab: () => void;
}) {
  const [load, setLoad] = useState<DockLoad>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });
    getNoteAction(noteId)
      .then((n) => {
        if (cancelled) return;
        if (!n) {
          setLoad({ status: "gone" });
          return;
        }
        setLoad({ status: "ready", detail: n });
        onTitle(n.title || "Untitled");
      })
      .catch((err) => {
        console.error("[dock] load failed:", err);
        if (!cancelled) setLoad({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
    // onTitle is stable enough for a one-shot report.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, attempt]);

  if (load.status === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-ink-600" />
      </div>
    );
  }
  if (load.status === "error") {
    return (
      <DockMessage
        text="Couldn't load this note."
        actionLabel="Try again"
        onAction={() => setAttempt((a) => a + 1)}
      />
    );
  }
  if (load.status === "gone") {
    return (
      <DockMessage
        text="This note is gone — it was deleted, or it belongs to another account."
        actionLabel="Close tab"
        onAction={onCloseTab}
      />
    );
  }
  return (
    <NoteEditor
      noteId={load.detail.id}
      initialTitle={load.detail.title}
      initialContent={load.detail.content}
      initialBubbleId={load.detail.bubbleId}
      onTrashed={onTrashed}
    />
  );
}

/** A dead-end state in the window body, with the one action that resolves it. */
function DockMessage({
  text,
  actionLabel,
  onAction,
}: {
  text: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="max-w-[18rem] text-[0.78125rem] text-ink-500">{text}</p>
      <button
        type="button"
        onClick={onAction}
        className="rounded-md border border-steel/35 px-2.5 py-1 text-[0.75rem] font-medium text-ink-200 hover:border-steel/60 hover:bg-white/6"
      >
        {actionLabel}
      </button>
    </div>
  );
}

function WindowButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-[1.375rem] w-[1.375rem] flex-none items-center justify-center rounded-md text-ink-400 hover:bg-white/6 hover:text-ink-100"
    >
      {children}
    </button>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
