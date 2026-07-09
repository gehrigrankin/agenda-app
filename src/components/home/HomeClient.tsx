"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import type { LexicalEditor } from "lexical";
import { Inbox, Loader2, Plus } from "lucide-react";

import { createNoteAction } from "@/app/app/actions";
import {
  NotePreviewProvider,
  QuickViewContext,
  usePreviewInvalidator,
} from "@/components/notes/NotePreviewProvider";
import { useNoteDock } from "@/components/notes/NoteDockProvider";
import { formatLongDate, localDateString } from "@/lib/dates";
import { DailyNoteWidget } from "./DailyNoteWidget";
import { LinkedTodayWidget } from "./LinkedTodayWidget";
import { MiniCalendar } from "./MiniCalendar";
import { PinnedBoardWidget, type BoardData } from "./PinnedBoardWidget";
import { TasksWidget } from "./TasksWidget";
import { WeekReviewCard } from "./WeekReviewCard";
import { YesterdayWidget } from "./YesterdayWidget";

/**
 * The daily-note home (design Turn 10): a fixed grid over the dotted canvas —
 * daily note dominant, a bottom widget row (calendar / pinned board /
 * yesterday), and a right column (tasks / linked today). `viewDate` (?d=)
 * views a past day; today is always the default and future dates clamp back.
 */

/* flex flex-col: widget roots use flex-1 to fill the panel — h-full can't
   resolve when the panel is sized by min-height in the stacked layout. */
const SURFACE =
  "flex flex-col overflow-hidden rounded-2xl border border-white/9 bg-panel/94 shadow-[0_14px_34px_rgba(0,0,0,0.35)]";

function RailTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex-1 rounded-lg px-2 py-1.5 text-[0.71875rem] font-medium transition-colors ${
        active ? "bg-sage/16 text-sage" : "text-ink-400 hover:bg-white/6"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * Phone-only home header (design Turn 17a): the viewed day as the page title,
 * with Inbox (badged when items wait) and new-note buttons on the right. On
 * phone the daily note's own header row hides, so this is THE date header.
 */
function PhoneHomeHeader({
  dateStr,
  inboxCount,
}: {
  dateStr: string | null;
  inboxCount: number;
}) {
  const [creating, startCreate] = useTransition();
  const CIRCLE =
    "relative flex h-11 w-11 flex-none items-center justify-center rounded-full border border-white/8 bg-white/5";
  return (
    <header className="flex items-start justify-between gap-3 md:hidden">
      <div className="flex min-w-0 flex-col gap-0.5">
        {dateStr === null ? (
          <div className="mt-1 h-5 w-40 animate-pulse rounded bg-white/8" />
        ) : (
          <h1 className="truncate text-[1.125rem] font-semibold text-ink-100">
            {formatLongDate(dateStr)}
          </h1>
        )}
        <span className="text-[0.71875rem] text-ink-600">daily note</span>
      </div>
      <div className="flex items-center gap-2.5">
        <Link href="/app/inbox" aria-label="Open inbox" className={CIRCLE}>
          <Inbox className="h-[1.1875rem] w-[1.1875rem] text-ink-300" />
          {inboxCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-sage px-1 text-[0.65625rem] font-semibold text-sage-ink">
              {inboxCount}
            </span>
          )}
        </Link>
        <button
          type="button"
          aria-label="New note"
          disabled={creating}
          onClick={() =>
            startCreate(async () => {
              try {
                await createNoteAction(); // redirects to the new note
              } catch (err) {
                console.error("[home] create failed:", err);
              }
            })
          }
          className={`${CIRCLE} disabled:opacity-60`}
        >
          {creating ? (
            <Loader2 className="h-[1.1875rem] w-[1.1875rem] animate-spin text-ink-300" />
          ) : (
            <Plus className="h-[1.1875rem] w-[1.1875rem] text-ink-300" />
          )}
        </button>
      </div>
    </header>
  );
}

export function HomeClient({
  viewDate,
  board,
  inboxCount,
}: {
  viewDate: string | null;
  board: BoardData | null;
  inboxCount: number;
}) {
  return (
    <NotePreviewProvider>
      <HomeGrid viewDate={viewDate} board={board} inboxCount={inboxCount} />
    </NotePreviewProvider>
  );
}

