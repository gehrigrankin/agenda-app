"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import type { LexicalEditor } from "lexical";
import { Loader2, Plus } from "lucide-react";

import { createNoteAction } from "@/app/app/actions";
import {
  NotePreviewProvider,
  QuickViewContext,
  usePreviewInvalidator,
} from "@/components/notes/NotePreviewProvider";
import { useNoteDock } from "@/components/notes/NoteDockProvider";
import { DATE_STR_RE, addDays, localDateString } from "@/lib/dates";
import { useDailyNoteWindow } from "@/lib/hooks/use-daily-note-window";
import { useDaySwipe } from "@/lib/hooks/use-day-swipe";
import { DailyNoteWidget } from "./DailyNoteWidget";
import { DayPager } from "./DayPager";
import { HabitStrip } from "./HabitStrip";
import { CalendarDayDetailPanel } from "./CalendarDayDetailPanel";
import { LinkedTodayWidget } from "./LinkedTodayWidget";
import { MiniCalendar } from "./MiniCalendar";
import { TasksWidget } from "./TasksWidget";
import { TodayContextDock, type TodayContextTab } from "./TodayContextDock";
import { YesterdayWidget } from "./YesterdayWidget";

/**
 * The daily-note home: an AGENDA, not a dashboard. Two columns over the dotted
 * canvas — the daily note as a full-height page on the left, and a right rail
 * that reads top-to-bottom as the day's context (tasks → linked notes →
 * calendar). `viewDate` (?d=) picks the day; today is the default, and past and
 * future days are equally reachable — the pager flips one day at a time and the
 * rail calendar jumps to any day in the month.
 *
 * The old bottom row (calendar / pinned board / yesterday) is gone: it cost the
 * note a third of the screen and sat below the fold on anything but a large
 * window. The calendar earned its place in the rail; the pinned board and the
 * yesterday recap live on their own pages, where they aren't competing with
 * today's writing surface.
 *
 * Phone (<md) is the same rail, tabbed. It used to have NO tab bar and no way
 * to reach the linked-notes or calendar widgets at all — both were simply
 * `max-md:hidden`, so a third of the home didn't exist on the device it's read
 * on most. Now one tab bar serves everything below xl.
 *
 * Phone height is viewport-relative, not a fixed 26.25rem: on a skinny-tall
 * screen that constant left a band of dead canvas under the note, and on a
 * short one it pushed the tasks off-screen. The note takes a clamped share of
 * the small viewport height (svh — the dynamic toolbar must not resize the
 * page under the cursor), and the yesterday recap comes BACK below the rail
 * only when the viewport is tall enough to hold it, via an inline
 * min-height media query (globals.css deliberately has none — the app's
 * responsiveness is width-driven, and one widget's opportunistic slot isn't
 * reason enough to start a height-breakpoint system there).
 *
 * PinnedBoardWidget was deleted rather than reinstated in that slot: it takes
 * a `board` prop no surface fetches any more (the home page.tsx read was
 * dropped when the bottom row went), so "reuse" would have meant a new server
 * read, and a pinned folder is a weaker answer to "what did I do" than the
 * yesterday recap, which fetches itself.
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
 * Phone-only home header: the day pager is the title. Keeping it centered
 * makes changing days predictable while the new-note action stays at the
 * trailing edge.
 */
function PhoneHomeHeader({
  dateStr,
  onGo,
}: {
  dateStr: string | null;
  onGo: (target: string) => void;
}) {
  const [creating, startCreate] = useTransition();
  const CIRCLE =
    "relative flex h-11 w-11 flex-none items-center justify-center";
  return (
    <header className="-mx-3 -mb-2.5 -mt-3 grid h-[4.125rem] grid-cols-[2.75rem_1fr_2.75rem] items-center bg-bar px-3 pb-2.5 pt-3 md:hidden">
      <div aria-hidden="true" />
      <div className="flex min-w-0 justify-center">
        {dateStr === null ? (
          <div className="h-8 w-32 animate-pulse rounded-lg bg-white/8" />
        ) : (
          <DayPager
            dateStr={dateStr}
            onGo={onGo}
            size="md"
            showTodayWhenActive
            showViewedLabel
          />
        )}
      </div>
      <div className="flex justify-end">
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
            <Loader2 className="h-5 w-5 animate-spin text-ink-300" />
          ) : (
            <Plus className="h-5 w-5 text-ink-300" />
          )}
        </button>
      </div>
    </header>
  );
}

