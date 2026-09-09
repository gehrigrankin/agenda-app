"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LexicalEditor } from "lexical";

import type { AgendaTaskResult, AgendaWeekResult } from "@/app/app/actions";
import {
  NotePreviewProvider,
  QuickViewContext,
  usePreviewInvalidator,
} from "@/components/notes/NotePreviewProvider";
import { useNoteDock } from "@/components/notes/NoteDockProvider";
import { minutesToHHMM } from "@/lib/agenda-lines";
import { DATE_STR_RE, addDays, localDateString, weekDays } from "@/lib/dates";
import { useAgendaWeek } from "@/lib/hooks/use-agenda-week";
import { useDailyNoteWindow } from "@/lib/hooks/use-daily-note-window";
import { useDaySwipe } from "@/lib/hooks/use-day-swipe";
import type { RangeCalendarEvent } from "@/server/calendar";
import type { UserEvent } from "@/server/events";
import { AgendaDay } from "./AgendaDay";
import { CalendarDayDetailPanel } from "./CalendarDayDetailPanel";
import { DailyNoteWidget } from "./DailyNoteWidget";
import { DailyStack } from "./DailyStack";
import { HabitStrip } from "./HabitStrip";
import { LinkedTodayWidget } from "./LinkedTodayWidget";
import { MiniCalendar } from "./MiniCalendar";
import { TasksWidget } from "./TasksWidget";
import { TodayContextDock, type TodayContextTab } from "./TodayContextDock";
import { WeekStrip, type StripDay, type StripItem } from "./WeekStrip";
import { YesterdayWidget } from "./YesterdayWidget";

/**
 * The home is a paper AGENDA — the kind with a week across the top, the open
 * day underneath with its subjects printed down the page, and a rail of
 * context beside it.
 *
 * Row 1, both columns: the WEEK STRIP, a fixed Mon–Sun spread. It's the page
 * turn: the arrows flip whole weeks, a cell opens that day below. Row 2, left:
 * the OPEN DAY (AgendaDay) — a schedule band, then the daily note as the page.
 * The agenda's pinned lines (Work / Gym / Errands) are PRINTED INTO THE NOTE
 * as section headings the moment an empty day is opened, so writing under
 * "Work" is writing in the note — prose, bullets, tasks, whatever — not filling
 * a widget. Row 2, right: the rail — the tasks widget (its "Due today" grouped
 * on those same lines; a task written under a section in the note carries the
 * section's tag, so it lands on the matching line here), the meeting/plan/
 * review card stack above it, yesterday's recap under it, then linked notes
 * and the month calendar. Tasks stay in the rail, not on the page, on purpose.
 *
 * One fetch per week (`useAgendaWeek`) draws the strip; the tasks widget keeps
 * its own due/done reads and announces its writes with TASKS_CHANGED_EVENT so
 * the strip refetches. The daily note keeps its own prefetched window
 * (`useDailyNoteWindow`) — a document, not a row; flipping days stays a
 * re-render, not a load.
 *
 * `viewDate` (?d=) seeds the viewed day; today is the default. The viewed day
 * is CLIENT state — flipping is setState against warm caches with the URL
 * updated underneath by the history API, so days stay shareable and Back
 * walks them, without a server round trip per page turn.
 *
 * Phone (<md): the strip's header (week label, arrows, Today) is the page
 * header; cells show dots instead of titles; the open day scrolls; the rail
 * lives behind the bottom dock's Tasks / Linked / Calendar tabs.
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

/** A quick-add event covers `dateStr` when it falls inside the event's span. */
function eventCovers(e: UserEvent, dateStr: string): boolean {
  return e.localDate <= dateStr && dateStr <= (e.endLocalDate ?? e.localDate);
}

/** Local "HH:MM" of an ICS instant; null for all-day or unparseable. */
function icsLocalTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

/** The local due day of an agenda task (dueAt is that day's midnight UTC). */
function dueDay(task: AgendaTaskResult): string {
  return task.dueAt.slice(0, 10);
}

/**
 * One strip cell per day of the week: events first (all-day, then by time),
 * then open tasks, then done ones — the order a planner reads in, and the
 * order the strip truncates from.
 */
