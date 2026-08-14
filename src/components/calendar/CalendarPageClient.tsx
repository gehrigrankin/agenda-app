"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Plus,
  X,
} from "lucide-react";

import {
  listDailyNoteDatesAction,
  listTasksDueAction,
  listTasksForRangeAction,
  type DueTaskResult,
  type RangeTaskResult,
} from "@/app/app/actions";
import {
  createEventAction,
  deleteEventAction,
  listEventsForRangeAction,
  listIcsEventsForRangeAction,
} from "@/app/app/calendar/actions";
import {
  getTimelineAction,
  scheduleBlockAction,
  unscheduleBlockAction,
  type TimelineEvent,
} from "@/app/app/timeline/actions";
import {
  DEFAULT_BLOCK_MIN,
  HOUR_END,
  minToLabel,
  TimeRail,
} from "@/components/timeline/TimeRail";
import type { DayBlock } from "@/server/blocks";
import type { RangeCalendarEvent } from "@/server/calendar";
import type { UserEvent } from "@/server/events";
import {
  addDays,
  formatShortDate,
  localDateString,
  localDayBounds,
  parseLocalDate,
} from "@/lib/dates";
import {
  dedupeSpans,
  spanSegmentsForDay,
  toSpan,
  type DaySpanSegment,
  type EventSpan,
} from "@/lib/event-spans";
import { useOutsideClose } from "@/lib/hooks/use-outside-close";
import { parseQuickEvent } from "@/lib/quick-event";
import { formatTimeShort } from "@/lib/recurrence";

/**
 * Calendar page — THE merged time view (product coherence decisions in
 * CONTEXT.md). Desktop (md+) is always the month grid below. Phone (<md,
 * design Turn 17f) swaps in a Today/Week/Month segmented control; Week and
 * Today show a week strip + day-by-day agenda built from the same daily-note
 * and task-range feeds the month grid already uses (just re-fetched over a
 * 7-day window instead of the whole month). Month on phone reuses the month
 * grid component verbatim, header included.
 *
 * Quick-add events (calendar redesign): every agenda day ends in an inline
 * "Add event" row, the phone header gets a + button and the desktop header a
 * "New event" button (shortcut N). One free-text input, parsed locally by
 * lib/quick-event ("coffee w/ Sam fri 3pm") with a live preview — no picker.
 *
 * ICS layer (merged-calendar phase): the subscribed feed's events overlay
 * everything read-only — outlined steel chips in month cells (all-day ones as
 * a slim strip at the cell top), interleaved rows in the phone agenda (no
 * delete — they live in the feed). When no feed is configured the page
 * renders exactly as before, no empty-state noise. The phone Today tab also
 * carries the day-plan TimeRail (tap-to-place task blocks) so day planning
 * lives here, not just in the desktop drawer.
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_TASKS_PER_CELL = 3;

type MobileView = "today" | "week" | "month";
const MOBILE_TABS: { key: MobileView; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

type DailyNoteInfo = { id: string; title: string };

/** "2026-07" for a year/month pair. */
function monthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

