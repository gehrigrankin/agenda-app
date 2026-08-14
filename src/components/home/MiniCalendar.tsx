"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";

import {
  listDailyNoteDatesAction,
  listTaskDueDatesAction,
} from "@/app/app/actions";
import {
  listEventsForRangeAction,
  listIcsEventsForRangeAction,
} from "@/app/app/calendar/actions";
import { addDays, parseLocalDate } from "@/lib/dates";
import {
  dedupeSpans,
  spanSegmentsForDay,
  toSpan,
  type DaySpanSegment,
  type EventSpan,
} from "@/lib/event-spans";

/**
 * Month calendar (foot of the home rail). Pages across months; every day —
 * past, today, or future — navigates to that day's home view. Indicator dots
 * under each day: steel = a daily note exists, sage = open tasks due (red once
 * overdue), and an event-violet dot = calendar events that day (quick-add or
 * the ICS feed). Event dots used to be steel too, which made "there's a note"
 * and "there's a meeting" the same mark; they're their own token now. Dots
 * render on today's cell as well — suppressing them there hid exactly the
 * day you most need to read.
 *
 * A multi-day event draws ONE bar across its days instead of a dot per day
 * (lib/event-spans): the bar spans the full column so neighbouring cells
 * touch, and only the true first/last day gets a rounded end — a week
 * boundary is a clip, so it stays square and reads as continuing.
 * The maximize control opens the full calendar page.
 *
 * `viewed` is the day the home is currently showing. It gets a ring while
 * today keeps the filled sage chip: on an agenda you need to see where you are
 * AND where now is, and collapsing the two loses your place the moment you
 * flip off today.
 */