function buildStripDays(
  weekStart: string,
  week: AgendaWeekResult | null,
  ics: RangeCalendarEvent[],
): StripDay[] {
  return weekDays(weekStart).map((dateStr) => {
    const allDay: StripItem[] = [];
    const timed: StripItem[] = [];
    for (const e of week?.events ?? []) {
      if (!eventCovers(e, dateStr)) continue;
      const time = e.startMin === null ? null : minutesToHHMM(e.startMin);
      (time === null ? allDay : timed).push({
        id: `event-${e.id}`,
        title: e.title,
        kind: "event",
        done: false,
        time,
      });
    }
    for (const e of ics) {
      if (e.date !== dateStr) continue;
      const time = e.allDay ? null : icsLocalTime(e.startIso);
      (time === null ? allDay : timed).push({
        id: `ics-${e.uid}-${e.date}`,
        title: e.title,
        kind: "event",
        done: false,
        time,
      });
    }
    timed.sort((a, b) => (a.time as string).localeCompare(b.time as string));

    const open: StripItem[] = [];
    const done: StripItem[] = [];
    for (const t of week?.tasks ?? []) {
      if (dueDay(t) !== dateStr) continue;
      (t.completedAt === null ? open : done).push({
        id: t.id,
        title: t.title,
        kind: "task",
        done: t.completedAt !== null,
        time: t.remindAt,
      });
    }
    return {
      dateStr,
      items: [...allDay, ...timed, ...open, ...done],
      hasNote: week?.noteDates.includes(dateStr) ?? false,
    };
  });
}

export function HomeClient({
  viewDate,
  cacheScope,
}: {
  viewDate: string | null;
  cacheScope: string;
}) {
  return (
    <NotePreviewProvider>
      <HomeGrid viewDate={viewDate} cacheScope={cacheScope} />
    </NotePreviewProvider>
  );
}

