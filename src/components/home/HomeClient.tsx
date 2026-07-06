"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LexicalEditor } from "lexical";

import {
  NotePreviewProvider,
  QuickViewContext,
  usePreviewInvalidator,
} from "@/components/notes/NotePreviewProvider";
import { QuickViewOverlay } from "@/components/notes/QuickViewOverlay";
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

  const [quickViewNoteId, setQuickViewNoteId] = useState<string | null>(null);
  const invalidatePreview = usePreviewInvalidator();
  const quickViewCtx = useMemo(
    () => ({ open: (noteId: string) => setQuickViewNoteId(noteId) }),
    [],
  );
  const closeQuickView = useCallback(() => {
    setQuickViewNoteId((current) => {
      // Refresh the originating card + widgets with whatever was edited.
      if (current) invalidatePreview?.(current);
      return null;
    });
    bumpRefresh();
  }, [invalidatePreview, bumpRefresh]);

  return (
    <QuickViewContext.Provider value={quickViewCtx}>
      <div className="relative h-full min-h-0">
        {/* Two layout modes. ≥xl: the fixed no-scroll dashboard (main column +
            right rail side by side). Below xl — small windows, split screens,
            phones — everything stacks and the page scrolls; widgets keep their
            natural height (no flex-1/min-h-0, which shrank them into each
            other on phones). xl, not lg: at ~1024–1279px the dashboard has no
            room to breathe. */}
        <div className="bubble-canvas-grid flex h-full min-h-0 gap-3.5 overflow-y-auto p-4 max-xl:flex-col md:pl-[5.75rem] xl:overflow-hidden xl:pb-5 xl:pr-5">
          {/* Main column */}
          <div className="flex min-w-0 flex-col gap-3.5 xl:min-h-0 xl:flex-1">
            <div className={`${SURFACE} min-h-[26.25rem] xl:min-h-0 xl:flex-1`}>
              <DailyNoteWidget
                dateStr={viewed}
                isToday={isToday}
                editorRef={editorRef}
                onNoteLoaded={setDailyNoteId}
                onLinkedCountChange={bumpRefresh}
              />
            </div>

            {/* Bottom widget row. min-h, not h: if the browser inflates small
                text (minimum-font-size setting), the calendar grid grows and
                the row must grow with it instead of clipping the last week. */}
            <div className="flex flex-none gap-3.5 max-md:flex-col md:min-h-[9.875rem]">
              <div
                className={`${SURFACE} rounded-[0.875rem] max-md:min-h-[9.875rem] md:w-[9.875rem] md:flex-none`}
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

          {/* Right column */}
          <div className="flex flex-none flex-col gap-3.5 max-xl:w-full xl:w-[18.75rem]">
            <div className={`${SURFACE} min-h-[16.25rem] flex-1 xl:min-h-0`}>
              <TasksWidget
                dateStr={viewed ?? undefined}
                expandHref="/app/tasks"
              />
            </div>
            <div className={`${SURFACE} min-h-[10rem] flex-1 xl:min-h-0`}>
              <LinkedTodayWidget
                dailyNoteId={dailyNoteId}
                dateStr={viewed}
                refreshKey={refreshKey}
                editorRef={editorRef}
              />
            </div>
          </div>
        </div>

        {quickViewNoteId && (
          <QuickViewOverlay
            noteId={quickViewNoteId}
            onClose={closeQuickView}
          />
        )}
      </div>
    </QuickViewContext.Provider>
  );
}
