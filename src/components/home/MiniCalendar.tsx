"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";

import {
  getMiniCalendarMonthAction,
  type MiniCalendarMonthData,
} from "@/app/app/calendar/actions";
import { daySpanSegments } from "@/lib/calendar-grid";
import { parseLocalDate } from "@/lib/dates";

/**
 * Month calendar widget (bottom row). Pages across months; every day — past,
 * today, or future — navigates to that day's home view. Indicator dots under
 * each day: steel = a daily note exists, sage = open tasks due (red once
 * overdue), and a second steel dot = a single-day calendar event (quick-add
 * or the ICS feed). Multi-day all-day ICS events render instead as a
 * continuous steel bar spanning the days they cover (`daySpanSegments`,
 * lib/calendar-grid.ts) rather than a dot per day. One
 * `getMiniCalendarMonthAction` call per viewed month feeds all three:
 * day-click navigation, the dots, and the bars. The maximize control opens
 * the full calendar page.
 */
export function MiniCalendar({ today }: { today: string | null }) {
  // Viewed month, YYYY-MM. Anchored to today once it resolves; then paged.
  const [month, setMonth] = useState<string | null>(null);
  useEffect(() => {
    if (today && month === null) setMonth(today.slice(0, 7));
  }, [today, month]);

  // date (YYYY-MM-DD) → daily note id; days with open tasks due; days with a
  // single-day event; multi-day event spans.
  const [dailies, setDailies] = useState<Map<string, string>>(new Map());
  const [dueDays, setDueDays] = useState<Set<string>>(new Set());
  const [eventDays, setEventDays] = useState<Set<string>>(new Set());
  const [spans, setSpans] = useState<MiniCalendarMonthData["spans"]>([]);

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
    // Task dot = OPEN tasks only — a "something needs you" signal. This is
    // intentionally narrower than /app/calendar's month grid, which lists
    // open + done tasks; the difference is by design, not a bug.
    getMiniCalendarMonthAction(`${month}-01`, end)
      .then((data) => {
        if (cancelled) return;
        setDailies(new Map(data.dailyNotes.map((r) => [r.date, r.id])));
        setDueDays(new Set(data.dueDays));
        setEventDays(new Set(data.eventDays));
        setSpans(data.spans);
      })
      .catch((err) => console.error("[calendar] load failed:", err));
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

  const spanSegments = spans.flatMap((span) =>
    daySpanSegments(span, firstWeekday),
  );

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
            className="flex h-[1.25rem] w-[1.25rem] items-center justify-center rounded-[0.3125rem] hover:bg-white/6"
          >
            <ChevronLeft className="h-3 w-3 text-ink-500" />
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => page(1)}
            className="flex h-[1.25rem] w-[1.25rem] items-center justify-center rounded-[0.3125rem] hover:bg-white/6"
          >
            <ChevronRight className="h-3 w-3 text-ink-500" />
          </button>
          <Link
            href="/app/calendar"
            aria-label="Open full calendar"
            title="Open full calendar"
            className="flex h-[1.25rem] w-[1.25rem] items-center justify-center rounded-[0.3125rem] hover:bg-white/6"
          >
            <Maximize2 className="h-2.5 w-2.5 text-ink-600" />
          </Link>
        </div>
      </div>
      <div className="relative flex-1">
        {/* Multi-day event bars: a separate grid, identical column/row
            tracks, stacked under the day grid below so the day numbers stay
            legible on top. Grid line placement (not pixel math) keeps it
            aligned regardless of `content-evenly`'s row spacing. */}
        {spanSegments.length > 0 && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 grid auto-rows-[1.75rem] grid-cols-7 content-evenly px-2.5 pb-2"
          >
            {spanSegments.map((seg, i) => (
              <span
                key={`${seg.uid}-${i}`}
                title={seg.title}
                style={{
                  gridRow: seg.row + 2,
                  gridColumn: `${seg.startCol + 1} / ${seg.endCol + 2}`,
                }}
                className={`pointer-events-auto h-[0.125rem] self-start bg-steel/60 ${
                  seg.roundStart ? "rounded-l-full" : ""
                } ${seg.roundEnd ? "rounded-r-full" : ""}`}
              />
            ))}
          </div>
        )}
        {/* Structural rem rows (not font-relative): immune to browser
            minimum-font-size floors that inflate glyphs but not line-heights. */}
        <div className="grid h-full auto-rows-[1.75rem] grid-cols-7 content-evenly px-2.5 pb-2 text-center">
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
                hasNote={dailies.has(dateStr)}
                hasDue={dueDays.has(dateStr)}
                hasEvent={eventDays.has(dateStr)}
              />
            );
          })}
        </div>
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
  hasNote,
  hasDue,
  hasEvent,
}: {
  day: number;
  dateStr: string;
  today: string;
  hasNote: boolean;
  hasDue: boolean;
  hasEvent: boolean;
}) {
  const router = useRouter();
  const isToday = dateStr === today;
  const isPast = dateStr < today;
  const clickable = true;

  const dots = (
    <span
      aria-hidden
      className="absolute inset-x-0 bottom-[0.0625rem] flex items-center justify-center gap-[0.1875rem]"
    >
      {hasNote && (
        <span className="h-[0.1875rem] w-[0.1875rem] rounded-full bg-steel" />
      )}
      {hasDue && (
        <span
          className={`h-[0.1875rem] w-[0.1875rem] rounded-full ${
            isPast ? "bg-[#D9938A]" : "bg-sage"
          }`}
        />
      )}
      {hasEvent && (
        <span className="h-[0.1875rem] w-[0.1875rem] rounded-full bg-steel" />
      )}
    </span>
  );

  return (
    <button
      type="button"
      disabled={!clickable}
      aria-label={isToday ? "Go to today" : `View ${dateStr}`}
      title={
        [
          hasNote && "Daily note",
          hasDue && "Tasks due",
          hasEvent && "Events",
        ]
          .filter(Boolean)
          .join(" · ") || undefined
      }
      onClick={() => {
        if (!clickable) return;
        router.push(isToday ? "/app" : `/app?d=${dateStr}`);
      }}
      className={`relative mx-auto flex h-[1.5rem] w-[1.5rem] items-center justify-center self-center rounded-[0.375rem] text-[0.6875rem] leading-none ${
        isToday
          ? "bg-sage font-semibold text-sage-ink"
          : clickable
            ? `hover:bg-white/8 ${hasNote ? "font-medium text-ink-100" : "text-ink-400"}`
            : "text-ink-500"
      }`}
    >
      {day}
      {!isToday && dots}
    </button>
  );
}
