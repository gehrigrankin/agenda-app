"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import {
  addDays,
  formatLongDate,
  localDateString,
  parseLocalDate,
} from "@/lib/dates";

/**
 * Page turn for the daily home: ‹ yesterday · today · tomorrow ›.
 *
 * The home is an agenda, not a dashboard pinned to today — flipping to an
 * adjacent day should cost one click from wherever you are, the way a paper
 * planner turns. It doesn't navigate: `onGo` moves the home's own viewed-day
 * state against a prefetched window, so a flip is a re-render, not a page load.
 *
 * There is no travel limit in either direction. Past days are the record;
 * future days are where you plan, and the daily note for a day that hasn't
 * arrived is created on demand the moment you write in it.
 */
export function DayPager({
  dateStr,
  onGo,
  size = "sm",
  showTodayWhenActive = false,
  showViewedLabel = false,
}: {
  dateStr: string;
  onGo: (target: string) => void;
  /** "md" is the phone header's touch-sized variant. */
  size?: "sm" | "md";
  /** Phone header keeps the middle label visible as the pager's anchor. */
  showTodayWhenActive?: boolean;
  /** Phone header labels the current page; tapping it still returns to today. */
  showViewedLabel?: boolean;
}) {
  const today = localDateString();
  const isToday = dateStr === today;

  const go = (target: string) => onGo(target);
  const viewedDate = parseLocalDate(dateStr);
  const day = viewedDate.getDate();
  const ordinal =
    day % 100 >= 11 && day % 100 <= 13
      ? "th"
      : day % 10 === 1
        ? "st"
        : day % 10 === 2
          ? "nd"
          : day % 10 === 3
            ? "rd"
            : "th";
  const middleLabel = showViewedLabel
    ? `${viewedDate.toLocaleDateString("en-US", {
        month: "long",
      })} ${day}${ordinal}, ${viewedDate.toLocaleDateString("en-US", {
        weekday: "long",
      })}`
    : "Today";

  const btn =
    size === "md"
      ? "flex h-11 w-11 items-center justify-center text-ink-300"
      : "flex h-[1.375rem] w-[1.375rem] items-center justify-center rounded-md text-ink-500 hover:bg-white/8 hover:text-ink-300";
  const icon = size === "md" ? "h-5 w-5" : "h-3 w-3";

  return (
    <div
      className={
        size === "md"
          ? "flex w-full min-w-0 items-center gap-0.5"
          : "flex flex-none items-center gap-0.5"
      }
    >
      <button
        type="button"
        onClick={() => go(addDays(dateStr, -1))}
        aria-label={`Previous day, ${formatLongDate(addDays(dateStr, -1))}`}
        title="Previous day"
        className={btn}
      >
        <ChevronLeft className={icon} />
      </button>
      {/* Inert on today rather than unmounted. It would be a button that does
          nothing, so it's hidden — but it keeps its width, because the pager is
          centered and a control that appears the instant you leave today would
          shift the arrows out from under the cursor mid-flip. */}
      <button
        type="button"
        onClick={() => go(today)}
        title="Back to today"
        disabled={isToday}
        tabIndex={isToday ? -1 : undefined}
        aria-current={isToday ? "date" : undefined}
        className={`${
          size === "md"
            ? "flex h-11 min-w-0 flex-1 items-center justify-center truncate whitespace-nowrap px-1 text-lg font-bold text-sage"
            : "flex h-[1.375rem] items-center rounded-md px-1.5 text-[0.6875rem] font-medium text-sage hover:bg-white/8"
        } ${isToday && !showTodayWhenActive ? "invisible" : ""} disabled:cursor-default`}
      >
        <span className={size === "md" ? "block min-w-0 truncate" : undefined}>
          {middleLabel}
        </span>
      </button>
      <button
        type="button"
        onClick={() => go(addDays(dateStr, 1))}
        aria-label={`Next day, ${formatLongDate(addDays(dateStr, 1))}`}
        title="Next day"
        className={btn}
      >
        <ChevronRight className={icon} />
      </button>
    </div>
  );
}