/** "HH:MM" for minutes-from-midnight, feeding the shared time formatter. */
function minutesToHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(
    min % 60,
  ).padStart(2, "0")}`;
}

/** "45 min" / "1h" / "1h 30m" between two minute marks. */
function durationLabel(startMin: number, endMin: number): string {
  const d = endMin - startMin;
  const h = Math.floor(d / 60);
  const m = d % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Group a range of events into a per-day map, keeping the fetch order. */
function groupEventsByDay(rows: UserEvent[]): Map<string, UserEvent[]> {
  const map = new Map<string, UserEvent[]>();
  for (const e of rows) {
    const list = map.get(e.localDate);
    if (list) list.push(e);
    else map.set(e.localDate, [e]);
  }
  return map;
}

/** Same, for ICS range events (keyed by their covered local day). */
function groupIcsByDay(
  rows: RangeCalendarEvent[],
): Map<string, RangeCalendarEvent[]> {
  const map = new Map<string, RangeCalendarEvent[]>();
  for (const e of rows) {
    const list = map.get(e.date);
    if (list) list.push(e);
    else map.set(e.date, [e]);
  }
  return map;
}

/**
 * The multi-day events in a range, one span each. Both feeds flatten spans —
 * quick-add rows carry an inclusive `endLocalDate`, ICS rows repeat per
 * covered day with a shared `spanStart`/`spanEnd` — so the grid collapses them
 * back into runs and draws one bar per event instead of a chip per day.
 */
function collectSpans(
  userEvents: UserEvent[],
  icsEvents: RangeCalendarEvent[],
): EventSpan[] {
  return dedupeSpans(
    [
      ...userEvents.map((e) =>
        toSpan(userSpanKey(e), e.title, e.localDate, e.endLocalDate),
      ),
      ...icsEvents.map((e) =>
        toSpan(icsSpanKey(e), e.title, e.spanStart, e.spanEnd),
      ),
    ].filter((s): s is EventSpan => s !== null),
  );
}

/** Span identity for the two feeds — also what the chip renderers skip on. */
function userSpanKey(e: UserEvent): string {
  return `u:${e.id}`;
}
function icsSpanKey(e: RangeCalendarEvent): string {
  return `i:${e.uid}:${e.spanStart}`;
}

/** True when this row is one day of a multi-day run (a bar renders it). */
function isSpanned(e: UserEvent | RangeCalendarEvent): boolean {
  return "id" in e
    ? e.endLocalDate !== null && e.endLocalDate > e.localDate
    : e.spanEnd > e.spanStart;
}

/** Local minutes-from-midnight of an ISO instant (timed ICS events). */
function isoToLocalMin(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

export function CalendarPageClient() {
  const router = useRouter();

  // Today is CLIENT-local; resolve after mount so SSR stays deterministic.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    setToday(localDateString());
  }, []);

  // Viewed month, anchored to local time. Initialized once today resolves.
  const [anchor, setAnchor] = useState<{ year: number; month: number } | null>(
    null,
  );
  useEffect(() => {
    if (!today || anchor) return;
    const [y, m] = today.split("-").map(Number);
    setAnchor({ year: y, month: m - 1 });
    // anchor guard keeps this a one-time init.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today]);

  const [noteDays, setNoteDays] = useState<Set<string>>(new Set());
  const [tasksByDay, setTasksByDay] = useState<Map<string, RangeTaskResult[]>>(
    new Map(),
  );
  // Raw rows, not pre-grouped maps: the month grid needs BOTH the per-day
  // grouping (chips) and the whole-month list (multi-day spans), and deriving
  // the two from one source keeps them from disagreeing.
  const [monthEventRows, setMonthEventRows] = useState<UserEvent[]>([]);
  const [monthIcsRows, setMonthIcsRows] = useState<RangeCalendarEvent[]>([]);
  const monthEvents = useMemo(
    () => groupEventsByDay(monthEventRows),
    [monthEventRows],
  );
  const monthIcs = useMemo(() => groupIcsByDay(monthIcsRows), [monthIcsRows]);
  /** Multi-day events, one span each — drawn as a bar, not a chip per day. */
  const monthSpans = useMemo(
    () => collectSpans(monthEventRows, monthIcsRows),
    [monthEventRows, monthIcsRows],
  );

  // Bumped after every event create/delete so both ranges refetch.
  const [eventsVersion, setEventsVersion] = useState(0);
  const bumpEvents = () => setEventsVersion((v) => v + 1);

  useEffect(() => {
    if (!anchor) return;
    let cancelled = false;
    const prefix = monthKey(anchor.year, anchor.month);
    const daysInMonth = new Date(anchor.year, anchor.month + 1, 0).getDate();
    const start = `${prefix}-01`;
    const end = `${prefix}-${String(daysInMonth).padStart(2, "0")}`;

    listDailyNoteDatesAction(start, end)
      .then((rows) => {
        if (!cancelled) setNoteDays(new Set(rows.map((r) => r.date)));
      })
      .catch((err) => console.error("[calendar] notes load failed:", err));

    listTasksForRangeAction(start, end)
      .then((rows) => {
        if (cancelled) return;
        const map = new Map<string, RangeTaskResult[]>();
        for (const t of rows) {
          const list = map.get(t.due);
          if (list) list.push(t);
          else map.set(t.due, [t]);
        }
        setTasksByDay(map);
      })
      .catch((err) => console.error("[calendar] tasks load failed:", err));

    listEventsForRangeAction(start, end)
      .then((rows) => {
        if (!cancelled) setMonthEventRows(rows);
      })
      .catch((err) => console.error("[calendar] events load failed:", err));

    // `configured: false` → empty list, so an unconfigured feed renders the
    // grid exactly as before this layer existed.
    listIcsEventsForRangeAction(start, end)
      .then((res) => {
        if (!cancelled) setMonthIcsRows(res.events);
      })
      .catch((err) => console.error("[calendar] ics load failed:", err));

    return () => {
      cancelled = true;
    };
  }, [anchor, eventsVersion]);

  const cells = useMemo(() => {
    if (!anchor) return [];
    const first = new Date(anchor.year, anchor.month, 1);
    const daysInMonth = new Date(anchor.year, anchor.month + 1, 0).getDate();
    const prefix = monthKey(anchor.year, anchor.month);
    const out: ({ day: number; dateStr: string } | null)[] = [
      ...Array.from({ length: first.getDay() }, () => null),
      ...Array.from({ length: daysInMonth }, (_, i) => ({
        day: i + 1,
        dateStr: `${prefix}-${String(i + 1).padStart(2, "0")}`,
      })),
    ];
    // Pad the tail so the grid is full weeks.
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [anchor]);

  const step = (delta: number) => {
    if (!anchor) return;
    const d = new Date(anchor.year, anchor.month + delta, 1);
    setAnchor({ year: d.getFullYear(), month: d.getMonth() });
  };

  const goToday = () => {
    if (!today) return;
    const [y, m] = today.split("-").map(Number);
    setAnchor({ year: y, month: m - 1 });
  };

  const title = anchor
    ? new Date(anchor.year, anchor.month, 1).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })
    : "";

  // anchor resolves synchronously right after `today` does, so this only
  // covers the brief client-date resolution window on first paint.
  const loading = anchor === null;

  // --- Phone: Today/Week/Month segmented control -----------------------------

  const [mobileView, setMobileView] = useState<MobileView>("week");
  const selectTab = (v: MobileView) => {
    setMobileView(v);
    // Week/Today are always the CURRENT week/day, so snap the month title
    // (and Month view, if the user flips back to it) to today too.
    if (v !== "month") goToday();
  };

  // The current calendar week (Sun–Sat), fixed to `today` — phone has no week
  // paging, matching the design's minimal nav surface.
  const weekDays = useMemo(() => {
    if (!today) return [] as string[];
    const dow = parseLocalDate(today).getDay();
    const start = addDays(today, -dow);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [today]);
  const weekStart = weekDays[0] ?? null;
  const weekEnd = weekDays[6] ?? null;

  const [weekNoteDays, setWeekNoteDays] = useState<Map<string, DailyNoteInfo>>(
    new Map(),
  );
  const [weekTasksByDay, setWeekTasksByDay] = useState<
    Map<string, RangeTaskResult[]>
  >(new Map());
  const [weekEvents, setWeekEvents] = useState<Map<string, UserEvent[]>>(
    new Map(),
  );
  const [weekIcs, setWeekIcs] = useState<Map<string, RangeCalendarEvent[]>>(
    new Map(),
  );
  const [weekLoaded, setWeekLoaded] = useState(false);

  useEffect(() => {
    if (!weekStart || !weekEnd) return;
    let cancelled = false;
    setWeekLoaded(false);

    Promise.all([
      listDailyNoteDatesAction(weekStart, weekEnd),
      listTasksForRangeAction(weekStart, weekEnd),
      listEventsForRangeAction(weekStart, weekEnd),
      // A feed hiccup must not blank the whole agenda — degrade to no layer.
      listIcsEventsForRangeAction(weekStart, weekEnd).catch((err) => {
        console.error("[calendar] ics load failed:", err);
        return { configured: false, events: [] as RangeCalendarEvent[] };
      }),
    ])
      .then(([noteRows, taskRows, eventRows, icsRes]) => {
        if (cancelled) return;
        setWeekNoteDays(
          new Map(noteRows.map((r) => [r.date, { id: r.id, title: r.title }])),
        );
        const map = new Map<string, RangeTaskResult[]>();
        for (const t of taskRows) {
          const list = map.get(t.due);
          if (list) list.push(t);
          else map.set(t.due, [t]);
        }
        setWeekTasksByDay(map);
        setWeekEvents(groupEventsByDay(eventRows));
        setWeekIcs(groupIcsByDay(icsRes.events));
      })
      .catch((err) => console.error("[calendar] week agenda load failed:", err))
      .finally(() => {
        if (!cancelled) setWeekLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [weekStart, weekEnd, eventsVersion]);

  const weekAgendaLoading = weekDays.length === 0 || !weekLoaded;

  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  useEffect(() => {
    if (!today || selectedDay) return;
    setSelectedDay(today);
    // one-time init once today resolves, same guard pattern as anchor above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today]);

  const sectionRefs = useRef(new Map<string, HTMLDivElement>());
  const selectDay = (d: string) => {
    setSelectedDay(d);
    sectionRefs.current.get(d)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const agendaDays = mobileView === "today" ? (today ? [today] : []) : weekDays;

  // --- Quick-add events ------------------------------------------------------

  // Phone: which agenda day's inline "Add event" row is expanded.
  const [quickAddDay, setQuickAddDay] = useState<string | null>(null);
  // Desktop (and phone Month view): the header "New event" bar.
  const [headerAddOpen, setHeaderAddOpen] = useState(false);

  // Design shortcut: N opens the New event bar (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "n" && e.key !== "N") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      e.preventDefault();
      setHeaderAddOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openMobileQuickAdd = () => {
    const d = mobileView === "today" ? today : (selectedDay ?? today);
    if (!d) return;
    setQuickAddDay(d);
    if (mobileView === "week") selectDay(d);
  };

  const deleteEvent = async (id: string) => {
    try {
      await deleteEventAction(id);
      bumpEvents();
    } catch (err) {
      console.error("[calendar] delete event failed:", err);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 md:pl-[5.75rem] lg:overflow-hidden">
      {/* Desktop header — also reused verbatim for phone Month view. */}
      <div
        className={`${mobileView === "month" ? "flex" : "hidden"} md:flex flex-none flex-wrap items-center gap-2`}
      >
        <CalendarDays className="h-4 w-4 flex-none text-sage" />
        {loading ? (
          <div className="h-4 w-32 animate-pulse rounded bg-white/6" />
        ) : (
          <h1 className="min-w-0 truncate text-[0.9375rem] font-semibold text-ink-100">
            {title}
          </h1>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous month"
            disabled={loading}
            onClick={() => step(-1)}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/8 bg-white/4 hover:bg-white/8 disabled:opacity-50"
          >
            <ChevronLeft className="h-3.5 w-3.5 text-ink-300" />
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={goToday}
            className="rounded-lg border border-white/8 bg-white/4 px-2.5 py-1.5 text-[0.71875rem] font-medium text-ink-300 hover:bg-white/8 disabled:opacity-50"
          >
            Today
          </button>
          <button
            type="button"
            aria-label="Next month"
            disabled={loading}
            onClick={() => step(1)}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/8 bg-white/4 hover:bg-white/8 disabled:opacity-50"
          >
            <ChevronRight className="h-3.5 w-3.5 text-ink-300" />
          </button>
          <button
            type="button"
            disabled={loading || today === null}
            // Opens only — closing is the bar's own job now (its X, Escape,
            // or an outside press), and a toggle here fought the outside-close
            // handler: the press closed the bar, then the click reopened it.
            onClick={() => setHeaderAddOpen(true)}
            className="ml-1.5 flex items-center gap-1.5 rounded-lg border border-sage/30 bg-sage/16 px-3 py-1.5 text-[0.75rem] font-semibold text-[#B7D8C4] hover:bg-sage/24 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            New event
            <span className="ml-1 hidden rounded border border-sage/35 px-1 py-0.5 text-[0.625rem] font-medium text-[#8FAF9C] md:inline">
              N
            </span>
          </button>
        </div>
      </div>

      {/* "New event" quick-add bar (header button / N shortcut). */}
      {headerAddOpen && today && (
        <div className={`${mobileView === "month" ? "block" : "hidden"} md:block flex-none`}>
          <QuickAddEvent
            expanded
            fallbackDay={today}
            today={today}
            onClose={() => setHeaderAddOpen(false)}
            onCreated={bumpEvents}
          />
        </div>
      )}

      {/* Phone header (Today/Week views): centered month title + quick-add. */}
      <div
        className={`${mobileView === "month" ? "hidden" : "flex"} relative flex-none items-center justify-center md:hidden`}
      >
        {loading ? (
          <div className="h-4 w-32 animate-pulse rounded bg-white/6" />
        ) : (
          <h1 className="text-[1rem] font-semibold text-ink-100">{title}</h1>
        )}
        <button
          type="button"
          aria-label="Add event"
          disabled={today === null}
          onClick={openMobileQuickAdd}
          className="absolute right-1 flex h-8 w-8 items-center justify-center rounded-full bg-sage/16 disabled:opacity-50"
        >
          <Plus className="h-[1.125rem] w-[1.125rem] text-sage" />
        </button>
      </div>

      {/* Phone segmented control: Today | Week | Month. */}
      <div className="grid flex-none grid-cols-3 gap-1 rounded-[0.6875rem] border border-white/7 bg-white/4 p-[0.1875rem] md:hidden">
        {MOBILE_TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => selectTab(key)}
            className={`flex h-[2.125rem] items-center justify-center rounded-lg text-[0.8125rem] transition-colors ${
              mobileView === key
                ? "bg-sage/16 font-semibold text-[#B7D8C4]"
                : "font-medium text-ink-400"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Phone Today/Week agenda. */}
      <div
        className={`${mobileView === "month" ? "hidden" : "flex"} flex-col gap-4 md:hidden`}
      >
        {mobileView === "week" && (
          <div className="grid flex-none grid-cols-7 gap-1">
            {weekDays.length === 0
              ? Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className="flex flex-col items-center gap-1 py-1">
                    <div className="h-2 w-4 animate-pulse rounded bg-white/6" />
                    <div className="h-10 w-10 animate-pulse rounded-full bg-white/6" />
                  </div>
                ))
              : weekDays.map((d) => (
                  <WeekStripDay
                    key={d}
                    dateStr={d}
                    isToday={d === today}
                    selected={d === selectedDay}
                    hasContent={
                      weekNoteDays.has(d) ||
                      (weekTasksByDay.get(d)?.length ?? 0) > 0 ||
                      (weekEvents.get(d)?.length ?? 0) > 0 ||
                      (weekIcs.get(d)?.length ?? 0) > 0
                    }
                    onSelect={() => selectDay(d)}
                  />
                ))}
          </div>
        )}

        <div className="flex flex-col gap-4">
          {agendaDays.map((d) => (
            <AgendaDay
              key={d}
              dateStr={d}
              today={today}
              isToday={d === today}
              note={weekNoteDays.get(d)}
              tasks={weekTasksByDay.get(d) ?? []}
              events={weekEvents.get(d) ?? []}
              icsEvents={weekIcs.get(d) ?? []}
              loading={weekAgendaLoading}
              quickAddOpen={quickAddDay === d}
              onQuickAddOpenChange={(open) => setQuickAddDay(open ? d : null)}
              onEventCreated={bumpEvents}
              onDeleteEvent={deleteEvent}
              registerRef={(el) => {
                if (el) sectionRefs.current.set(d, el);
                else sectionRefs.current.delete(d);
              }}
              onOpenNote={(id) => router.push(`/app/notes/${id}`)}
              onOpenDay={() => router.push(d === today ? "/app" : `/app?d=${d}`)}
            />
          ))}
        </div>

        {/* Day-plan rail — Today tab only (planning belongs to the day you're in). */}
        {mobileView === "today" && today && <TodayPlanRail today={today} />}
      </div>

      {/* Weekday header — desktop always, phone Month view only. */}
      <div
        className={`${mobileView === "month" ? "grid" : "hidden"} md:grid flex-none grid-cols-7 gap-1.5`}
      >
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="px-2 text-[0.625rem] font-medium uppercase tracking-wide text-ink-600"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Month grid — desktop always, phone Month view only. */}
      <div
        // Scrolls internally when the viewport is too short for six 6.5rem
        // rows (short laptop/landscape-tablet windows) — the page itself is
        // lg:overflow-hidden, so without this the last week clips silently.
        className={`${mobileView === "month" ? "grid" : "hidden"} md:grid min-h-0 flex-1 grid-cols-7 gap-1.5 lg:overflow-y-auto`}
        style={{
          gridAutoRows: "minmax(6.5rem, 1fr)",
        }}
      >
        {loading
          ? Array.from({ length: 35 }).map((_, i) => (
              <div
                key={`skel-${i}`}
                className="animate-pulse rounded-xl border border-white/4 bg-white/4"
              />
            ))
          : cells.map((cell, i) =>
              cell === null ? (
                <div
                  key={`pad-${i}`}
                  className="rounded-xl border border-white/4 bg-panel/30"
                />
              ) : (
                <DayCell
                  key={cell.dateStr}
                  day={cell.day}
                  dateStr={cell.dateStr}
                  today={today}
                  hasNote={noteDays.has(cell.dateStr)}
                  tasks={tasksByDay.get(cell.dateStr) ?? []}
                  events={monthEvents.get(cell.dateStr) ?? []}
                  icsEvents={monthIcs.get(cell.dateStr) ?? []}
                  // `cells` is padded to whole weeks from column 0, so every
                  // multiple of 7 is a week row's first cell — where a
                  // wrapped span picks its title back up.
                  spans={spanSegmentsForDay(monthSpans, cell.dateStr, i % 7 === 0)}
                />
              ),
            )}
      </div>
    </div>
  );
}

