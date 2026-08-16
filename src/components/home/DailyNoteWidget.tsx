"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  EditorState,
  LexicalEditor,
  SerializedEditorState,
} from "lexical";
import { $getRoot } from "lexical";
import { AlignLeft, BookOpen, Columns2, Plus, Sun } from "lucide-react";

import { getOrCreateTodayNoteAction } from "@/app/app/actions";
import { Editor } from "@/components/editor/Editor";
import {
  $isLinkedNoteCardNode,
  LinkedNoteCard,
} from "@/components/editor/nodes/LinkedNoteCardNode";
import { $createTimedParagraphNode } from "@/components/editor/nodes/TimedParagraphNode";
import { NoteTaskContext } from "@/components/editor/nodes/TaskNode";
import { DailyStack } from "@/components/home/DailyStack";
import { DayPager } from "@/components/home/DayPager";
import { DayTimelineButton } from "@/components/home/DayTimeline";
import {
  SaveFailureBanner,
  SaveStatusChip,
} from "@/components/notes/SaveStatus";
import { VoiceCaptureButton } from "@/components/voice/VoiceCapture";
import { addDays, formatLongDate, localDateString } from "@/lib/dates";
import type { CachedDay, DailyNote } from "@/lib/hooks/use-daily-note-window";
import { useNoteAutosave } from "@/lib/hooks/use-note-autosave";

/** Same key DailyPlanCard writes on Dismiss — literal in both files (no
 * shared constants module for a single string). */
const PLAN_DISMISSED_KEY = "daily-plan-dismissed";

/**
 * The home's centerpiece: the daily note as a live timeline document. The note
 * itself is NOT fetched here — the home owns a prefetched window of days (see
 * `useDailyNoteWindow`) and hands the right one down, which is what makes
 * flipping days instant instead of a load. Today's note is get-or-created by
 * that window; every other day is read without creating a row, with a "start a
 * note for this day" affordance when absent. The editor runs in
 * `variant="daily"` — timed blocks, gutter labels, linked-note cards.
 */

/**
 * The pager, centered on the header bar itself rather than packed against the
 * date. Absolute + translate, not a flex spacer: the bar's two ends are a date
 * of varying length on the left and a variable set of tools on the right, so
 * any in-flow centering would drift with them. This centers on the PANEL,
 * which is what "middle of the bar" means to the eye.
 *
 * pointer-events are handed back to the buttons only, so the transparent band
 * across the bar never eats a click meant for the header underneath.
 */
function CenteredPager({
  dateStr,
  onGo,
}: {
  dateStr: string;
  onGo: (target: string) => void;
}) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
      <div className="pointer-events-auto">
        <DayPager dateStr={dateStr} onGo={onGo} />
      </div>
    </div>
  );
}

const DAILY_CONTENT_CLASS =
  "editor-content daily-gutter mx-auto min-h-full w-full max-w-[48.125rem] px-4 pb-24 pt-3 text-base leading-[1.75] text-ink-300 outline-none max-md:[&_.timed-block[data-time-visible='1']::before]:hidden md:pb-16 md:pl-[4.125rem] md:pr-7 md:pt-5 md:text-[0.90625rem] 2xl:max-w-[56rem]";

/* The facing page: same document surface, dimmer and without the timeline
   gutter — it's a page you read, so it shouldn't compete with the one you're
   writing on. */
const FACING_CONTENT_CLASS =
  "editor-content mx-auto min-h-full w-full max-w-[36rem] px-5 pb-10 pt-4 text-[0.84375rem] leading-[1.7] text-ink-500 outline-none";