function HomeGrid({
  viewDate,
  cacheScope,
}: {
  viewDate: string | null;
  cacheScope: string;
}) {
  // Today is CLIENT-local; resolve after mount so SSR stays deterministic.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    setToday(localDateString());
  }, []);

  // The viewed day is CLIENT state, not the URL (see the header comment).
  const [viewedDate, setViewedDate] = useState<string | null>(viewDate);
  const viewed = today === null ? null : (viewedDate ?? today);
  const isToday = viewed !== null && viewed === today;

  // A day arriving from OUTSIDE this component — a link into `/app?d=…`, or
  // plain `/app` from the sidebar — is a real navigation, and the prop is the
  // only signal of it. Synced unconditionally, null included: clicking Home
  // while parked on last Tuesday means "take me to today".
  useEffect(() => {
    setViewedDate(viewDate);
  }, [viewDate]);

  const goToDay = useCallback(
    (target: string) => {
      setViewedDate(target);
      // pushState, not router.push: same route, no server round trip, but the
      // entry lands in history so Back walks day by day the way it reads.
      const url =
        today !== null && target === today ? "/app" : `/app?d=${target}`;
      window.history.pushState(null, "", url);
    },
    [today],
  );

  // Back/forward: the URL is the record of which day you were on.
  useEffect(() => {
    const onPop = () => {
      const d = new URLSearchParams(window.location.search).get("d");
      setViewedDate(d && DATE_STR_RE.test(d) ? d : null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // The week's tasks / events / lines — what the strip draws from.
  const agenda = useAgendaWeek(viewed, today);
  const { week, ics, weekStart } = agenda;
  const lines = useMemo(() => week?.lines ?? [], [week]);

  const stripDays = useMemo(
    () => (weekStart ? buildStripDays(weekStart, week, ics) : []),
    [weekStart, week, ics],
  );
  const dayEvents = useMemo(
    () =>
      viewed ? (week?.events ?? []).filter((e) => eventCovers(e, viewed)) : [],
    [week, viewed],
  );
  const dayIcs = useMemo(
    () => (viewed ? ics.filter((e) => e.date === viewed) : []),
    [ics, viewed],
  );

  // Warm neighbours of the viewed day so the next flip is instant.
  const {
    get: getDay,
    put: putDay,
    snapshot: snapshotDay,
    invalidate: invalidateDay,
  } = useDailyNoteWindow(viewed, today, cacheScope);
  const note = getDay(viewed);
  // The book view's facing page — already in the window.
  const prevNote = getDay(viewed === null ? null : addDays(viewed, -1));
  const dailyNoteId = note?.id ?? null;

  // md+ is where the rail is a column and the day panel takes the swipe;
  // below it the phone dock owns the rail and the whole page is the day.
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const sync = () => setIsDesktop(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  // Swipe the page: trackpad, Magic Mouse, or touch. Bound to the day panel
  // rather than the window so a horizontal scroll over the rail is still just
  // a scroll.
  const swipeRef = useDaySwipe({
    onPrev: () => viewed && goToDay(addDays(viewed, -1)),
    onNext: () => viewed && goToDay(addDays(viewed, 1)),
    enabled: viewed !== null && isDesktop,
  });

  const editorRef = useRef<LexicalEditor | null>(null);
  // Bumped when the daily doc's linked-card count changes or a quick view
  // closes — LinkedTodayWidget refetches on it.
  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // The morning plan card lives in the rail now; the embedded editor reports
  // whether today's note is still empty enough to offer it.
  const [planEligible, setPlanEligible] = useState(false);

  // Which rail widget shows on small windows (tabs replace stacking there).
  const [railTab, setRailTab] = useState<TodayContextTab>("tasks");
  const [phoneContextOpen, setPhoneContextOpen] = useState(false);
  const [linkedCount, setLinkedCount] = useState(0);
  useEffect(() => {
    if (!dailyNoteId) setLinkedCount(0);
  }, [dailyNoteId]);
  const [calendarSelectedDate, setCalendarSelectedDate] = useState<
    string | null
  >(null);
  const [taskCount, setTaskCount] = useState<number | null>(null);
  const [habitStatus, setHabitStatus] = useState<{
    count: number;
    done: number;
  } | null>(null);
  useEffect(() => {
    if (viewed) setCalendarSelectedDate(viewed);
  }, [viewed]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("today-context-tab");
      if (saved === "tasks" || saved === "linked" || saved === "calendar") {
        setRailTab(saved);
      }
    } catch {
      // Best-effort preference; the panel intentionally starts closed.
    }
  }, []);
  const selectRailTab = useCallback((tab: TodayContextTab) => {
    setRailTab(tab);
    try {
      localStorage.setItem("today-context-tab", tab);
    } catch {
      // localStorage may be unavailable in a hardened browser.
    }
  }, []);
  const reportLinkedCount = useCallback(
    (count: number) => {
      setLinkedCount(count);
      bumpRefresh();
    },
    [bumpRefresh],
  );
  const reportHabitStatus = useCallback(
    (available: boolean | null, count = 0, done = 0) => {
      setHabitStatus(available ? { count, done } : null);
    },
    [],
  );

  const invalidatePreview = usePreviewInvalidator();

  // The note dock lives in the app shell (it survives navigation); the home
  // routes note-link clicks into it and refreshes widgets when a tab closes.
  const dock = useNoteDock();
  const dockOpen = dock?.open;
  const dockOnClose = dock?.onClose;
  useEffect(() => {
    if (!dockOnClose) return;
    return dockOnClose((id) => {
      invalidatePreview?.(id);
      bumpRefresh();
    });
  }, [dockOnClose, invalidatePreview, bumpRefresh]);
  const quickViewCtx = useMemo(
    () => (dockOpen ? { open: dockOpen } : null),
    [dockOpen],
  );

  const notesSlot = (
    <DailyNoteWidget
      dateStr={viewed}
      isToday={isToday}
      note={note}
      prevNote={prevNote}
      onGo={goToDay}
      onNoteCreated={putDay}
      onSnapshot={snapshotDay}
      onInvalidate={invalidateDay}
      editorRef={editorRef}
      onLinkedCountChange={reportLinkedCount}
      embedded
      onPlanEligibleChange={setPlanEligible}
      lines={lines}
    />
  );

  // The rail's Tasks panel: the one-card interruption stack (meeting > plan >
  // week review, habits in its digest) on top, the tasks widget printed on
  // the agenda's lines, yesterday's recap at the foot. Built once and mounted
  // in ONE place per breakpoint — the column at md+, the dock sheet below —
  // so the cards' fetches and dismissals aren't doubled.
  const tasksPanel = viewed && (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-none">
        <DailyStack
          variant="rail"
          dateStr={viewed}
          isToday={isToday}
          noteId={dailyNoteId}
          editorRef={editorRef}
          planEligible={planEligible}
          onPlanInserted={() => setPlanEligible(false)}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col max-md:gap-3">
        <TasksWidget
          dateStr={viewed}
          expandHref="/app/tasks"
          lines={lines}
          onOpenCountChange={setTaskCount}
        />
      </div>
      <div className="flex min-h-[6.5rem] flex-none flex-col border-t border-white/7 max-md:mt-3 max-md:rounded-2xl max-md:border max-md:border-white/8 max-md:bg-white/3">
        <YesterdayWidget today={today} />
      </div>
    </div>
  );

  return (
    <QuickViewContext.Provider value={quickViewCtx}>
      <div className="relative h-full min-h-0">
        {/* Tracks come from .home-grid in globals.css (plain CSS — arbitrary
            grid-rows utilities with calc() silently failed to compile).
            ≥md: row 1 = the strip across both columns; row 2 = the open day
            beside the rail, viewport-sized, so the page never scrolls.
            <md: strip header, the open day (scrolls), the dock's tab bar. */}
        <div className="bubble-canvas-grid home-grid grid h-full min-h-0 grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] content-start gap-2.5 overflow-hidden p-3 md:grid-rows-none md:content-stretch md:gap-3.5 md:overflow-hidden md:pb-5 md:pl-[5.75rem] md:pr-5 md:pt-4">
          {/* Week strip (row 1, both columns). On phone it doubles as the page
              header: full-bleed on the bar colour, no panel chrome. */}
          <div
            className={`${SURFACE} max-md:-mx-3 max-md:-mt-3 max-md:rounded-none max-md:border-0 max-md:border-b max-md:border-white/8 max-md:bg-bar max-md:shadow-none md:col-span-2 md:row-start-1`}
          >
            {today && viewed && weekStart ? (
              <WeekStrip
                days={stripDays}
                today={today}
                viewed={viewed}
                onGo={goToDay}
                loading={week === null}
              />
            ) : (
              <div className="flex flex-col gap-2 px-3 pb-2 pt-2.5">
                <div className="h-3.5 w-40 animate-pulse rounded bg-white/8" />
                <div className="h-[3.75rem] animate-pulse rounded bg-white/5 md:h-[5.5rem]" />
              </div>
            )}
          </div>

          {/* The open day (row 2, left). overscroll-x-contain is half of the
              swipe: it stops macOS turning a horizontal flick into browser
              back/forward before the handler ever sees it. */}
          <div
            ref={swipeRef}
            className={`${SURFACE} min-h-0 overscroll-x-contain max-md:-mx-3 max-md:-mb-2.5 max-md:rounded-none max-md:border-0 max-md:bg-panel max-md:shadow-none md:col-start-1 md:row-start-2`}
          >
            {today && viewed ? (
              <>
                {/* A week that failed to load says so, with a way back; the
                    note underneath still works. */}
                {!agenda.loading && week === null && (
                  <div className="flex flex-none items-center gap-2 border-b border-overdue/20 bg-overdue/5 px-5 py-2 text-[0.71875rem] text-ink-300">
                    Couldn’t load this week’s agenda.
                    <button
                      type="button"
                      onClick={agenda.refresh}
                      className="rounded-md bg-white/6 px-2 py-0.5 font-medium text-ink-200 hover:bg-white/10"
                    >
                      Retry
                    </button>
                  </div>
                )}
                <AgendaDay
                  dateStr={viewed}
                  today={today}
                  events={dayEvents}
                  icsEvents={dayIcs}
                  loading={week === null && agenda.loading}
                  notesSlot={notesSlot}
                />
              </>
            ) : (
              <div className="flex flex-col gap-3 px-5 pt-4">
                <div className="h-5 w-48 animate-pulse rounded bg-white/8" />
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-3 animate-pulse rounded bg-white/6"
                    style={{ width: `${85 - i * 12}%` }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* The rail (row 2, right). min-h-0 only at md+ where the grid row
              is viewport-sized. Below xl the panels share one slot behind
              tabs; at xl the tab bar hides and they stack. Visibility is ONE
              display class per breakpoint band, never a `contents` + `hidden`
              pair — both set `display`, so the pair's winner comes down to
              stylesheet order rather than intent. */}
          <div className="contents md:flex md:flex-col md:gap-3.5 md:col-start-2 md:row-start-2 md:min-h-0">
            <div className="hidden flex-none gap-1 rounded-xl border border-white/9 bg-bar/92 p-1 md:flex xl:hidden">
              <RailTab
                label="Tasks"
                active={railTab === "tasks"}
                onClick={() => selectRailTab("tasks")}
              />
              <RailTab
                label="Linked"
                active={railTab === "linked"}
                onClick={() => selectRailTab("linked")}
              />
              <RailTab
                label="Calendar"
                active={railTab === "calendar"}
                onClick={() => selectRailTab("calendar")}
              />
            </div>

            <div
              className={`${SURFACE} min-h-[16.25rem] flex-1 md:min-h-0 ${
                railTab === "tasks"
                  ? "hidden md:flex"
                  : "hidden md:flex md:max-xl:hidden"
              }`}
            >
              {isDesktop && tasksPanel}
            </div>
            <div
              className={`${SURFACE} min-h-[10rem] flex-1 md:min-h-0 ${
                railTab !== "linked"
                  ? "hidden md:flex md:max-xl:hidden"
                  : "hidden md:flex"
              }`}
            >
              <LinkedTodayWidget
                dailyNoteId={dailyNoteId}
                dateStr={viewed}
                refreshKey={refreshKey}
                editorRef={editorRef}
              />
            </div>

            <TodayContextDock
              active={railTab}
              onActiveChange={selectRailTab}
              open={phoneContextOpen}
              onOpenChange={setPhoneContextOpen}
              badges={{
                tasks: taskCount ?? "—",
                linked: linkedCount,
                calendar: viewed ? Number(viewed.slice(-2)) : "—",
              }}
              habitStatus={habitStatus}
            >
              {railTab === "tasks" && !isDesktop && tasksPanel}
              {railTab === "linked" && (
                <div className={`${SURFACE} min-h-[14rem]`}>
                  <LinkedTodayWidget
                    dailyNoteId={dailyNoteId}
                    dateStr={viewed}
                    refreshKey={refreshKey}
                    editorRef={editorRef}
                  />
                </div>
              )}
              {railTab === "calendar" && (
                <div className="-m-3 flex h-[calc(100%+1.5rem)] min-h-0 flex-col overflow-hidden">
                  <MiniCalendar
                    today={today}
                    viewed={viewed}
                    onGo={goToDay}
                    selectionMode
                    selectedDate={calendarSelectedDate}
                    onSelect={setCalendarSelectedDate}
                    compact
                  />
                  {today && calendarSelectedDate && (
                    <CalendarDayDetailPanel
                      dateStr={calendarSelectedDate}
                      today={today}
                    />
                  )}
                </div>
              )}
            </TodayContextDock>
            {/* Phone: the dock's habit pill needs the count even while the
                Tasks sheet is closed — a collapsed strip fetches and reports
                without rendering. */}
            {!isDesktop && viewed && (
              <HabitStrip
                dateStr={viewed}
                collapsed
                onStatusChange={reportHabitStatus}
              />
            )}
            {/* Calendar anchors the rail: it's how you leave the week. Sized
                to its content and flex-none at xl, flex-1 in the tabbed slot
                below xl where it's the only panel on screen. min-h, not h: a
                browser minimum-font-size floor inflates the grid, and it must
                grow rather than clip the last week. */}
            <div
              className={`${SURFACE} md:min-h-[14.75rem] xl:flex-none ${
                railTab !== "calendar"
                  ? "hidden md:flex md:max-xl:hidden md:max-xl:min-h-0"
                  : "hidden md:flex md:flex-1"
              }`}
            >
              <MiniCalendar today={today} viewed={viewed} onGo={goToDay} />
            </div>
          </div>
        </div>
      </div>
    </QuickViewContext.Provider>
  );
}
