"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  EditorState,
  LexicalEditor,
  SerializedEditorState,
} from "lexical";
import { $getRoot } from "lexical";
import {
  AlertCircle,
  AlignLeft,
  Check,
  Columns2,
  Loader2,
  Plus,
  Sun,
} from "lucide-react";

import {
  getDailyNoteAction,
  getOrCreateTodayNoteAction,
} from "@/app/app/actions";
import { Editor } from "@/components/editor/Editor";
import {
  $isLinkedNoteCardNode,
  LinkedNoteCard,
} from "@/components/editor/nodes/LinkedNoteCardNode";
import { $createTimedParagraphNode } from "@/components/editor/nodes/TimedParagraphNode";
import { NoteTaskContext } from "@/components/editor/nodes/TaskNode";
import { DailyPlanCard } from "@/components/home/DailyPlanCard";
import { DayTimelineButton } from "@/components/home/DayTimeline";
import { HabitStrip } from "@/components/home/HabitStrip";
import { MeetingModeCard } from "@/components/home/MeetingModeCard";
import { VoiceCaptureButton } from "@/components/voice/VoiceCapture";
import { formatLongDate, localDateString } from "@/lib/dates";
import { useNoteAutosave, type SaveState } from "@/lib/hooks/use-note-autosave";

/** Same key DailyPlanCard writes on Dismiss — literal in both files (no
 * shared constants module for a single string). */
const PLAN_DISMISSED_KEY = "daily-plan-dismissed";

/**
 * The home's centerpiece: the daily note as a live timeline document. Today's
 * note is get-or-created; past days are read without creating rows (with a
 * "start a note for this day" affordance when absent). The editor runs in
 * `variant="daily"` — timed blocks, gutter labels, linked-note cards.
 */

type DailyNote = {
  id: string;
  title: string;
  content: SerializedEditorState | null;
};

const DAILY_CONTENT_CLASS =
  "editor-content daily-gutter mx-auto min-h-full w-full max-w-[48.125rem] pb-16 pl-[4.125rem] pr-7 pt-5 text-[0.90625rem] leading-[1.75] text-ink-300 outline-none 2xl:max-w-[56rem]";

export function DailyNoteWidget({
  dateStr,
  isToday,
  editorRef,
  onNoteLoaded,
  onLinkedCountChange,
}: {
  /** Viewed local day; null while the client date is still resolving. */
  dateStr: string | null;
  isToday: boolean;
  editorRef: React.MutableRefObject<LexicalEditor | null>;
  /** Reports the loaded daily note's id (null while loading / absent). */
  onNoteLoaded?: (noteId: string | null) => void;
  /** Reports the number of linked-note cards in the doc (drives widgets). */
  onLinkedCountChange?: (count: number) => void;
}) {
  // undefined = loading, null = no note for this (past) day.
  const [note, setNote] = useState<DailyNote | null | undefined>(undefined);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!dateStr) return;
    let cancelled = false;
    setNote(undefined);
    onNoteLoaded?.(null);
    const load = isToday
      ? getOrCreateTodayNoteAction(dateStr)
      : getDailyNoteAction(dateStr);
    load
      .then((n) => {
        if (cancelled) return;
        setNote(n);
        onNoteLoaded?.(n?.id ?? null);
      })
      .catch((err) => {
        console.error("[daily] load failed:", err);
        if (!cancelled) setNote(null);
      });
    return () => {
      cancelled = true;
    };
    // onNoteLoaded is a stable setState from the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateStr, isToday]);

  const createForDay = () => {
    if (!dateStr || creating) return;
    setCreating(true);
    getOrCreateTodayNoteAction(dateStr)
      .then((n) => {
        setNote(n);
        onNoteLoaded?.(n.id);
      })
      .catch((err) => console.error("[daily] create failed:", err))
      .finally(() => setCreating(false));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!dateStr || note === undefined ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* max-md:hidden (here and on the real header): on phone the page
              header above the widget owns the date (design Turn 17a). */}
          <div className="flex flex-none items-center gap-2.5 border-b border-white/7 px-4 py-3 max-md:hidden">
            <div className="h-3.5 w-3.5 animate-pulse rounded bg-white/8" />
            <div className="h-3.5 w-28 animate-pulse rounded bg-white/8" />
          </div>
          <div className="mx-auto flex w-full max-w-[48.125rem] flex-1 flex-col gap-3 pl-[4.125rem] pr-7 pt-5 2xl:max-w-[56rem]">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-3 animate-pulse rounded bg-white/6"
                style={{ width: `${85 - i * 12}%` }}
              />
            ))}
          </div>
        </div>
      ) : note === null ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <Sun className="h-8 w-8 text-ink-700" />
          <p className="text-sm text-ink-500">
            {dateStr > localDateString()
              ? `Nothing here yet for ${formatLongDate(dateStr)}.`
              : `Nothing was written on ${formatLongDate(dateStr)}.`}
          </p>
          <button
            type="button"
            onClick={createForDay}
            disabled={creating}
            className="rounded-lg bg-sage/16 px-3 py-1.5 text-[0.78125rem] font-medium text-sage hover:bg-sage/24 disabled:opacity-60"
          >
            {creating
              ? "Creating…"
              : dateStr > localDateString()
                ? "Start this day's note"
                : "Create a note for this day"}
          </button>
        </div>
      ) : (
        <DailyEditor
          key={note.id}
          note={note}
          dateStr={dateStr}
          isToday={isToday}
          editorRef={editorRef}
          onLinkedCountChange={onLinkedCountChange}
        />
      )}
    </div>
  );
}

