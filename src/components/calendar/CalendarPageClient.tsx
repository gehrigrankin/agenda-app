"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
} from "lucide-react";

import {
  listDailyNoteDatesAction,
  listTasksForRangeAction,
  type RangeTaskResult,
} from "@/app/app/actions";
import { localDateString } from "@/lib/dates";

/**
 * Month calendar page. Each day cell shows the daily-note indicator and the
 * tasks due that day; clicking a past day or today jumps to that day's home
 * view. Events (and multi-day spans) arrive once an events model exists —
 * tasks and notes are the calendar's content for now.
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_TASKS_PER_CELL = 3;

/** "2026-07" for a year/month pair. */
function monthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function CalendarPageClient() {
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

    return () => {
      cancelled = true;
    };
  }, [anchor]);

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

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 md:pl-[5.75rem] lg:overflow-hidden">
      {/* Header */}
      <div className="flex flex-none items-center gap-2">
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
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid flex-none grid-cols-7 gap-1.5">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="px-2 text-[0.625rem] font-medium uppercase tracking-wide text-ink-600"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Month grid */}
      <div
        className="grid min-h-0 flex-1 grid-cols-7 gap-1.5"
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
}: {
  day: number;
  dateStr: string;
  today: string | null;
  hasNote: boolean;
  tasks: RangeTaskResult[];
}) {
  const router = useRouter();
  const isToday = today !== null && dateStr === today;
  const isPast = today !== null && dateStr < today;
  const clickable = isToday || isPast;

  const open = () => {
    if (!clickable) return;
    router.push(isToday ? "/app" : `/app?d=${dateStr}`);
  };

  const shown = tasks.slice(0, MAX_TASKS_PER_CELL);
  const hidden = tasks.length - shown.length;

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