function HomeGrid({
  viewDate,
  board,
  inboxCount,
}: {
  viewDate: string | null;
  board: BoardData | null;
  inboxCount: number;
}) {
  // Today is CLIENT-local; resolve after mount so SSR stays deterministic.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    setToday(localDateString());
  }, []);

  // Honor any valid ?d= (past OR future); today is the default. page.tsx has
  // already regex-validated the param, so viewDate is a real YYYY-MM-DD or null.
  const viewed = today === null ? null : (viewDate ?? today);
  const isToday = viewed !== null && viewed === today;
  const isFuture = viewed !== null && today !== null && viewed > today;

  const editorRef = useRef<LexicalEditor | null>(null);
  const [dailyNoteId, setDailyNoteId] = useState<string | null>(null);
  // Bumped when the daily doc's linked-card count changes or a quick view
  // closes — LinkedTodayWidget refetches on it.
  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Which rail widget shows on small windows (tabs replace stacking there).
  const [railTab, setRailTab] = useState<"tasks" | "linked">("tasks");

  const invalidatePreview = usePreviewInvalidator();

  // The note dock lives in the app shell (it survives navigation); the home
  // routes note-link clicks into it and refreshes widgets when a tab closes.
  const dock = useNoteDock();
  const dockOpen = dock?.open;
  const dockOnClose = dock?.onClose;
  useEffect(() => {
    if (!dockOnClose) return;
    return dockOnClose((id) => {
      // Edits made in the dock window should reflect in cards/widgets.
      invalidatePreview?.(id);
      bumpRefresh();
    });
  }, [dockOnClose, invalidatePreview, bumpRefresh]);
  const quickViewCtx = useMemo(
    () => (dockOpen ? { open: dockOpen } : null),
    [dockOpen],
  );

  return (
    <QuickViewContext.Provider value={quickViewCtx}>
      <div className="relative h-full min-h-0">
        {/* Three layout modes on one grid (tracks defined by .home-grid in
            globals.css — plain CSS, since the arbitrary grid-rows utilities
            with calc() silently failed to compile).
            ≥xl: the fixed no-scroll dashboard — daily note + bottom row on the
            left, tasks/linked rail spanning the full right edge.
            md–xl (small windows): screen one is the working set — daily note
            with the rail beside it, sized to the viewport — and the
            calendar/board/yesterday row lives fully below the fold; page
            scrolls. <md (phones, design Turn 17a): writing first — header,
            habit chips + daily note, agenda peek, due-today card. The rail
            widgets and the bottom row retire on phone. */}
        <div className="bubble-canvas-grid home-grid grid h-full min-h-0 grid-cols-1 content-start gap-3.5 overflow-y-auto p-4 md:content-stretch md:pl-[5.75rem] xl:overflow-hidden xl:pb-5 xl:pr-5">
          <PhoneHomeHeader dateStr={viewed} inboxCount={inboxCount} />

          {/* Daily note (row 1, left) — week-review card stacks above it on
              Sundays only; min-h-0 lets it yield to the note's flex-1. */}
          {/* max-md:min-h forces the auto grid row open on phone — with
              min-h-0 alone the row's intrinsic contribution is 0 and the
              column collapses under the cards below (Chromium sizing). */}
          <div className="flex min-h-0 flex-col gap-3.5 max-md:min-h-[26.25rem] md:col-start-1 md:row-start-1">
            {/* A retro only makes sense for a week that has happened. */}
            {!isFuture && (
              <WeekReviewCard
                viewedDate={viewed}
                editorRef={editorRef}
                dailyNoteId={dailyNoteId}
              />
            )}
            {/* Phone: a fixed height, not min-h + flex-1 — in an auto grid
                row Chromium sizes the flex column ignoring a basis-0 child's
                min-height, collapsing the row to 0 and overlapping the cards
                below. md+ rows are viewport-sized, where flex-1 is correct. */}
            <div
              className={`${SURFACE} flex-1 max-md:h-[26.25rem] max-md:flex-none md:min-h-0`}
            >
              <DailyNoteWidget
                dateStr={viewed}
                isToday={isToday}
                editorRef={editorRef}
                onNoteLoaded={setDailyNoteId}
                onLinkedCountChange={bumpRefresh}
              />
            </div>
          </div>

          {/* Tasks / linked rail (row 1, right; full height at xl). min-h-0
              only at md+ where the grid row is viewport-sized — on phones the
              rail must keep its natural height or it collapses to nothing.
              Below xl the two widgets share one slot behind tabs; at xl the
              tab bar hides and both panels show stacked. */}
          <div className="flex flex-col gap-3.5 md:col-start-2 md:row-start-1 md:min-h-0 xl:row-span-2">
            <div className="flex flex-none gap-1 rounded-xl border border-white/9 bg-bar/92 p-1 max-md:hidden xl:hidden">
              <RailTab
                label="Tasks"
                active={railTab === "tasks"}
                onClick={() => setRailTab("tasks")}
              />
              <RailTab
                label="Linked today"
                active={railTab === "linked"}
                onClick={() => setRailTab("linked")}
              />
            </div>
            {/* max-md:contents: on phone the panel box dissolves and the
                widget's own phone cards (agenda peek + due today) become
                direct children of this column — one instance, one fetch. */}
            <div
              className={`${SURFACE} min-h-[16.25rem] flex-1 max-md:contents md:min-h-0 ${
                railTab !== "tasks" ? "md:max-xl:hidden" : ""
              }`}
            >
              <TasksWidget
                dateStr={viewed ?? undefined}
                expandHref="/app/tasks"
              />
            </div>
            <div
              className={`${SURFACE} min-h-[10rem] flex-1 max-md:hidden md:min-h-0 ${
                railTab !== "linked" ? "md:max-xl:hidden" : ""
              }`}
            >
              <LinkedTodayWidget
                dailyNoteId={dailyNoteId}
                dateStr={viewed}
                refreshKey={refreshKey}
                editorRef={editorRef}
              />
            </div>
          </div>

          {/* Calendar / board / yesterday row (row 2; below the fold on small
              windows). min-h, not h: if the browser inflates small text
              (minimum-font-size setting), the calendar grid grows and the row
              must grow with it instead of clipping the last week. */}
          <div className="flex gap-3.5 max-md:hidden md:col-span-2 md:min-h-[9.875rem] xl:col-span-1">
            <div
              className={`${SURFACE} rounded-[0.8125rem] max-md:min-h-[11rem] md:w-[16rem] md:flex-none 2xl:w-[18rem]`}
            >
              <MiniCalendar today={today} />
            </div>
            <div
              className={`${SURFACE} rounded-[0.8125rem] max-md:h-[7.5rem] md:min-w-0 md:flex-1`}
            >
              <PinnedBoardWidget board={board} />
            </div>
            <div className="flex flex-col rounded-[0.8125rem] border border-white/7 bg-panel/70 max-md:h-[6.25rem] md:w-[13.75rem] md:flex-none 2xl:w-[16rem]">
              <YesterdayWidget today={today} />
            </div>
          </div>
        </div>
      </div>
    </QuickViewContext.Provider>
  );
}