/**
 * Scans the live doc once per change: counts block-level linked-note cards
 * (header badge) and whether the doc has any real content (task rows, linked
 * cards, or non-empty text) — the latter piggybacks on this existing scan to
 * permanently hide the morning plan card once the user starts writing.
 */
function scanDoc(state: EditorState): {
  linkedIds: string[];
  hasContent: boolean;
} {
  return state.read(() => {
    const linkedIds: string[] = [];
    let hasContent = false;
    for (const child of $getRoot().getChildren()) {
      const type = child.getType();
      if ($isLinkedNoteCardNode(child) && child.__noteId) {
        linkedIds.push(child.__noteId);
      }
      if (type === "task" || type === "linked-note-card") {
        hasContent = true;
      } else if (child.getTextContent().trim().length > 0) {
        hasContent = true;
      }
    }
    return { linkedIds, hasContent };
  });
}

type ContentNode = {
  type?: string;
  text?: string;
  noteId?: string;
  children?: ContentNode[];
};

/** Linked-note ids from a serialized doc — seeds the split pane on mount
 * (the live scan only runs on edits, which left the pane empty after a
 * remount until the first keystroke). */
function collectLinkedIds(content: SerializedEditorState | null): string[] {
  const root = content?.root as ContentNode | undefined;
  const children = Array.isArray(root?.children) ? root.children : [];
  return children
    .filter(
      (c) => c.type === "linked-note-card" && typeof c.noteId === "string",
    )
    .map((c) => c.noteId as string);
}

function nodeHasContent(node: ContentNode): boolean {
  if (node.type === "task" || node.type === "linked-note-card") return true;
  if (typeof node.text === "string" && node.text.trim().length > 0) return true;
  return Array.isArray(node.children) && node.children.some(nodeHasContent);
}

/**
 * True when the loaded daily note has nothing meaningful yet — gates whether
 * the morning plan proposal card (DailyPlanCard) is offered at all.
 */
function isDailyNoteEmpty(content: SerializedEditorState | null): boolean {
  const root = content?.root as ContentNode | undefined;
  const children = root?.children;
  if (!Array.isArray(children) || children.length === 0) return true;
  return !children.some(nodeHasContent);
}

const DAILY_VIEW_KEY = "daily-view";

