"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import {
  getCalendarRangeDataAction,
  listIcsEventsForRangeAction,
  type CalendarRangeData,
} from "@/app/app/calendar/actions";
import { monthBounds, monthCells, stepAnchor } from "@/lib/calendar-grid";
import { parseLocalDate } from "@/lib/dates";
import { loadCachedThenRefresh, viewCacheKey } from "@/lib/indexeddb-cache";
import type { RangeCalendarEvent } from "@/server/calendar";

import { markedDays } from "./phone-items";

/**
 * The phone Calendar's full month grid — the old phone Month view, kept
 * reachable from the month sheet ("Month grid"). One cell per day with dots
 * for events (purple), tasks (sage) and the daily note (steel); tapping a day
 * returns to the day agenda on that day.
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function PhoneMonthView({
  cacheScope,
  today,
  selected,
  onPick,
  onBack,
}: {
  cacheScope: string;
  today: string | null;
  selected: string;
  onPick: (day: string) => void;
  onBack: () => void;
}) {
  const [month, setMonth] = useState(selected);
  const range = useMemo(() => monthBounds(month), [month]);
  const [local, setLocal] = useState<{
    key: string;
    data: CalendarRangeData;
  } | null>(null);
  const [icsState, setIcsState] = useState<{
    key: string;
    events: RangeCalendarEvent[];
  } | null>(null);
  const key = `${range.start}:${range.end}`;

  useEffect(() => {
    let cancelled = false;
    void loadCachedThenRefresh({
      key: viewCacheKey(cacheScope, "calendar-local", key),
      refresh: () => getCalendarRangeDataAction(range.start, range.end),
      onValue: (data) => setLocal({ key, data }),
      onError: (err) => console.error("[calendar] month load failed:", err),
      cancelled: () => cancelled,
    });
    void loadCachedThenRefresh({
      key: viewCacheKey(cacheScope, "calendar-ics", key),
      refresh: () => listIcsEventsForRangeAction(range.start, range.end),
      onValue: (r) => setIcsState({ key, events: r.events }),
      onError: (err) => console.error("[calendar] month ICS failed:", err),
      cancelled: () => cancelled,
    });
    return () => {
      cancelled = true;
    };
  }, [cacheScope, key, range.start, range.end]);

  const cur = local && local.key === key ? local.data : null;
  const ics = icsState && icsState.key === key ? icsState.events : null;
  const events = useMemo(
    () => markedDays(cur?.events ?? [], ics ?? [], [], []),
    [cur, ics],
  );
  const tasks = useMemo(
    () => new Set(cur?.tasks.map((t) => t.due) ?? []),
    [cur],
  );
  const notes = useMemo(
    () => new Set(cur?.notes.map((n) => n.date) ?? []),
    [cur],
  );

  const title = parseLocalDate(month).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const cells = monthCells(month);

  return (
    <div className="flex h-full min-h-0 flex-col px-3 pt-2 md:hidden">
      <div className="flex h-[3.25rem] flex-none items-center gap-1">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 flex h-11 items-center gap-0.5 rounded-lg pr-2 pl-1 text-[0.9375rem] text-sage focus-visible:outline-2 focus-visible:outline-sage/70"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
          Day
        </button>
        <h1 className="min-w-0 flex-1 truncate text-center text-[1.0625rem] font-semibold text-ink-100">
          {title}
        </h1>
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setMonth(stepAnchor(month, "month", -1))}
          className="flex h-11 w-11 items-center justify-center rounded-full text-ink-300 focus-visible:outline-2 focus-visible:outline-sage/70"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setMonth(stepAnchor(month, "month", 1))}
          className="flex h-11 w-11 items-center justify-center rounded-full text-ink-300 focus-visible:outline-2 focus-visible:outline-sage/70"
        >
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <div className="grid flex-none grid-cols-7 gap-1 pb-1">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="px-1 text-[0.6875rem] font-medium uppercase tracking-wide text-ink-600"
          >
            {d}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 content-start auto-rows-[4.5rem] grid-cols-7 gap-1 overflow-y-auto pb-3">
        {cells.map((d, i) =>
          d === null ? (
            <div
              key={`pad-${i}`}
              className="rounded-xl border border-white/4 bg-panel/30"
            />
          ) : (
            <button
              key={d}
              type="button"
              onClick={() => onPick(d)}
              aria-label={parseLocalDate(d).toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
              aria-current={d === today ? "date" : undefined}
              className={`flex min-h-11 flex-col items-start rounded-xl border p-1.5 text-left focus-visible:outline-2 focus-visible:outline-sage/70 ${
                d === selected
                  ? "border-sage/60 bg-sage/12"
                  : d === today
                    ? "border-sage/40 bg-sage/8"
                    : "border-white/7 bg-panel/70"
              }`}
            >
              <span
                className={`text-[0.8125rem] font-semibold leading-none ${
                  d === today
                    ? "flex h-5 w-5 items-center justify-center rounded-full bg-sage text-[0.6875rem] text-sage-ink"
                    : today && d < today
                      ? "text-ink-500"
                      : "text-ink-200"
                }`}
              >
                {Number(d.slice(8))}
              </span>
              <span className="mt-auto flex items-center gap-1 px-0.5 pb-0.5">
                {events.has(d) && (
                  <span className="h-1.5 w-1.5 rounded-full bg-event" />
                )}
                {tasks.has(d) && (
                  <span className="h-1.5 w-1.5 rounded-full bg-sage" />
                )}
                {notes.has(d) && (
                  <span className="h-1.5 w-1.5 rounded-full bg-steel" />
                )}
              </span>
            </button>
          ),
        )}
      </div>
    </div>
  );
}
