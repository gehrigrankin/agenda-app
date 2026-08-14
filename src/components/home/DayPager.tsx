"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { addDays, formatLongDate, localDateString } from "@/lib/dates";

/**
 * Page turn for the daily home: ‹ yesterday · today · tomorrow ›.
 *
 * The home is an agenda, not a dashboard pinned to today — flipping to an
 * adjacent day should cost one click from wherever you are, the way a paper
 * planner turns. Days are addressable as `?d=YYYY-MM-DD` (today drops the
 * param so "/app" always means now), so every flip is a real navigation the
 * back button understands.
 *
 * There is no travel limit in either direction. Past days are the record;
 * future days are where you plan, and the daily note for a day that hasn't
 * arrived is created on demand the moment you write in it.
 */
export function DayPager({
  dateStr,
  size = "sm",
}: {
  dateStr: string;
  /** "md" is the phone header's touch-sized variant. */
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const today = localDateString();
  const isToday = dateStr === today;

  const go = (target: string) =>
    router.push(target === today ? "/app" : `/app?d=${target}`);

  const btn =
    size === "md"
      ? "flex h-8 w-8 items-center justify-center rounded-lg border border-white/8 bg-white/5 text-ink-300 hover:bg-white/10"
      : "flex h-[1.375rem] w-[1.375rem] items-center justify-center rounded-md text-ink-500 hover:bg-white/8 hover:text-ink-300";
  const icon = size === "md" ? "h-4 w-4" : "h-3 w-3";

  return (
    <div className="flex flex-none items-center gap-0.5">
      <button
        type="button"
        onClick={() => go(addDays(dateStr, -1))}
        aria-label={`Previous day, ${formatLongDate(addDays(dateStr, -1))}`}
        title="Previous day"
        className={btn}
      >
        <ChevronLeft className={icon} />
      </button>
      {/* Only offered when it would actually move you — on today it would be a
          button that does nothing, which reads as broken rather than calm. */}
      {!isToday && (
        <button
          type="button"
          onClick={() => go(today)}
          title="Back to today"
          className={
            size === "md"
              ? "flex h-8 items-center rounded-lg border border-white/8 bg-white/5 px-2.5 text-[0.75rem] font-medium text-sage hover:bg-white/10"
              : "flex h-[1.375rem] items-center rounded-md px-1.5 text-[0.6875rem] font-medium text-sage hover:bg-white/8"
          }
        >
          Today
        </button>
      )}
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