function DailyEditor({
  note,
  dateStr,
  isToday,
  editorRef,
  onLinkedCountChange,
}: {
  note: DailyNote;
  dateStr: string;
  isToday: boolean;
  editorRef: React.MutableRefObject<LexicalEditor | null>;
  onLinkedCountChange?: (count: number) => void;
}) {
  const { saveState, initialStateJSON, onEditorChange } = useNoteAutosave(
    note.id,
    note.content,
  );
  const [linkedIds, setLinkedIds] = useState<string[]>(() =>
    collectLinkedIds(note.content),
  );
  const linkedCount = linkedIds.length;

  // "write" = full-width jot; "split" = jot text | the doc's linked-note
  // cards, pulled out so the writing stays clean. Sticky via localStorage.
  const [view, setView] = useState<"write" | "split">("write");
  useEffect(() => {
    try {
      if (localStorage.getItem(DAILY_VIEW_KEY) === "split") setView("split");
    } catch {
      // localStorage unavailable — default stands.
    }
  }, []);
  const switchView = (next: "write" | "split") => {
    setView(next);
    try {
      localStorage.setItem(DAILY_VIEW_KEY, next);
    } catch {
      // best-effort persistence only
    }
  };

  // The morning plan card only ever appears for today's initially-empty note,
  // and only until dismissed/inserted/typed-over — derived once per note.
  const [showPlanCard, setShowPlanCard] = useState(false);
  useEffect(() => {
    if (!isToday || !isDailyNoteEmpty(note.content)) return;
    try {
      if (localStorage.getItem(PLAN_DISMISSED_KEY) === dateStr) return;
    } catch {
      // localStorage unavailable — fall through and show the card anyway.
    }
    setShowPlanCard(true);
    // note.content only changes when `note` (and thus the `key`-forced
    // remount) does, so this runs once per mounted note.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isToday, dateStr]);

  const handleChange = (state: EditorState) => {
    onEditorChange(state);
    const { linkedIds: ids, hasContent } = scanDoc(state);
    setLinkedIds((prev) => {
      if (prev.length !== ids.length || prev.some((v, i) => v !== ids[i])) {
        onLinkedCountChange?.(ids.length);
        return ids;
      }
      return prev;
    });
    if (hasContent) setShowPlanCard(false);
  };

  const appendBlock = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.update(() => {
      const block = $createTimedParagraphNode();
      $getRoot().append(block);
      block.select();
    });
    editor.focus();
  };

  const noteTaskCtx = useMemo(() => ({ noteId: note.id }), [note.id]);

  return (
    <>
      <div className="flex flex-none items-center gap-2.5 border-b border-white/7 px-4 py-3 max-md:hidden">
        <Sun className="h-3.5 w-3.5 text-sage" />
        <span className="text-sm font-semibold text-ink-100">
          {formatLongDate(dateStr)}
        </span>
        <span className="text-[0.71875rem] text-ink-600">
          daily note
          {linkedCount > 0 &&
            ` · ${linkedCount} linked note${linkedCount === 1 ? "" : "s"}`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <DailySaveIndicator state={saveState} />
          <div className="hidden items-center gap-0.5 rounded-md bg-white/5 p-0.5 md:flex">
              <button
                type="button"
                aria-label="Jot only"
                aria-pressed={view === "write"}
                onClick={() => switchView("write")}
                className={`flex h-[1.125rem] w-[1.125rem] items-center justify-center rounded ${
                  view === "write" ? "bg-white/10 text-ink-200" : "text-ink-600 hover:text-ink-400"
                }`}
              >
                <AlignLeft className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label="Split: jot and linked notes"
                aria-pressed={view === "split"}
                onClick={() => switchView("split")}
                className={`flex h-[1.125rem] w-[1.125rem] items-center justify-center rounded ${
                  view === "split" ? "bg-white/10 text-ink-200" : "text-ink-600 hover:text-ink-400"
                }`}
              >
                <Columns2 className="h-3 w-3" />
              </button>
            </div>
          {isToday && (
            <VoiceCaptureButton
              noteId={note.id}
              editorRef={editorRef}
              dateStr={dateStr}
            />
          )}
          {isToday && <DayTimelineButton dateStr={dateStr} />}
          <button
            type="button"
            onClick={appendBlock}
            aria-label="Add a block"
            className="flex h-[1.375rem] w-[1.375rem] items-center justify-center rounded-md bg-white/6 hover:bg-white/10"
          >
            <Plus className="h-3 w-3 text-ink-400" />
          </button>
        </div>
      </div>

      {isToday && (
        // empty:hidden collapses the wrapper (and its padding) whenever the
        // card decides to render nothing — no meetings, not configured, etc.
        <div className="mx-auto min-h-0 w-full max-w-[48.125rem] overflow-y-auto pl-4 pr-4 pt-4 empty:hidden md:pl-[4.125rem] md:pr-7 2xl:max-w-[56rem]">
          <MeetingModeCard
            isToday={isToday}
            dateStr={dateStr}
            todayNoteId={note.id}
            editorRef={editorRef}
          />
        </div>
      )}

      {isToday && <HabitStrip dateStr={dateStr} />}

      {showPlanCard && (
        // min-h-0 + overflow-y-auto: the card yields and scrolls when it is
        // taller than the widget (long plans, inflated text) instead of
        // clipping its own buttons and squeezing the editor out entirely.
        <div className="mx-auto min-h-0 w-full max-w-[48.125rem] overflow-y-auto pl-4 pr-4 pt-5 md:pl-[4.125rem] md:pr-0 2xl:max-w-[56rem]">
          <DailyPlanCard
            dateStr={dateStr}
            editorRef={editorRef}
            onInserted={() => setShowPlanCard(false)}
          />
        </div>
      )}

      <div className="flex min-h-[8rem] min-w-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <NoteTaskContext.Provider value={noteTaskCtx}>
            <Editor
              variant="daily"
              splitLinks={view === "split"}
              initialStateJSON={initialStateJSON}
              onChange={handleChange}
              contentClassName={DAILY_CONTENT_CLASS}
              editorRef={editorRef}
            />
          </NoteTaskContext.Provider>
        </div>
        {view === "split" && (
          <aside className="hidden min-h-0 w-[45%] max-w-[26rem] flex-col gap-3 overflow-y-auto border-l border-white/7 p-3 md:flex">
            <p className="flex-none text-[0.625rem] font-medium uppercase tracking-[0.08em] text-ink-600">
              Linked notes in this jot
            </p>
            {linkedIds.length === 0 ? (
              <p className="text-[0.71875rem] leading-relaxed text-ink-600">
                Link a note with [[ in the jot — it moves over here, editable
                in place, so your writing stays clean.
              </p>
            ) : (
              linkedIds.map((id) => (
                <LinkedNoteCard key={id} noteId={id} title="" />
              ))
            )}
          </aside>
        )}
      </div>
    </>
  );
}

function DailySaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  return (
    <span className="flex items-center gap-1.5 text-[0.65625rem] text-ink-600">
      {state === "saving" ? (
        <>
          <Loader2 className="h-[0.6875rem] w-[0.6875rem] animate-spin" />
          saving…
        </>
      ) : state === "error" ? (
        <span className="flex items-center gap-1.5 text-red-400">
          <AlertCircle className="h-[0.6875rem] w-[0.6875rem]" />
          save failed
        </span>
      ) : (
        <>
          <Check className="h-[0.6875rem] w-[0.6875rem] text-sage" />
          saved
        </>
      )}
    </span>
  );
}
