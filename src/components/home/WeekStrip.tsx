"use client";

import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, PenLine } from "lucide-react";

import {
  addDays,
  formatLongDate,
  formatWeekRange,
  isoWeekNumber,
  parseLocalDate,
} from "@/lib/dates";
import { formatTimeShort } from "@/lib/recurrence";

/**
 * Week strip — the page turn for the agenda home.
 *
 * A paper planner opens on a fixed Monday–Sunday spread: the same seven
 * columns in the same order every week, so the eye learns where Thursday
 * lives. The strip is that spread. It never scrolls and never reflows; the
 * arrows flip whole weeks and the day you pick opens in full underneath.
 * The strip is the page edge, the day below it is the open page — which is
 * why the selected cell carries a sage bar along its bottom edge rather than
 * a box: the bar points down into the page it opened, while today keeps its
 * filled chip so "where I am" and "where now is" never collapse into one mark.
 *
 * A desktop column can afford titles (three, then "+N"); a phone column is
 * ~50px wide, so it gets one dot per item instead — enough to read "Tuesday
 * is full" at a glance. Past cells are dimmed and their done items struck:
 * the record should read quieter than the plan. An empty day still draws one
 * faint ruled line, so it reads as a blank page rather than a missing one.
 */

export type StripItem = {
  id: string;
  title: string;
  kind: "task" | "event";
  done: boolean;
  /** "HH:MM" 24h wall-clock or null (all-day event / untimed task). */
  time: string | null;
};

export type StripDay = {
  dateStr: string;
  items: StripItem[];
  hasNote: boolean;
};

