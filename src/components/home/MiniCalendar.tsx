"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Maximize2 } from "lucide-react";

import { listDailyNoteDatesAction } from "@/app/app/actions";
import { parseLocalDate } from "@/lib/dates";

/**
 * Mini month calendar (bottom widget row): today is the sage dot, and past
 * days that have a daily note link to `/app?d=`. Current month only — paging
 * comes with the full calendar view later.
 */
export function MiniCalendar({ today }: { today: string | null }) {
  // date (YYYY-MM-DD) → daily note id, for the viewed month.
  const [dailies, setDailies] = useState<Map<string, string>>(new Map());

  const monthPrefix = today ? today.slice(0, 7) : null; // "2026-07"

  useEffect(() => {
    if (!monthPrefix || !today) return;
    let cancelled = false;
    const base = parseLocalDate(`${monthPrefix}-01`);
    const daysInMonth = new Date(
      base.getFullYear(),
      base.getMonth() + 1,
      0,
    ).getDate();
    const end = `${monthPrefix}-${String(daysInMonth).padStart(2, "0")}`;
    listDailyNoteDatesAction(`${monthPrefix}-01`, end)
      .then((rows) => {
        if (cancelled) return;
        setDailies(new Map(rows.map((r) => [r.date, r.id])));
      })
      .catch((err) => console.error("[calendar] load failed:", err));
    return () => {
      cancelled = true;
    };
  }, [monthPrefix, today]);

  if (!today) {
    return <div className="h-full" />;
  }

  const base = parseLocalDate(today);
  const year = base.getFullYear();
  const month = base.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthName = base.toLocaleDateString("en-US", { month: "long" });

  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    // No min-h-0: the grid's structural height must propagate so the widget
    // row grows rather than clipping weeks when a browser font floor bites.
    <div className="flex h-full flex-col">
      <div className="flex flex-none items-center gap-1.5 px-3 pb-1 pt-2.5">
        <span className="text-[0.71875rem] font-semibold text-ink-100">
          {monthName}
        </span>
        <span className="text-[0.71875rem] text-ink-600">{year}</span>
        <span
          className="ml-auto flex h-[1.125rem] w-[1.125rem] items-center justify-center rounded-[0.3125rem]"
          title="Full calendar coming soon"
        >
          <Maximize2 className="h-2.5 w-2.5 text-ink-600" />
        </span>
      </div>
      {/* Rows are fixed rem (not font-relative): a browser minimum-font-size
          floor inflates glyphs but not line-heights, which overlapped the
          weeks. Structural rows keep them apart in every environment. */}
      <div className="grid flex-1 auto-rows-[1.125rem] grid-cols-7 content-evenly px-2.5 pb-2 text-center">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <span key={i} className="text-[0.5rem] font-medium text-ink-600">
            {d}
          </span>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <span key={`b${i}`} />;
          const dateStr = `${monthPrefix}-${String(day).padStart(2, "0")}`;
          if (dateStr === today) {
            return (
              <span
                key={dateStr}
                className="inline-flex h-[0.9375rem] w-[0.9375rem] items-center justify-center justify-self-center rounded-full bg-sage text-[0.5625rem] font-semibold text-sage-ink"
              >
                {day}
              </span>
            );
          }
          if (dateStr < today && dailies.has(dateStr)) {
            return (
              <Link
                key={dateStr}
                href={`/app?d=${dateStr}`}
                className="text-[0.5625rem] leading-[1.7] text-ink-300 underline-offset-2 hover:text-sage hover:underline"
              >
                {day}
              </Link>
            );
          }
          return (
            <span
              key={dateStr}
              className={`text-[0.5625rem] leading-[1.7] ${dateStr < today ? "text-ink-400" : "text-ink-300"}`}
            >
              {day}
            </span>
          );
        })}
      </div>
    </div>
  );
}