function DayCell({
  day,
  dateStr,
  today,
  hasNote,
  tasks,
  events,
  icsEvents,
  spans,
}: {
  day: number;
  dateStr: string;
  today: string | null;
  hasNote: boolean;
  tasks: RangeTaskResult[];
  events: UserEvent[];
  icsEvents: RangeCalendarEvent[];
  /** Multi-day runs crossing this cell, as bars. */
  spans: DaySpanSegment[];
}) {
  const router = useRouter();
  const isToday = today !== null && dateStr === today;
  const isPast = today !== null && dateStr < today;
  // Every day opens its home view — future days included, matching the home
  // MiniCalendar. Planning ahead (and jotting on a day that hasn't arrived)
  // is the point of a future day; a dead cell just read as broken.
  const clickable = today !== null;

  const open = () => {
    if (!clickable) return;
    router.push(isToday ? "/app" : `/app?d=${dateStr}`);
  };

  // Events and tasks share the cell's rows (events first, they're timed).
  // Event order: all-day ICS strips at the top, then every timed event (ICS +
  // quick-add) merged by start time, ICS winning ties. Two event rows max —
  // same cap as before the ICS layer — and tasks always keep at least one row.
  // Spanned rows are drawn by the bars above the chips — one bar for the run,
  // not the same chip repeated on every covered day.
  const allDayIcs = icsEvents.filter((e) => e.allDay && !isSpanned(e));
  const timedRows = [
    ...icsEvents
      .filter((e) => !e.allDay)
      .map((e) => ({
        kind: "ics" as const,
        sort: isoToLocalMin(e.startIso!),
        ics: e,
        user: null,
      })),
    ...events
      .filter((e) => !isSpanned(e))
      .map((e) => ({
        kind: "user" as const,
        sort: e.startMin ?? -1,
        ics: null,
        user: e,
      })),
  ].sort(
    (a, b) =>
      a.sort - b.sort || (a.kind === b.kind ? 0 : a.kind === "ics" ? -1 : 1),
  );
  const shownAllDay = allDayIcs.slice(0, 2);
  const shownTimed = timedRows.slice(0, 2 - shownAllDay.length);
  const shownEventCount = shownAllDay.length + shownTimed.length;
  const shown = tasks.slice(
    0,
    Math.max(1, MAX_TASKS_PER_CELL - shownEventCount),
  );
  const hidden =
    allDayIcs.length +
    timedRows.length -
    shownEventCount +
    Math.max(0, spans.length - 2) +
    (tasks.length - shown.length);

  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={open}
      onKeyDown={(e) => {
        if (clickable && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          open();
        }
      }}
      className={`flex min-h-0 flex-col overflow-hidden rounded-xl border p-1.5 text-left ${
        isToday
          ? "border-sage/40 bg-sage/8"
          : "border-white/7 bg-panel/70"
      } ${clickable ? "cursor-pointer transition-colors hover:border-sage/35" : "opacity-90"}`}
    >
      <div className="flex flex-none items-center gap-1">
        <span
          className={`text-[0.71875rem] font-semibold leading-none ${
            isToday
              ? "flex h-[1.125rem] w-[1.125rem] items-center justify-center rounded-full bg-sage text-[0.625rem] text-sage-ink"
              : isPast
                ? "text-ink-500"
                : "text-ink-200"
          }`}
        >
          {day}
        </span>
        {hasNote && (
          <FileText
            aria-label="Daily note exists"
            className="ml-auto h-3 w-3 flex-none text-steel"
          />
        )}
      </div>
      <div className="mt-1 flex min-h-0 flex-col gap-0.5 overflow-hidden">
        {/* Multi-day runs: one bar per event, continuing across the cells it
            covers. The cells are separate boxes with a 1.5 gap, so the bar is
            bled to each cell's edges (-mx-1.5, undoing the padding) and only
            the run's TRUE first/last day is rounded — an interior day, and a
            week boundary, stay square so the bar reads as continuing. */}
        {spans.slice(0, 2).map((s) => (
          <div
            key={s.key}
            title={`${s.title} · ${s.start} – ${s.end}`}
            className={`-mx-1.5 flex-none truncate bg-event/22 px-1 py-px text-[0.59375rem] leading-tight text-[#CBB5DE] ${
              s.isStart ? "ml-0 rounded-l-full" : ""
            } ${s.isEnd ? "mr-0 rounded-r-full" : ""}`}
          >
            {s.showLabel ? s.title : "\u00A0"}
          </div>
        ))}
        {/* All-day ICS events: slim full-width strip at the top of the cell. */}
        {shownAllDay.map((ev, i) => (
          <div
            key={`ad-${ev.uid}-${i}`}
            className="flex-none truncate rounded-[0.25rem] bg-steel/15 px-1 py-px text-[0.59375rem] leading-tight text-[#9FB9CC]"
            title={`${ev.title} · all day`}
          >
            {ev.title}
          </div>
        ))}
        {shownTimed.map((row, i) =>
          row.kind === "ics" ? (
            // ICS chip: outlined steel — visually distinct from the filled
            // quick-add chip below (it's read-only feed data, not ours).
            <div
              key={`ics-${row.ics.uid}-${i}`}
              className="flex items-center gap-1 rounded-[0.3125rem] border border-steel/40 px-1 py-0.5"
              title={row.ics.title}
            >
              <span className="hidden flex-none text-[0.59375rem] leading-tight text-[#7B98AC] md:block">
                {formatTimeShort(minutesToHHMM(row.sort))}
              </span>
              <span className="min-w-0 flex-1 truncate text-[0.625rem] leading-tight text-ink-300">
                {row.ics.title}
              </span>
            </div>
          ) : (
            <div
              key={row.user.id}
              className="flex items-center gap-1 rounded-[0.3125rem] border border-steel/25 bg-steel/8 px-1 py-0.5"
              title={row.user.title}
            >
              {row.user.startMin !== null && (
                // Phone month cells are ~40px wide — the time alone would
                // overflow the chip, so it's desktop-only.
                <span className="hidden flex-none text-[0.59375rem] leading-tight text-[#7B98AC] md:block">
                  {formatTimeShort(minutesToHHMM(row.user.startMin))}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-[0.625rem] leading-tight text-ink-300">
                {row.user.title}
              </span>
            </div>
          ),
        )}
        {shown.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-1 rounded-[0.3125rem] bg-white/4 px-1 py-0.5"
            title={t.title}
          >
            <span
              className={`flex h-2 w-2 flex-none items-center justify-center rounded-[0.125rem] ${
                t.completed ? "bg-sage" : "border border-ink-600"
              }`}
            >
              {t.completed && <Check className="h-1.5 w-1.5 text-sage-ink" />}
            </span>
            <span
              className={`min-w-0 flex-1 truncate text-[0.625rem] leading-tight ${
                t.completed ? "text-ink-600 line-through" : "text-ink-300"
              }`}
            >
              {t.title}
            </span>
          </div>
        ))}
        {hidden > 0 && (
          <span className="px-1 text-[0.59375rem] text-ink-600">
            +{hidden} more
          </span>
        )}
      </div>
    </div>
  );
}