/** Sunday-indexed, matching `Date.getDay()`. The phone label is the initial. */
const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function WeekStrip({
  days,
  today,
  viewed,
  onGo,
  loading,
}: {
  /** Exactly 7 days, Monday first. */
  days: StripDay[];
  /** Client-local today, YYYY-MM-DD. */
  today: string;
  /** The day expanded below the strip. */
  viewed: string;
  /** Flip the page: select a day, or (arrows) the same weekday ±7 days. */
  onGo: (dateStr: string) => void;
  loading: boolean;
}) {
  // Arrow keys can walk off the end of the strip, which flips the week under
  // the focused cell and unmounts it. Remember where focus was headed and
  // restore it once the new week has rendered; one attempt only, so a parent
  // that ignores the move can't steal focus later.
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    cellRefs.current.get(target)?.focus();
  });

  const start = days[0]?.dateStr ?? viewed;
  const showToday = viewed !== today;

  const step = (dateStr: string, delta: number) => {
    const target = addDays(dateStr, delta);
    pendingFocus.current = target;
    onGo(target);
  };

  return (
    <div className="flex flex-none flex-col">
      <div className="flex flex-none items-center gap-2 px-2 pb-1.5 pt-2 md:px-3">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-[0.78125rem] font-semibold text-ink-100">
            {formatWeekRange(start)}
          </span>
          <span className="flex-none text-[0.6875rem] text-ink-600">
            · Week {isoWeekNumber(start)}
          </span>
        </div>
        <div className="ml-auto flex flex-none items-center gap-0.5">
          {/* Inert on the current week rather than unmounted: it keeps its
              width so the arrows never shift out from under the cursor the
              moment you flip off today. Same trick as DayPager. */}
          <button
            type="button"
            onClick={() => onGo(today)}
            title="Back to today"
            disabled={!showToday}
            tabIndex={showToday ? undefined : -1}
            className={`flex h-[1.375rem] items-center rounded-md px-1.5 text-[0.6875rem] font-medium text-sage hover:bg-white/8 disabled:cursor-default ${
              showToday ? "" : "invisible"
            }`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => onGo(addDays(viewed, -7))}
            aria-label="Previous week"
            title="Previous week"
            className="flex h-[1.375rem] w-[1.375rem] items-center justify-center rounded-md text-ink-500 hover:bg-white/8 hover:text-ink-300"
          >
            <ChevronLeft className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => onGo(addDays(viewed, 7))}
            aria-label="Next week"
            title="Next week"
            className="flex h-[1.375rem] w-[1.375rem] items-center justify-center rounded-md text-ink-500 hover:bg-white/8 hover:text-ink-300"
          >
            <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="grid flex-none grid-cols-7 divide-x divide-white/7 border-y border-white/7">
        {days.map((day) => (
          <WeekStripCell
            key={day.dateStr}
            day={day}
            isToday={day.dateStr === today}
            isViewed={day.dateStr === viewed}
            isPast={day.dateStr < today}
            loading={loading}
            onGo={onGo}
            onStep={step}
            registerRef={(el) => {
              if (el) cellRefs.current.set(day.dateStr, el);
              else cellRefs.current.delete(day.dateStr);
            }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One day column. The whole cell is the button — on a strip this dense a
 * 20px date chip would be a miss-tap, and the items under it aren't
 * separately clickable: they're a preview of the page, not links.
 */
function WeekStripCell({
  day,
  isToday,
  isViewed,
  isPast,
  loading,
  onGo,
  onStep,
  registerRef,
}: {
  day: StripDay;
  isToday: boolean;
  isViewed: boolean;
  isPast: boolean;
  loading: boolean;
  onGo: (dateStr: string) => void;
  onStep: (dateStr: string, delta: number) => void;
  registerRef: (el: HTMLButtonElement | null) => void;
}) {
  const date = parseLocalDate(day.dateStr);
  const abbr = WEEKDAY_ABBR[date.getDay()];
  const shown = day.items.slice(0, 3);
  const hidden = day.items.length - shown.length;

  return (
    <button
      ref={registerRef}
      type="button"
      onClick={() => onGo(day.dateStr)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onStep(day.dateStr, -1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          onStep(day.dateStr, 1);
        }
      }}
      aria-pressed={isViewed}
      aria-current={isToday ? "date" : undefined}
      aria-label={formatLongDate(day.dateStr)}
      className={`relative flex min-h-[3.75rem] flex-col overflow-hidden px-1 py-1 text-left hover:bg-white/6 md:min-h-[5.5rem] md:px-1.5 md:py-1.5 ${
        isViewed ? "bg-white/4" : ""
      }`}
    >
      {/* The "this page is open" cue: a bar on the edge the page hangs from,
          rather than an outline that would fight today's chip. */}
      {isViewed && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-sage"
        />
      )}
      {day.hasNote && (
        <PenLine
          aria-hidden
          className="absolute right-1 top-1 hidden h-2.5 w-2.5 text-ink-600 md:block"
        />
      )}

      <span className="flex flex-none items-center justify-center gap-1 md:justify-start">
        <span className="text-[0.5625rem] font-medium uppercase tracking-[0.06em] text-ink-600">
          <span className="md:hidden">{abbr[0]}</span>
          <span className="hidden md:inline">{abbr}</span>
        </span>
        <span
          className={`flex h-[1.25rem] w-[1.25rem] flex-none items-center justify-center rounded-full text-[0.6875rem] leading-none ${
            isToday
              ? "bg-sage font-semibold text-sage-ink"
              : isViewed
                ? "font-semibold text-ink-100 ring-1 ring-sage/40"
                : "text-ink-300"
          }`}
        >
          {date.getDate()}
        </span>
      </span>

      {loading ? (
        <>
          <span className="mt-1.5 hidden flex-col gap-1 md:flex">
            <span className="h-2 w-4/5 animate-pulse rounded bg-white/6" />
            <span className="h-2 w-3/5 animate-pulse rounded bg-white/6" />
          </span>
          <span className="mt-1.5 flex items-center justify-center gap-[0.1875rem] md:hidden">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/6" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/6" />
          </span>
        </>
      ) : day.items.length === 0 ? (
        // A blank page, not a missing one.
        <span
          aria-hidden
          className="mt-2 border-t border-dashed border-white/8"
        />
      ) : (
        <>
          <span
            className={`mt-1 hidden min-w-0 flex-col gap-px md:flex ${
              isPast ? "text-ink-500" : ""
            }`}
          >
            {shown.map((item) => (
              <span
                key={item.id}
                className="flex min-w-0 items-center gap-1 text-[0.6875rem] leading-tight"
                title={item.title}
              >
                <ItemMark item={item} isPast={isPast} />
                {item.time && (
                  <span className="flex-none tabular-nums text-ink-600">
                    {formatTimeShort(item.time)}
                  </span>
                )}
                <span
                  className={`min-w-0 flex-1 truncate ${
                    item.done
                      ? "strike-muted text-ink-600 line-through"
                      : isPast
                        ? "text-ink-500"
                        : "text-ink-300"
                  }`}
                >
                  {item.title}
                </span>
              </span>
            ))}
            {hidden > 0 && (
              <span className="text-[0.6875rem] leading-tight text-ink-600">
                +{hidden}
              </span>
            )}
          </span>
          {/* Phone: no room for titles, so the column becomes a density read. */}
          <span className="mt-1.5 flex items-center justify-center gap-[0.1875rem] md:hidden">
            {day.items.slice(0, 6).map((item) => (
              <ItemMark key={item.id} item={item} isPast={isPast} round />
            ))}
            {day.items.length > 6 && (
              <span className="text-[0.5625rem] leading-none text-ink-600">
                +
              </span>
            )}
          </span>
        </>
      )}
    </button>
  );
}

/**
 * The item's glyph: a filled dot for events, a tiny hollow square for open
 * tasks, a filled sage square once done — the same vocabulary the calendar
 * month cells use. On phone every mark is round: at 6px a square and a
 * circle are the same smudge, so shape carries nothing and fill carries
 * everything.
 */
function ItemMark({
  item,
  isPast,
  round = false,
}: {
  item: StripItem;
  isPast: boolean;
  round?: boolean;
}) {
  const shape =
    round || item.kind === "event" ? "rounded-full" : "rounded-[0.125rem]";
  const fill = item.done
    ? "bg-sage"
    : item.kind === "event"
      ? isPast
        ? "bg-event/60"
        : "bg-event"
      : "border border-ink-600";
  return (
    <span aria-hidden className={`h-1.5 w-1.5 flex-none ${shape} ${fill}`} />
  );
}
