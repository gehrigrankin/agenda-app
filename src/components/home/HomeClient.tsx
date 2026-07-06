"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LexicalEditor } from "lexical";

import {
  NotePreviewProvider,
  QuickViewContext,
  usePreviewInvalidator,
} from "@/components/notes/NotePreviewProvider";
import { useNoteDock } from "@/components/notes/NoteDockProvider";
import { localDateString } from "@/lib/dates";
import { DailyNoteWidget } from "./DailyNoteWidget";
import { LinkedTodayWidget } from "./LinkedTodayWidget";
import { MiniCalendar } from "./MiniCalendar";
import { PinnedBoardWidget, type BoardData } from "./PinnedBoardWidget";
import { TasksWidget } from "./TasksWidget";
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

export function HomeClient({
  viewDate,
  board,
}: {
  viewDate: string | null;
  board: BoardData | null;
}) {
  return (
    <NotePreviewProvider>
      <HomeGrid viewDate={viewDate} board={board} />
    </NotePreviewProvider>
  );
}

function HomeGrid({
  viewDate,
  board,
}: {
  viewDate: string | null;
  board: BoardData | null;
}) {
  // Today is CLIENT-local; resolve after mount so SSR stays deterministic.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    setToday(localDateString());
  }, []);

  const viewed =
    today === null ? null : viewDate && viewDate < today ? viewDate : today;
  const isToday = viewed !== null && viewed === today;

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
            scrolls. <md (phones): everything stacks at natural height. */}
        <div className="bubble-canvas-grid home-grid grid h-full min-h-0 grid-cols-1 content-start gap-3.5 overflow-y-auto p-4 md:content-stretch md:pl-[5.75rem] xl:overflow-hidden xl:pb-5 xl:pr-5">
          {/* Daily note (row 1, left) */}
          <div
            className={`${SURFACE} min-h-[26.25rem] md:col-start-1 md:row-start-1 md:min-h-0`}
          >
            <DailyNoteWidget
              dateStr={viewed}
              isToday={isToday}
              editorRef={editorRef}
              onNoteLoaded={setDailyNoteId}
              onLinkedCountChange={bumpRefresh}
            />
          </div>

          {/* Tasks / linked rail (row 1, right; full height at xl). min-h-0
              only at md+ where the grid row is viewport-sized — on phones the
              rail must keep its natural height or it collapses to nothing.
              Below xl the two widgets share one slot behind tabs; at xl the
              tab bar hides and both panels show stacked. */}
          <div className="flex flex-col gap-3.5 md:col-start-2 md:row-start-1 md:min-h-0 xl:row-span-2">
            <div className="flex flex-none gap-1 rounded-xl border border-white/9 bg-bar/92 p-1 xl:hidden">
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
            <div
              className={`${SURFACE} min-h-[16.25rem] flex-1 md:min-h-0 ${
                railTab !== "tasks" ? "max-xl:hidden" : ""
              }`}
            >
              <TasksWidget
                dateStr={viewed ?? undefined}
                expandHref="/app/tasks"
              />
            </div>
            <div
              className={`${SURFACE} min-h-[10rem] flex-1 md:min-h-0 ${
                railTab !== "linked" ? "max-xl:hidden" : ""
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
          <div className="flex gap-3.5 max-md:flex-col md:col-span-2 md:min-h-[9.875rem] xl:col-span-1">
            <div
              className={`${SURFACE} rounded-[0.875rem] max-md:min-h-[11rem] md:w-[16rem] md:flex-none`}
            >
              <MiniCalendar today={today} />
            </div>
            <div
              className={`${SURFACE} rounded-[0.875rem] max-md:h-[7.5rem] md:min-w-0 md:flex-1`}
            >
              <PinnedBoardWidget board={board} />
            </div>
            <div className="flex flex-col rounded-[0.875rem] border border-white/7 bg-panel/70 max-md:h-[6.25rem] md:w-[13.75rem] md:flex-none">
              <YesterdayWidget today={today} />
            </div>
          </div>
        </div>
      </div>
    </QuickViewContext.Provider>
  );
}