export function HomeClient({
  viewDate,
}: {
  viewDate: string | null;
  inboxCount: number;
}) {
  return (
    <NotePreviewProvider>
      <HomeGrid viewDate={viewDate} />
    </NotePreviewProvider>
  );
}

function HomeGrid({ viewDate }: { viewDate: string | null }) {
  // Today is CLIENT-local; resolve after mount so SSR stays deterministic.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    setToday(localDateString());
  }, []);

  // The viewed day is CLIENT state, not the URL.
  //
  // It used to be read straight off `?d=`, which made every page turn a real
  // navigation: server round trip, remount, skeleton. Now flipping is a
  // setState against a warm cache and the URL is updated underneath with the
  // history API, so days stay shareable and the back button still walks them —
  // it just doesn't cost a page load. `viewDate` seeds it (page.tsx has already
  // regex-validated the param) and today is the default.
  const [viewedDate, setViewedDate] = useState<string | null>(viewDate);
  const viewed = today === null ? null : (viewedDate ?? today);
  const isToday = viewed !== null && viewed === today;

  // A day arriving from OUTSIDE this component — a link into `/app?d=…`, or
  // plain `/app` from the sidebar — is a real navigation, and the prop is the
  // only signal of it. Synced unconditionally, null included: clicking Home
  // while parked on last Tuesday means "take me to today", and a guard that
  // ignored null would leave you on Tuesday with `/app` in the address bar.
  // Flips made here don't re-render the server component, so this can't fight
  // them — the prop only changes on an actual navigation.
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

  // Back/forward: the URL is the record of which day you were on, so read the
  // day back out of it rather than keeping a parallel stack.
  useEffect(() => {
    const onPop = () => {
      const d = new URLSearchParams(window.location.search).get("d");
      setViewedDate(d && DATE_STR_RE.test(d) ? d : null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Warm neighbours of the viewed day so the next flip is instant.
  const {
    get: getDay,
    put: putDay,
    snapshot: snapshotDay,
    invalidate: invalidateDay,
  } = useDailyNoteWindow(viewed, today);
  const note = getDay(viewed);
  // The book view's facing page. Already in the window (it's the nearest
  // neighbour the prefetch fetches first), so opening the book costs no fetch.
  const prevNote = getDay(viewed === null ? null : addDays(viewed, -1));
  const dailyNoteId = note?.id ?? null;

  // Swipe the page: trackpad, Magic Mouse, or touch. Bound to the note panel
  // rather than the window so a horizontal scroll over the rail is still just
  // a scroll.
  const [desktopDaySwipe, setDesktopDaySwipe] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const sync = () => setDesktopDaySwipe(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const swipeRef = useDaySwipe({
    onPrev: () => viewed && goToDay(addDays(viewed, -1)),
    onNext: () => viewed && goToDay(addDays(viewed, 1)),
    enabled: viewed !== null && desktopDaySwipe,
  });

  const editorRef = useRef<LexicalEditor | null>(null);
  // Bumped when the daily doc's linked-card count changes or a quick view
  // closes — LinkedTodayWidget refetches on it.
  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

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
        {/* Two layout modes on one grid (tracks defined by .home-grid in
            globals.css — plain CSS, since the arbitrary grid-rows utilities
            with calc() silently failed to compile).
            ≥md: one full-height row — the daily note takes the whole left
            column and the rail (tasks / linked / calendar) the right edge.
            Nothing lives below the fold, so the page doesn't scroll; below xl
            the three rail widgets share one slot behind tabs.
            <md (phones, design Turn 17a): writing first — header, habit chips
            + daily note, agenda peek, due-today card. The rail widgets retire
            on phone, where the page does scroll. */}
        <div className="bubble-canvas-grid home-grid grid h-full min-h-0 grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] content-start gap-2.5 overflow-hidden p-3 md:grid-rows-none md:content-stretch md:gap-3.5 md:overflow-hidden md:pb-5 md:pl-[5.75rem] md:pr-5 md:pt-4">
          <PhoneHomeHeader dateStr={viewed} onGo={goToDay} />

          {/* Daily note (row 1, left). The week-review card now mounts inside
              the widget's DailyStack (one-card interruption budget) instead
              of stacking above the panel here. min-h-0 lets the column yield
              to the note's flex-1. */}
          {/* max-md:min-h forces the auto grid row open on phone — with
              min-h-0 alone the row's intrinsic contribution is 0 and the
              column collapses under the cards below (Chromium sizing). */}
          <div className="flex min-h-0 flex-col gap-3.5 md:col-start-1 md:row-start-1">
            {/* Phone: a fixed height, not min-h + flex-1 — in an auto grid
                row Chromium sizes the flex column ignoring a basis-0 child's
                min-height, collapsing the row to 0 and overlapping the cards
                below. md+ rows are viewport-sized, where flex-1 is correct. */}
            {/* overscroll-x-contain is half of the swipe: it stops macOS
                turning a horizontal flick into browser back/forward before the
                handler ever sees it. */}
            <div
              ref={swipeRef}
              className={`${SURFACE} min-h-0 flex-1 overscroll-x-contain max-md:-mx-3 max-md:-mb-2.5 max-md:rounded-none max-md:border-0 max-md:bg-panel max-md:shadow-none`}
            >
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
              />
            </div>
          </div>

          {/* Tasks / linked / calendar rail (right column, full height).
              min-h-0 only at md+ where the grid row is viewport-sized — on
              phones the rail must keep its natural height or it collapses to
              nothing. Below xl the three widgets share one slot behind tabs;
              at xl the tab bar hides and all three stack. */}
          <div className="contents md:flex md:flex-col md:gap-3.5 md:col-start-2 md:row-start-1 md:min-h-0">
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
            {/* Visibility is expressed as ONE display class per breakpoint
                band, never a `contents` + `hidden` pair — both set `display`,
                so the pair's winner comes down to stylesheet order rather than
                intent.
                max-md:contents (tasks tab, phone): the panel box dissolves and
                the widget's own phone cards (agenda peek + due today) become
                direct children of this column — one instance, one fetch. */}
            <div
              className={`${SURFACE} min-h-[16.25rem] flex-1 md:min-h-0 ${
                railTab === "tasks" ? "max-md:hidden" : "hidden md:flex"
              } ${railTab !== "tasks" ? "md:max-xl:hidden" : ""}`}
            >
              <TasksWidget
                dateStr={viewed ?? undefined}
                expandHref="/app/tasks"
                onOpenCountChange={setTaskCount}
              />
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
              {railTab === "tasks" && (
                <div className="flex flex-col gap-3">
                  <TasksWidget
                    dateStr={viewed ?? undefined}
                    expandHref="/app/tasks"
                  />
                </div>
              )}
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
            {!desktopDaySwipe && viewed && (
              <HabitStrip
                dateStr={viewed}
                collapsed
                onStatusChange={reportHabitStatus}
              />
            )}
            {/* Calendar anchors the rail: it's how you leave today. Sized to
                its content and flex-none at xl (a month grid has one right
                height — the slack belongs to tasks and linked notes above it),
                but flex-1 in the tabbed slot below xl where it's the only
                panel on screen. min-h, not h: a browser minimum-font-size
                floor inflates the grid, and it must grow rather than clip the
                last week. */}
            <div
              className={`${SURFACE} md:min-h-[14.75rem] xl:flex-none ${
                railTab !== "calendar"
                  ? "hidden md:flex md:max-xl:hidden md:max-xl:min-h-0"
                  : "hidden md:flex md:flex-1"
              }`}
            >
              <MiniCalendar today={today} viewed={viewed} onGo={goToDay} />
            </div>

            {/* Tall phones only: the leftover height under the rail is real
                estate, not padding. Below ~800px tall there is none, so this
                stays out of the layout entirely rather than shrinking the
                things above it. */}
            <div className={`${SURFACE} hidden min-h-[6.5rem] flex-none`}>
              <YesterdayWidget today={today} />
            </div>
          </div>
        </div>
      </div>
    </QuickViewContext.Provider>
  );
}
