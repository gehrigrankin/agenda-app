"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";

import {
  listDailyNoteDatesAction,
  listTaskDueDatesAction,
} from "@/app/app/actions";
import { parseLocalDate } from "@/lib/dates";

/**
 * Month calendar widget (bottom row). Pages across months; every past day and
 * today navigate to that day's home view. Indicator dots under each day:
 * steel = a daily note exists, sage = open tasks due (red once overdue).
 * Multi-day event spans wait on a real events model. The maximize control
 * opens the full calendar page.
 */
export function MiniCalendar({ today }: { today: string | null }) {
  // Viewed month, YYYY-MM. Anchored to today once it resolves; then paged.
  const [month, setMonth] = useState<string | null>(null);
  useEffect(() => {
    if (today && month === null) setMonth(today.slice(0, 7));
  }, [today, month]);

  // date (YYYY-MM-DD) → daily note id; days with open tasks due.
  const [dailies, setDailies] = useState<Map<string, string>>(new Map());
  const [dueDays, setDueDays] = useState<Set<string>>(new Set());

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
    listTaskDueDatesAction(`${month}-01`, end)
      .then((days) => {
        if (cancelled) return;
        setDueDays(new Set(days));
      })
      .catch((err) => console.error("[calendar] due-days load failed:", err));
    return () => {
      cancelled = true;
    };
  }, [month]);

  if (!today || !month) {
    return <div className="flex-1" />;
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
              hasNote={dailies.has(dateStr)}
              hasDue={dueDays.has(dateStr)}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * One day: a proper hover target. Past days and today navigate to that day's
 * home view; future days are inert until events exist.
 */
function DayCell({
  day,
  dateStr,
  today,
  hasNote,
  hasDue,
}: {
  day: number;
  dateStr: string;
  today: string;
  hasNote: boolean;
  hasDue: boolean;
}) {
  const router = useRouter();
  const isToday = dateStr === today;
  const isPast = dateStr < today;
  const clickable = isToday || isPast;

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
    </span>
  );

  return (
    <button
      type="button"
      disabled={!clickable}
      aria-label={isToday ? "Go to today" : `View ${dateStr}`}
      title={
        hasNote && hasDue
          ? "Daily note · tasks due"
          : hasNote
            ? "Daily note"
            : hasDue
              ? "Tasks due"
              : undefined
      }
      onClick={() => {
        if (!clickable) return;
        router.push(isToday ? "/app" : `/app?d=${dateStr}`);
      }}
      className={`relative mx-auto flex h-[1.5rem] w-[1.5rem] items-center justify-center self-center rounded-[0.4375rem] text-[0.6875rem] leading-none ${
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