/** One day column in the phone Week strip. */
function WeekStripDay({
  dateStr,
  isToday,
  selected,
  hasContent,
  onSelect,
}: {
  dateStr: string;
  isToday: boolean;
  selected: boolean;
  hasContent: boolean;
  onSelect: () => void;
}) {
  const d = parseLocalDate(dateStr);
  const weekdayInitial = WEEKDAYS[d.getDay()][0];

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex flex-col items-center gap-1 py-1"
    >
      <span className="text-[0.65625rem] font-medium uppercase text-ink-600">
        {weekdayInitial}
      </span>
      <span
        className={`flex h-10 w-10 items-center justify-center rounded-full text-[0.875rem] ${
          isToday
            ? "bg-sage font-semibold text-sage-ink"
            : selected
              ? "font-semibold text-ink-100 ring-1 ring-sage/40"
              : "font-medium text-ink-200"
        }`}
      >
        {d.getDate()}
      </span>
      <span
        className={`h-1 w-1 rounded-full ${
          hasContent ? (isToday ? "bg-sage" : "bg-ink-700") : "bg-transparent"
        }`}
      />
    </button>
  );
}

/** One day's agenda section in the phone Week/Today view. */
function AgendaDay({
  dateStr,
  today,
  isToday,
  note,
  tasks,
  events,
  icsEvents,
  loading,
  quickAddOpen,
  onQuickAddOpenChange,
  onEventCreated,
  onDeleteEvent,
  registerRef,
  onOpenNote,
  onOpenDay,
}: {
  dateStr: string;
  today: string | null;
  isToday: boolean;
  note: DailyNoteInfo | undefined;
  tasks: RangeTaskResult[];
  events: UserEvent[];
  icsEvents: RangeCalendarEvent[];
  loading: boolean;
  quickAddOpen: boolean;
  onQuickAddOpenChange: (open: boolean) => void;
  onEventCreated: () => void;
  onDeleteEvent: (id: string) => void;
  registerRef: (el: HTMLDivElement | null) => void;
  onOpenNote: (noteId: string) => void;
  onOpenDay: () => void;
}) {
  const hasItems =
    !!note || tasks.length > 0 || events.length > 0 || icsEvents.length > 0;
  const label = isToday
    ? `Today · ${formatShortDate(dateStr)}`
    : formatShortDate(dateStr);

  // Events and tasks interleave chronologically: all-day events first (ICS
  // pinned above quick-add), then timed items by clock, then undated tasks.
  const rows = [
    ...icsEvents.map((ev, i) => ({
      key: `ics-${ev.uid}-${i}`,
      sort: ev.allDay ? -2 : isoToLocalMin(ev.startIso!),
      node: <IcsEventRow event={ev} />,
    })),
    ...events.map((ev) => ({
      key: `ev-${ev.id}`,
      sort: ev.startMin ?? -1,
      node: <EventRow event={ev} onDelete={() => onDeleteEvent(ev.id)} />,
    })),
    ...tasks.map((t) => ({
      key: `task-${t.id}`,
      sort: t.remindAt
        ? Number(t.remindAt.slice(0, 2)) * 60 + Number(t.remindAt.slice(3, 5))
        : 1441,
      node: (
        <AgendaRow
          time={t.remindAt ? formatTimeShort(t.remindAt) : ""}
          onClick={onOpenDay}
        >
          {t.remindAt ? (
            <div className="rounded-xl border-[1.5px] border-dashed border-sage/50 bg-sage/5 px-3 py-2">
              <div
                className={`truncate text-[0.875rem] ${
                  t.completed ? "text-ink-500 line-through" : "text-ink-200"
                }`}
              >
                {t.title}
              </div>
              <div className="text-[0.6875rem] text-sage">
                task · {formatTimeShort(t.remindAt)}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-steel/25 bg-steel/8 px-3 py-2">
              <div
                className={`truncate text-[0.875rem] ${
                  t.completed ? "text-ink-500 line-through" : "text-ink-200"
                }`}
              >
                {t.title}
              </div>
              <div className="text-[0.6875rem] text-[#7B98AC]">task</div>
            </div>
          )}
        </AgendaRow>
      ),
    })),
  ].sort((a, b) => a.sort - b.sort);

  return (
    <div ref={registerRef} className="scroll-mt-3">
      <div
        className={`text-[0.625rem] font-semibold uppercase tracking-wide ${
          isToday ? "text-sage" : "text-ink-600"
        }`}
      >
        {label}
      </div>

      {loading ? (
        <div className="mt-2 flex flex-col gap-1.5">
          <div className="h-10 animate-pulse rounded-xl bg-white/4" />
          <div className="h-10 animate-pulse rounded-xl bg-white/4" />
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-1.5">
          {!hasItems && (
            <div className="ml-[3.75rem] text-[0.75rem] text-ink-600">
              Nothing scheduled
            </div>
          )}
          {note && (
            <AgendaRow time="" onClick={() => onOpenNote(note.id)}>
              <div className="rounded-xl border border-steel/25 bg-steel/8 px-3 py-2">
                <div className="truncate text-[0.875rem] text-ink-200">
                  {note.title}
                </div>
                <div className="text-[0.6875rem] text-[#7B98AC]">daily note</div>
              </div>
            </AgendaRow>
          )}
          {rows.map((r) => (
            <div key={r.key}>{r.node}</div>
          ))}
          {today && (
            <div className="flex items-start gap-2">
              <span className="w-[3.25rem] flex-none" />
              <div className="min-w-0 flex-1">
                <QuickAddEvent
                  expanded={quickAddOpen}
                  fallbackDay={dateStr}
                  today={today}
                  onOpen={() => onQuickAddOpenChange(true)}
                  onClose={() => onQuickAddOpenChange(false)}
                  onCreated={onEventCreated}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A user-created event in the agenda (steel card + delete). */
function EventRow({
  event,
  onDelete,
}: {
  event: UserEvent;
  onDelete: () => void;
}) {
  const time =
    event.startMin !== null
      ? formatTimeShort(minutesToHHMM(event.startMin))
      : "";
  const detail =
    event.startMin === null
      ? "all day"
      : event.endMin !== null
        ? durationLabel(event.startMin, event.endMin)
        : formatTimeShort(minutesToHHMM(event.startMin));

  return (
    <div className="flex items-start gap-2">
      <span className="w-[3.25rem] flex-none pt-2 text-right text-[0.75rem] font-medium text-ink-400">
        {time}
      </span>
      <div className="group relative min-w-0 flex-1 rounded-xl border border-steel/25 bg-steel/8 px-3 py-2">
        <div className="truncate pr-6 text-[0.875rem] text-ink-200">
          {event.title}
        </div>
        <div className="text-[0.6875rem] text-[#7B98AC]">calendar · {detail}</div>
        <button
          type="button"
          aria-label={`Delete "${event.title}"`}
          onClick={onDelete}
          className="absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-md text-ink-500 opacity-60 hover:bg-white/8 hover:text-ink-200 group-hover:opacity-100 md:right-2 md:top-2 md:h-6 md:w-6"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * A read-only ICS feed event in the agenda: outlined steel card, no delete
 * button — it lives in the subscribed calendar, not in this app's data.
 */
function IcsEventRow({ event }: { event: RangeCalendarEvent }) {
  const startMin = event.allDay ? null : isoToLocalMin(event.startIso!);
  const endMin =
    !event.allDay && event.endIso ? isoToLocalMin(event.endIso) : null;
  const time = startMin !== null ? formatTimeShort(minutesToHHMM(startMin)) : "";
  const detail =
    startMin === null
      ? "all day"
      : endMin !== null && endMin > startMin
        ? durationLabel(startMin, endMin)
        : time;

  return (
    <div className="flex items-start gap-2">
      <span className="w-[3.25rem] flex-none pt-2 text-right text-[0.75rem] font-medium text-ink-400">
        {time}
      </span>
      <div className="min-w-0 flex-1 rounded-xl border border-steel/40 px-3 py-2">
        <div className="truncate text-[0.875rem] text-ink-200">
          {event.title}
        </div>
        <div className="text-[0.6875rem] text-[#7B98AC]">
          calendar · {detail}
        </div>
      </div>
    </div>
  );
}

/**
 * The one-line natural-language event input ("coffee w/ Sam fri 3pm").
 * Collapsed it's the design's dashed "Add event" row; expanded it parses on
 * every keystroke via lib/quick-event and previews the date/time it read.
 * When the text names no day, the event lands on `fallbackDay`.
 */
function QuickAddEvent({
  expanded,
  fallbackDay,
  today,
  onOpen,
  onClose,
  onCreated,
}: {
  expanded: boolean;
  fallbackDay: string;
  today: string;
  onOpen?: () => void;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [value, setValue] = useState("");
  /** Optional inclusive last day — the multi-day half the text parser has no
   * phrase for. Empty = single-day, which is every event until you say so. */
  const [endDate, setEndDate] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  // Escape always closes; a stray outside press only closes an EMPTY bar —
  // same rule as the note composer, since half-typed text is work.
  useOutsideClose(expanded, boxRef, (via) => {
    if (via === "escape" || !value.trim()) onClose();
  });

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-2 rounded-xl border border-dashed border-white/16 px-3 py-[0.6875rem] text-left hover:border-sage/50 hover:bg-sage/5"
      >
        <Plus className="h-3.5 w-3.5 flex-none text-ink-400" />
        <span className="truncate text-[0.78125rem] text-ink-400">
          Add event — try &ldquo;coffee w/ Sam fri 3pm&rdquo;
        </span>
      </button>
    );
  }

  const parse = value.trim() ? parseQuickEvent(value, today) : null;
  const startDay = parse?.date ?? fallbackDay;
  // An end on or before the start isn't a span (the server agrees, and drops
  // it) — treat it as unset here so the preview never promises one.
  const spanEnd = endDate && endDate > startDay ? endDate : null;
  const preview = parse
    ? `${formatShortDate(startDay)}${
        spanEnd ? ` – ${formatShortDate(spanEnd)}` : ""
      }${
        parse.startMin !== null
          ? ` · ${formatTimeShort(minutesToHHMM(parse.startMin))}${
              parse.endMin !== null
                ? ` – ${formatTimeShort(minutesToHHMM(parse.endMin))}`
                : ""
            }`
          : " · all day"
      }`
    : "type an event — a day and time in plain words works";

  const submit = async () => {
    if (!parse || saving) return;
    setSaving(true);
    try {
      await createEventAction({
        title: parse.title,
        date: startDay,
        endDate: spanEnd,
        startMin: parse.startMin,
        endMin: parse.endMin,
      });
      setValue("");
      setEndDate("");
      onCreated();
      onClose();
    } catch (err) {
      console.error("[calendar] create event failed:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      ref={boxRef}
      className="rounded-xl border-[1.5px] border-dashed border-sage/50 bg-sage/5 px-3 py-2"
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        disabled={saving}
        placeholder="coffee w/ Sam fri 3pm"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        className="w-full bg-transparent text-[0.875rem] text-ink-100 placeholder:text-ink-600 focus:outline-none"
      />
      {/* The one picker on this surface: multi-day is a date, not a phrase —
          "through friday" reads fine but guesses wrong often enough that the
          span would be a lie. Native date input, so phones get their own. */}
      <label className="mt-1 flex items-center gap-1.5 text-[0.6875rem] text-ink-500">
        Ends
        <input
          type="date"
          value={endDate}
          min={addDays(startDay, 1)}
          disabled={saving}
          onChange={(e) => setEndDate(e.target.value)}
          className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[0.6875rem] text-ink-200 focus:outline-none focus:ring-1 focus:ring-sage/40"
        />
        {endDate && (
          <button
            type="button"
            onClick={() => setEndDate("")}
            className="rounded px-1 text-[0.6875rem] text-ink-500 hover:bg-white/6 hover:text-ink-300"
          >
            clear
          </button>
        )}
      </label>
      <div className="mt-0.5 flex items-center gap-2">
        <span
          className={`min-w-0 flex-1 truncate text-[0.6875rem] ${
            parse ? "text-sage" : "text-ink-600"
          }`}
        >
          {preview}
        </span>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!parse || saving}
          className="flex-none rounded-md bg-sage/16 px-2 py-0.5 text-[0.6875rem] font-semibold text-[#B7D8C4] disabled:opacity-40"
        >
          {saving ? "Adding…" : "Add ↵"}
        </button>
      </div>
    </div>
  );
}

function AgendaRow({
  time,
  onClick,
  children,
}: {
  time: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="flex cursor-pointer items-start gap-2"
    >
      <span className="w-[3.25rem] flex-none pt-2 text-right text-[0.75rem] font-medium text-ink-400">
        {time}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * Phone Today-tab day plan (merged-calendar phase): the same 7:00–22:00
 * TimeRail as the desktop drawer, tap-to-place instead of drag. Tapping an
 * empty quarter-hour opens a bottom sheet of today's open, unscheduled tasks;
 * tapping a block opens a remove sheet. Blocks are the same day_blocks rows
 * the drawer manages, so the two surfaces stay in lockstep.
 */
function TodayPlanRail({ today }: { today: string }) {
  const [blocks, setBlocks] = useState<DayBlock[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [staleCount, setStaleCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState<
    | { mode: "place"; startMin: number }
    | { mode: "remove"; block: DayBlock }
    | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const { start, end } = localDayBounds(today);
    // Passing yesterday opts into the server's roll-forward of unfinished
    // blocks, exactly like the desktop drawer's load.
    getTimelineAction(
      today,
      start.toISOString(),
      end.toISOString(),
      addDays(today, -1),
    )
      .then((timeline) => {
        if (cancelled) return;
        setBlocks(timeline.blocks);
        setEvents(timeline.events);
        setStaleCount(timeline.staleCount);
        setLoading(false);
      })
      .catch((err) => {
        console.error("[calendar] plan rail load failed:", err);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [today]);

  const place = (task: DueTaskResult, startMin: number) => {
    const endMin = Math.min(HOUR_END * 60, startMin + DEFAULT_BLOCK_MIN);
    // Optimistic placeholder; reconcile with the server's row on response.
    const optimistic: DayBlock = {
      id: `tmp-${task.id}`,
      taskId: task.id,
      title: task.title,
      completed: false,
      startMin,
      endMin,
    };
    setBlocks((prev) => [
      ...prev.filter((b) => b.taskId !== task.id),
      optimistic,
    ]);
    setSheet(null);
    scheduleBlockAction(task.id, today, startMin, endMin)
      .then((saved) => {
        if (!saved) return;
        setBlocks((prev) =>
          prev.map((b) => (b.taskId === task.id ? saved : b)),
        );
      })
      .catch((err) => {
        console.error("[calendar] schedule failed:", err);
        setBlocks((prev) => prev.filter((b) => b.taskId !== task.id));
      });
  };

  const remove = (block: DayBlock) => {
    setBlocks((prev) => prev.filter((b) => b.id !== block.id));
    setSheet(null);
    if (block.id.startsWith("tmp-")) return;
    unscheduleBlockAction(block.id).catch((err) =>
      console.error("[calendar] unschedule failed:", err),
    );
  };

  return (
    <div>
      <div className="text-[0.625rem] font-semibold uppercase tracking-wide text-ink-600">
        Plan the day
      </div>
      <p className="mt-0.5 text-[0.6875rem] text-ink-600">
        Tap an empty slot to schedule a task.
      </p>
      {loading ? (
        <div className="mt-2 flex flex-col gap-2">
          <div className="h-24 animate-pulse rounded-xl bg-white/4" />
          <div className="h-24 animate-pulse rounded-xl bg-white/4" />
          <div className="h-24 animate-pulse rounded-xl bg-white/4" />
        </div>
      ) : (
        <div className="mt-2">
          <TimeRail
            blocks={blocks}
            events={events}
            staleCount={staleCount}
            onTapSlot={(startMin) => setSheet({ mode: "place", startMin })}
            onTapBlock={(block) => setSheet({ mode: "remove", block })}
          />
        </div>
      )}
      {sheet?.mode === "place" && (
        <PlanTaskSheet
          today={today}
          startMin={sheet.startMin}
          scheduledTaskIds={new Set(blocks.map((b) => b.taskId))}
          onPick={(task) => place(task, sheet.startMin)}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.mode === "remove" && (
        <RemoveBlockSheet
          block={sheet.block}
          onRemove={() => remove(sheet.block)}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

/** Minimal scrim + bottom panel, matching AppShell's More-menu sheet. */
function BottomSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/40"
      />
      <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-white/10 bg-bar px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-4 shadow-[0_-16px_40px_rgba(0,0,0,0.5)]">
        <div className="mb-3 text-[0.8125rem] font-semibold text-ink-100">
          {title}
        </div>
        {children}
      </div>
    </div>
  );
}

/** Bottom sheet listing today's open, unscheduled tasks for a tapped slot. */
function PlanTaskSheet({
  today,
  startMin,
  scheduledTaskIds,
  onPick,
  onClose,
}: {
  today: string;
  startMin: number;
  scheduledTaskIds: Set<string>;
  onPick: (task: DueTaskResult) => void;
  onClose: () => void;
}) {
  const [tasks, setTasks] = useState<DueTaskResult[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listTasksDueAction(today)
      .then((rows) => {
        if (!cancelled) setTasks(rows);
      })
      .catch((err) => {
        console.error("[calendar] due tasks load failed:", err);
        if (!cancelled) setTasks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [today]);

  const open = tasks?.filter((t) => !scheduledTaskIds.has(t.id));

  return (
    <BottomSheet title={`Schedule at ${minToLabel(startMin)}`} onClose={onClose}>
      {open === undefined ? (
        <div className="flex flex-col gap-1.5">
          <div className="h-11 animate-pulse rounded-xl bg-white/5" />
          <div className="h-11 animate-pulse rounded-xl bg-white/5" />
        </div>
      ) : open.length === 0 ? (
        <p className="px-1 pb-2 text-[0.8125rem] text-ink-500">
          Nothing left to schedule today.
        </p>
      ) : (
        <div className="flex max-h-[50dvh] flex-col gap-1.5 overflow-y-auto">
          {open.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onPick(t)}
              className="flex min-h-11 items-center gap-2.5 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-left"
            >
              <span className="h-3.5 w-3.5 flex-none rounded-[0.25rem] border-[1.5px] border-ink-700" />
              <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink-200">
                {t.title}
              </span>
            </button>
          ))}
        </div>
      )}
    </BottomSheet>
  );
}

/** Bottom sheet offering removal of a tapped plan block. */
function RemoveBlockSheet({
  block,
  onRemove,
  onClose,
}: {
  block: DayBlock;
  onRemove: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet title={block.title} onClose={onClose}>
      <p className="mb-3 text-[0.75rem] text-ink-500">
        On the plan {minToLabel(block.startMin)} – {minToLabel(block.endMin)}.
        Removing it keeps the task itself.
      </p>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={onRemove}
          className="flex-1 rounded-xl border border-[#D9938A]/30 bg-[#D9938A]/10 px-3 py-2.5 text-[0.8125rem] font-semibold text-[#D9938A]"
        >
          Remove from plan
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-[0.8125rem] font-medium text-ink-300"
        >
          Cancel
        </button>
      </div>
    </BottomSheet>
  );
}
