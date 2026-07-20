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
  listTasksForRangeAction,
  type RangeTaskResult,
} from "@/app/app/actions";
import {
  createEventAction,
  deleteEventAction,
  listEventsForRangeAction,
} from "@/app/app/calendar/actions";
import type { UserEvent } from "@/server/events";
import { addDays, formatShortDate, localDateString, parseLocalDate } from "@/lib/dates";
import { parseQuickEvent } from "@/lib/quick-event";
import { formatTimeShort } from "@/lib/recurrence";

/**
 * Calendar page. Desktop (md+) is always the month grid below. Phone (<md,
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
  const [monthEvents, setMonthEvents] = useState<Map<string, UserEvent[]>>(
    new Map(),
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
        if (!cancelled) setMonthEvents(groupEventsByDay(rows));
      })
      .catch((err) => console.error("[calendar] events load failed:", err));

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
  const [weekLoaded, setWeekLoaded] = useState(false);

  useEffect(() => {
    if (!weekStart || !weekEnd) return;
    let cancelled = false;
    setWeekLoaded(false);

    Promise.all([
      listDailyNoteDatesAction(weekStart, weekEnd),
      listTasksForRangeAction(weekStart, weekEnd),
      listEventsForRangeAction(weekStart, weekEnd),
    ])
      .then(([noteRows, taskRows, eventRows]) => {
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
        className={`${mobileView === "month" ? "flex" : "hidden"} md:flex flex-none items-center gap-2`}
      >
        <CalendarDays className="h-4 w-4 text-sage" />
        {loading ? (
          <div className="h-4 w-32 animate-pulse rounded bg-white/6" />
        ) : (
          <h1 className="text-[0.9375rem] font-semibold text-ink-100">{title}</h1>
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
            onClick={() => setHeaderAddOpen((v) => !v)}
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
      <div className="mx-5 grid flex-none grid-cols-3 gap-1 rounded-[0.6875rem] border border-white/7 bg-white/4 p-[0.1875rem] md:hidden">
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
                      weekNoteDays.has(d) || (weekTasksByDay.get(d)?.length ?? 0) > 0
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
        className={`${mobileView === "month" ? "grid" : "hidden"} md:grid min-h-0 flex-1 grid-cols-7 gap-1.5`}
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
}: {
  day: number;
  dateStr: string;
  today: string | null;
  hasNote: boolean;
  tasks: RangeTaskResult[];
  events: UserEvent[];
}) {
  const router = useRouter();
  const isToday = today !== null && dateStr === today;
  const isPast = today !== null && dateStr < today;
  const clickable = isToday || isPast;

  const open = () => {
    if (!clickable) return;
    router.push(isToday ? "/app" : `/app?d=${dateStr}`);
  };

  // Events and tasks share the cell's rows (events first, they're timed).
  const shownEvents = events.slice(0, 2);
  const shown = tasks.slice(
    0,
    Math.max(1, MAX_TASKS_PER_CELL - shownEvents.length),
  );
  const hidden =
    events.length - shownEvents.length + (tasks.length - shown.length);

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
        {shownEvents.map((ev) => (
          <div
            key={ev.id}
            className="flex items-center gap-1 rounded-[0.3125rem] border border-steel/25 bg-steel/8 px-1 py-0.5"
            title={ev.title}
          >
            {ev.startMin !== null && (
              <span className="flex-none text-[0.59375rem] leading-tight text-[#7B98AC]">
                {formatTimeShort(minutesToHHMM(ev.startMin))}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-[0.625rem] leading-tight text-ink-300">
              {ev.title}
            </span>
          </div>
        ))}
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
  loading: boolean;
  quickAddOpen: boolean;
  onQuickAddOpenChange: (open: boolean) => void;
  onEventCreated: () => void;
  onDeleteEvent: (id: string) => void;
  registerRef: (el: HTMLDivElement | null) => void;
  onOpenNote: (noteId: string) => void;
  onOpenDay: () => void;
}) {
  const hasItems = !!note || tasks.length > 0 || events.length > 0;
  const label = isToday
    ? `Today · ${formatShortDate(dateStr)}`
    : formatShortDate(dateStr);

  // Events and tasks interleave chronologically: all-day events first, then
  // timed items by clock, then undated tasks.
  const rows = [
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
          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md text-ink-500 opacity-60 hover:bg-white/8 hover:text-ink-200 group-hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
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
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

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
  const preview = parse
    ? `${formatShortDate(parse.date ?? fallbackDay)}${
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
        date: parse.date ?? fallbackDay,
        startMin: parse.startMin,
        endMin: parse.endMin,
      });
      setValue("");
      onCreated();
      onClose();
    } catch (err) {
      console.error("[calendar] create event failed:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border-[1.5px] border-dashed border-sage/50 bg-sage/5 px-3 py-2">
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
