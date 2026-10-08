"use client";

import {
  dayMetaLine,
  dayOfMonth,
  relativeDayTag,
  weekdayLong,
} from "@/lib/agenda-today";

import { PageArrow } from "./atoms";

/**
 * The day's printed header: the big date number, the weekday with a
 * Today/Yesterday/Tomorrow tag, "JULY · WEEK 28 · DAY 190", the ‹ › arrows,
 * and the heavy rule under it all — the line an agenda page starts below.
 */
export function DayHeader({
  date,
  today,
  wide,
  onPrev,
  onNext,
}: {
  date: string;
  today: string;
  wide: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const tag = relativeDayTag(date, today);
  return (
    <div
      className={`flex flex-none items-end border-b-2 border-ink-300 ${
        wide ? "gap-3.5 pb-3" : "mx-5 gap-3 pb-2.5"
      }`}
    >
      <span
        className={`font-semibold leading-[0.82] tracking-[-0.125rem] text-ink-100 ${
          wide ? "text-[3.75rem]" : "text-[3.375rem]"
        }`}
      >
        {dayOfMonth(date)}
      </span>
      <div
        className={`flex min-w-0 flex-col ${wide ? "flex-none gap-1.5" : "flex-1 gap-[0.3125rem]"}`}
      >
        <div className="flex items-baseline gap-2">
          <span
            className={`font-semibold leading-none text-ink-100 ${
              wide ? "text-[1.3125rem]" : "text-[1.1875rem]"
            }`}
          >
            {weekdayLong(date)}
          </span>
          {tag && (
            <span
              className={`font-mono font-semibold uppercase leading-none tracking-[0.0625rem] ${
                wide ? "text-[0.625rem]" : "text-[0.59375rem]"
              } ${tag === "Today" ? "text-sage" : "text-ink-500"}`}
            >
              {tag}
            </span>
          )}
        </div>
        <span
          className={`truncate font-mono font-medium uppercase leading-none tracking-[0.075rem] text-ink-500 ${
            wide ? "text-[0.6875rem]" : "text-[0.65625rem]"
          }`}
        >
          {dayMetaLine(date)}
        </span>
      </div>
      {wide && <span className="flex-1" />}
      <div className={`flex ${wide ? "-mb-2" : "-mb-2 -mr-2.5"}`}>
        <PageArrow dir="prev" onClick={onPrev} label="Previous day" />
        <PageArrow dir="next" onClick={onNext} label="Next day" />
      </div>
    </div>
  );
}