export function DailyNoteWidget({
  dateStr,
  isToday,
  note,
  prevNote,
  onGo,
  onNoteCreated,
  onSnapshot,
  onInvalidate,
  editorRef,
  onLinkedCountChange,
}: {
  /** Viewed local day; null while the client date is still resolving. */
  dateStr: string | null;
  isToday: boolean;
  /** The day's note from the home's window: undefined = still loading. */
  note: CachedDay;
  /** The previous day's note, for the book view's facing page. */
  prevNote: CachedDay;
  /** Flip to another day (no navigation — the home moves its own state). */
  onGo: (target: string) => void;
  /** A note was created for an empty day; fold it into the window's cache. */
  onNoteCreated: (dateStr: string, note: DailyNote) => void;
  /** Hand the live document back to the cache when flipping off this day. */
  onSnapshot: (dateStr: string, content: SerializedEditorState | null) => void;
  /** Drop a day from the cache when its document couldn't be captured. */
  onInvalidate: (dateStr: string) => void;
  editorRef: React.MutableRefObject<LexicalEditor | null>;
  /** Reports the number of linked-note cards in the doc (drives widgets). */
  onLinkedCountChange?: (count: number) => void;
}) {
  const [creating, setCreating] = useState(false);

  const createForDay = () => {
    if (!dateStr || creating) return;
    setCreating(true);
    getOrCreateTodayNoteAction(dateStr)
      .then((n) => onNoteCreated(dateStr, n))
      .catch((err) => console.error("[daily] create failed:", err))
      .finally(() => setCreating(false));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {!dateStr || note === undefined ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* max-md:hidden (here and on the real header): on phone the page
              header above the widget owns the date (design Turn 17a). */}
          <div className="flex flex-none items-center gap-2.5 border-b border-white/7 px-4 py-3 max-md:hidden">
            <div className="h-3.5 w-3.5 animate-pulse rounded bg-white/8" />
            <div className="h-3.5 w-28 animate-pulse rounded bg-white/8" />
          </div>
          <div className="mx-auto flex w-full max-w-[48.125rem] flex-1 flex-col gap-3 px-4 pt-3 md:pl-[4.125rem] md:pr-7 md:pt-5 2xl:max-w-[56rem]">
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
        <>
          {/* A blank day still gets the page header. Without it the pager
              would vanish exactly on the days you're most likely to be
              flipping past, leaving the browser back button as the only way
              out of an empty day. */}
          <div className="relative flex flex-none items-center gap-2.5 border-b border-white/7 px-4 py-3 max-md:hidden">
            <Sun className="h-3.5 w-3.5 text-ink-700" />
            <span className="text-sm font-semibold text-ink-300">
              {formatLongDate(dateStr)}
            </span>
            <CenteredPager dateStr={dateStr} onGo={onGo} />
          </div>
          {/* No note for the day — the card stack (week review on past
              Sundays) still gets its say above the empty state. isToday is
              forced false: without a loaded note there is no editor to
              scaffold into, matching the old cards' mount conditions. */}
          <div className="hidden md:contents">
            <DailyStack
              dateStr={dateStr}
              isToday={false}
              noteId={null}
              editorRef={editorRef}
              planEligible={false}
            />
          </div>
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
        </>
      ) : (
        <DailyEditor
          key={note.id}
          note={note}
          prevNote={prevNote}
          dateStr={dateStr}
          isToday={isToday}
          onGo={onGo}
          onSnapshot={onSnapshot}
          onInvalidate={onInvalidate}
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

type DailyView = "write" | "split" | "book";

function DailyEditor({
  note,
  prevNote,
  dateStr,
  isToday,
  onGo,
  onSnapshot,
  onInvalidate,
  editorRef,
  onLinkedCountChange,
}: {
  note: DailyNote;
  prevNote: CachedDay;
  dateStr: string;
  isToday: boolean;
  onGo: (target: string) => void;
  onSnapshot: (dateStr: string, content: SerializedEditorState | null) => void;
  onInvalidate: (dateStr: string) => void;
  editorRef: React.MutableRefObject<LexicalEditor | null>;
  onLinkedCountChange?: (count: number) => void;
}) {
  const { status, initialStateJSON, onEditorChange } = useNoteAutosave(
    note.id,
    note.content,
  );

  // Hand the document back to the day window as this editor goes away — which
  // is exactly when the user flips to another day. One serialization per flip,
  // not per keystroke. If the editor never registered, invalidate instead so
  // the day is refetched rather than served stale.
  useEffect(() => {
    const editor = editorRef.current;
    return () => {
      if (editor) onSnapshot(dateStr, editor.getEditorState().toJSON());
      else onInvalidate(dateStr);
    };
  }, [dateStr, editorRef, onSnapshot, onInvalidate]);
  const [linkedIds, setLinkedIds] = useState<string[]>(() =>
    collectLinkedIds(note.content),
  );
  const linkedCount = linkedIds.length;

  // "write" = full-width jot; "split" = jot text | the doc's linked-note
  // cards, pulled out so the writing stays clean; "book" = yesterday's page
  // facing today's. Sticky via localStorage.
  const [view, setView] = useState<DailyView>("write");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DAILY_VIEW_KEY);
      if (saved === "split" || saved === "book") setView(saved);
    } catch {
      // localStorage unavailable — default stands.
    }
  }, []);
  const switchView = (next: DailyView) => {
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
  const prevDateStr = addDays(dateStr, -1);

  return (
    <>
      <div className="relative flex flex-none items-center gap-2.5 border-b border-white/7 px-4 py-3 max-md:hidden">
        <Sun className="h-3.5 w-3.5 text-sage" />
        <span className="text-sm font-semibold text-ink-100">
          {formatLongDate(dateStr)}
        </span>
        <CenteredPager dateStr={dateStr} onGo={onGo} />
        <span className="text-[0.71875rem] text-ink-600">
          daily note
          {linkedCount > 0 &&
            ` · ${linkedCount} linked note${linkedCount === 1 ? "" : "s"}`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <SaveStatusChip status={status} compact />
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
              {/* lg-only: the spread needs room for two columns of prose, and
                  below that the facing page would squeeze the jot rather than
                  accompany it. */}
              <button
                type="button"
                aria-label="Book: yesterday facing today"
                aria-pressed={view === "book"}
                onClick={() => switchView("book")}
                className={`hidden h-[1.125rem] w-[1.125rem] items-center justify-center rounded lg:flex ${
                  view === "book" ? "bg-white/10 text-ink-200" : "text-ink-600 hover:text-ink-400"
                }`}
              >
                <BookOpen className="h-3 w-3" />
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

      {/* Outside the header on purpose: the header is desktop-only, and a jot
          that isn't saving is exactly the thing a phone must not hide. */}
      <SaveFailureBanner status={status} />

      {/* One-card interruption budget: DailyStack owns which of meeting /
          plan / week review / habits gets the single full slot; the rest
          collapse into its digest chip row. */}
      {/* Phone Today is the note itself. Meeting/plan/review/habit cards live
          behind the supporting day dock there instead of taking height from
          the writing surface. Desktop keeps the established interruption
          stack unchanged. */}
      <div className="hidden md:contents">
        <DailyStack
          dateStr={dateStr}
          isToday={isToday}
          noteId={note.id}
          editorRef={editorRef}
          planEligible={showPlanCard}
          onPlanInserted={() => setShowPlanCard(false)}
        />
      </div>


      <div className="flex min-h-[8rem] min-w-0 flex-1">
        {/* Facing page: the day before, read-only, to the LEFT of today — the
            spread you get when a planner falls open. It renders from the same
            prefetched window the pager flips through, so opening the book
            costs no fetch. Read-only by design: two live editors on one screen
            means two autosaves and two carets, and the left page is there to
            be referred to, not written in. Its header flips the whole spread
            back a day, which is how you page deeper into the past. */}
        {view === "book" && (
          <aside className="hidden min-h-0 w-[42%] max-w-[30rem] flex-none flex-col border-r border-white/7 bg-black/12 lg:flex">
            <button
              type="button"
              onClick={() => onGo(prevDateStr)}
              title={`Go to ${formatLongDate(prevDateStr)}`}
              className="flex flex-none items-center gap-2 border-b border-white/6 px-4 py-2 text-left hover:bg-white/4"
            >
              <span className="text-[0.71875rem] font-medium text-ink-400">
                {formatLongDate(prevDateStr)}
              </span>
              <span className="text-[0.625rem] uppercase tracking-[0.08em] text-ink-700">
                facing page
              </span>
            </button>
            {prevNote === undefined ? (
              <div className="flex flex-1 flex-col gap-3 p-5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-3 animate-pulse rounded bg-white/6"
                    style={{ width: `${80 - i * 14}%` }}
                  />
                ))}
              </div>
            ) : prevNote === null ? (
              <p className="flex flex-1 items-center justify-center p-6 text-center text-[0.71875rem] text-ink-700">
                Nothing was written on {formatLongDate(prevDateStr)}.
              </p>
            ) : (
              <Editor
                key={prevNote.id}
                variant="daily"
                readOnly
                initialStateJSON={
                  prevNote.content ? JSON.stringify(prevNote.content) : null
                }
                contentClassName={FACING_CONTENT_CLASS}
                noteId={prevNote.id}
                noteTitle={prevNote.title}
              />
            )}
          </aside>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <NoteTaskContext.Provider value={noteTaskCtx}>
            <Editor
              variant="daily"
              splitLinks={view === "split"}
              initialStateJSON={initialStateJSON}
              onChange={handleChange}
              contentClassName={DAILY_CONTENT_CLASS}
              editorRef={editorRef}
              // Recorded on the anchor any inserted card leaves on its target,
              // so that note can say which day's jot the writing came from.
              noteId={note.id}
              noteTitle={note.title}
              dailyDateStr={dateStr}
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