export function MiniCalendar({
  today,
  viewed,
  onGo,
}: {
  today: string | null;
  viewed?: string | null;
  /**
   * Flip the home to a day. Same handler the pager uses, so a calendar jump
   * costs no more than an arrow press — it moves the home's state rather than
   * navigating, and lands instantly on any day already in the warm window.
   */
  onGo: (target: string) => void;
}) {
  // Viewed month, YYYY-MM. Anchored to the day being viewed once it resolves,
  // then paged freely — flipping the home to another month should bring the
  // calendar along rather than stranding it on today's month.
  const [month, setMonth] = useState<string | null>(null);
  const anchor = viewed ?? today;
  useEffect(() => {
    if (anchor) setMonth(anchor.slice(0, 7));
  }, [anchor]);

  // date (YYYY-MM-DD) → daily note id; days with open tasks due; days with
  // calendar events (quick-add or ICS).
  const [dailies, setDailies] = useState<Map<string, string>>(new Map());
  const [dueDays, setDueDays] = useState<Set<string>>(new Set());
  const [eventDays, setEventDays] = useState<Set<string>>(new Set());
  // Multi-day events, one entry each (not one per covered day).
  const [spans, setSpans] = useState<EventSpan[]>([]);

  useEffect(() => {
    if (!month) return;
    let cancelled = false;
    const base = parseLocalDate(`${month}-01`);
    const daysInMonth = new Date(
      base.getFullYear(),
      base.getMonth() + 1,
      0,
    ).getDate();
    const end = `${month}-${String(daysInMonth).padStart(2, "0")}`;
    listDailyNoteDatesAction(`${month}-01`, end)
      .then((rows) => {
        if (cancelled) return;
        setDailies(new Map(rows.map((r) => [r.date, r.id])));
      })
      .catch((err) => console.error("[calendar] load failed:", err));
    // Task dot = OPEN tasks only — a "something needs you" signal. This is
    // intentionally narrower than /app/calendar's month grid, which lists
    // open + done tasks; the difference is by design, not a bug.
    listTaskDueDatesAction(`${month}-01`, end)
      .then((days) => {
        if (cancelled) return;
        setDueDays(new Set(days));
      })
      .catch((err) => console.error("[calendar] due-days load failed:", err));
    // Event dot: quick-add + ICS feed days, one fetch per viewed month. Each
    // source degrades independently — a feed failure just means no dot.
    Promise.all([
      listEventsForRangeAction(`${month}-01`, end).catch((err) => {
        console.error("[calendar] event-days load failed:", err);
        return [];
      }),
      listIcsEventsForRangeAction(`${month}-01`, end).catch((err) => {
        console.error("[calendar] ics-days load failed:", err);
        return { configured: false, events: [] };
      }),
    ]).then(([userEvents, ics]) => {
      if (cancelled) return;
      const nextSpans = dedupeSpans([
        ...userEvents
          .map((e) => toSpan(`u:${e.id}`, e.title, e.localDate, e.endLocalDate))
          .filter((s): s is EventSpan => s !== null),
        ...ics.events
          .map((e) => toSpan(`i:${e.uid}:${e.spanStart}`, e.title, e.spanStart, e.spanEnd))
          .filter((s): s is EventSpan => s !== null),
      ]);
      setSpans(nextSpans);
      // Days a bar already covers keep no dot — the bar IS the indicator.
      const spanned = new Set<string>();
      for (const s of nextSpans) {
        for (let d = s.start; d <= s.end; d = addDays(d, 1)) spanned.add(d);
      }
      setEventDays(
        new Set(
          [
            ...userEvents.map((e) => e.localDate),
            ...ics.events.map((e) => e.date),
          ].filter((d) => !spanned.has(d)),
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [month]);

  if (!today || !month) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex flex-none items-center gap-1 px-3 pb-1.5 pt-3">
          <div className="h-3.5 w-16 animate-pulse rounded bg-white/6" />
        </div>
        <div className="grid flex-1 auto-rows-[1.75rem] grid-cols-7 content-evenly px-2.5 pb-2 text-center">
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
            <span
              key={i}
              className="self-center text-[0.5625rem] font-medium text-ink-700"
            >
              {d}
            </span>
          ))}
          {Array.from({ length: 42 }).map((_, i) => (
            <span
              key={i}
              className="mx-auto h-[0.3125rem] w-[0.3125rem] animate-pulse self-center rounded-full bg-white/6"
            />
          ))}
        </div>
      </div>
    );
  }

  const base = parseLocalDate(`${month}-01`);
  const year = base.getFullYear();
  const monthIdx = base.getMonth();
  const firstWeekday = new Date(year, monthIdx, 1).getDay();
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const monthName = base.toLocaleDateString("en-US", { month: "long" });

  const page = (delta: number) => {
    const d = new Date(year, monthIdx + delta, 1);
    setMonth(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
    );
  };

  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-none items-center gap-1 px-3 pb-1.5 pt-3">
        <button
          type="button"
          onClick={() => setMonth(today.slice(0, 7))}
          title="Back to this month"
          className="flex items-baseline gap-1.5 rounded-md px-1 hover:bg-white/5"
        >
          <span className="text-[0.78125rem] font-semibold text-ink-100">
            {monthName}
          </span>
          <span className="text-[0.71875rem] text-ink-600">{year}</span>
        </button>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => page(-1)}
            className="flex h-[1.25rem] w-[1.25rem] items-center justify-center rounded-md hover:bg-white/6"
          >
            <ChevronLeft className="h-3 w-3 text-ink-500" />
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => page(1)}
            className="flex h-[1.25rem] w-[1.25rem] items-center justify-center rounded-md hover:bg-white/6"
          >
            <ChevronRight className="h-3 w-3 text-ink-500" />
          </button>
          <Link
            href="/app/calendar"
            aria-label="Open full calendar"
            title="Open full calendar"
            className="flex h-[1.25rem] w-[1.25rem] items-center justify-center rounded-md hover:bg-white/6"
          >
            <Maximize2 className="h-2.5 w-2.5 text-ink-600" />
          </Link>
        </div>
      </div>
      {/* Structural rem rows (not font-relative): immune to browser
          minimum-font-size floors that inflate glyphs but not line-heights. */}
      <div className="grid flex-1 auto-rows-[1.75rem] grid-cols-7 content-evenly px-2.5 pb-2 text-center">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <span
            key={i}
            className="self-center text-[0.5625rem] font-medium text-ink-600"
          >
            {d}
          </span>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <span key={`b${i}`} />;
          const dateStr = `${month}-${String(day).padStart(2, "0")}`;
          return (
            <DayCell
              key={dateStr}
              day={day}
              dateStr={dateStr}
              today={today}
              isViewed={dateStr === viewed}
              onGo={onGo}
              hasNote={dailies.has(dateStr)}
              hasDue={dueDays.has(dateStr)}
              hasEvent={eventDays.has(dateStr)}
              // `cells` starts at column 0 (leading blanks included), so a
              // multiple of 7 is the first column of a week row.
              spans={spanSegmentsForDay(spans, dateStr, i % 7 === 0)}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * One day: a proper hover target. Every day — past, today, or future —
 * navigates to that day's home view (future days let you plan ahead and jot
 * notes for a day that hasn't arrived yet).
 */
function DayCell({
  day,
  dateStr,
  today,
  isViewed,
  onGo,
  hasNote,
  hasDue,
  hasEvent,
  spans,
}: {
  day: number;
  dateStr: string;
  today: string;
  /** The day the home is showing — ringed, so you can see where you are. */
  isViewed: boolean;
  onGo: (target: string) => void;
  hasNote: boolean;
  hasDue: boolean;
  hasEvent: boolean;
  /** Multi-day events crossing this day (at most two bars are drawn). */
  spans: DaySpanSegment[];
}) {
  const isToday = dateStr === today;
  const isPast = dateStr < today;
  const clickable = true;

  // On today's sage chip the palette dots would sit on their own hue and
  // vanish; there they render in the chip's ink instead, so the day still
  // says "note / due / event" without a second colour system.
  const dot = (tone: string) =>
    `h-[0.1875rem] w-[0.1875rem] rounded-full ${isToday ? "bg-sage-ink/70" : tone}`;
  const dots = (
    <span
      aria-hidden
      className="absolute inset-x-0 bottom-[0.0625rem] flex items-center justify-center gap-[0.1875rem]"
    >
      {hasNote && <span className={dot("bg-steel")} />}
      {hasDue && <span className={dot(isPast ? "bg-[#D9938A]" : "bg-sage")} />}
      {hasEvent && <span className={dot("bg-event")} />}
    </span>
  );

  // One bar, not a stack: a 1.5rem chip in a 1.75rem row leaves 0.125rem of
  // clear space under it, which is exactly one hairline bar. Further spans on
  // the same day live in the cell's title — the month rail is an indicator,
  // and /app/calendar is where the runs are actually read.
  const bars = spans.slice(0, 1).map((s) => (
    <span
      key={s.key}
      aria-hidden
      // Full COLUMN width (not the chip's 1.5rem): the grid has no gap, so a
      // bar and its neighbour meet and read as one continuous run.
      className={`h-[0.125rem] w-full bg-event/80 ${
        s.isStart ? "rounded-l-full" : ""
      } ${s.isEnd ? "rounded-r-full" : ""}`}
    />
  ));

  const button = (
    <button
      type="button"
      disabled={!clickable}
      aria-label={isToday ? "Go to today" : `View ${dateStr}`}
      aria-current={isViewed ? "date" : undefined}
      title={
        [
          hasNote && "Daily note",
          hasDue && "Tasks due",
          hasEvent && "Events",
          ...spans.map((s) => s.title),
        ]
          .filter(Boolean)
          .join(" · ") || undefined
      }
      onClick={() => {
        if (!clickable) return;
        onGo(dateStr);
      }}
      className={`relative mx-auto flex h-[1.5rem] w-[1.5rem] items-center justify-center self-center rounded-[0.375rem] text-[0.6875rem] leading-none ${
        isToday
          ? "bg-sage font-semibold text-sage-ink"
          : clickable
            ? `hover:bg-white/8 ${hasNote ? "font-medium text-ink-100" : "text-ink-400"}`
            : "text-ink-500"
      } ${
        // Ring, not a fill: today's chip stays the loudest mark on the month
        // even while you're reading some other day. Inset so the ring sits
        // inside the cell and can't nudge the grid.
        isViewed && !isToday
          ? "shadow-[inset_0_0_0_1px_rgb(154_179_162/0.85)] text-ink-100"
          : ""
      }`}
    >
      {day}
      {dots}
    </button>
  );

  if (bars.length === 0) return button;
  // The bar has to escape the day chip to touch its neighbours, so the chip
  // gets a full-column wrapper and the bars are positioned against that.
  return (
    <span className="relative flex h-[1.75rem] items-center justify-center self-center">
      {button}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col">
        {bars}
      </span>
    </span>
  );
}
