"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  DOW_SHORT,
  dayOfMonth,
  formatClock,
  relativeDayTag,
  weekdayLong,
} from "@/lib/agenda-today";
import { addDays, formatWeekRange, isoWeekNumber } from "@/lib/dates";

import { CheckGlyph, NotesMark, PageArrow } from "./atoms";
import { DayTab, dayDot } from "./DayTabs";
import type { DayView } from "./useTodayAgenda";

/**
 * The week on tablet/desktop: Today's sidebar 1 (a PageLayout sidebar), or
 * folded to a strip of date tabs. (The phone's week screen is the spread —
 * WeekSpread.tsx — which borrows `WeekTitle` from here.)
 */

export type WeekDay = {
  date: string;
  view: DayView | null;
  /** First line(s) of the day's note, plain text; "" when none. */
  noteText: string;
};

export function WeekTitle({
  weekStart,
  onPrev,
  onNext,
  wide,
}: {
  weekStart: string;
  onPrev: () => void;
  onNext: () => void;
  wide: boolean;
}) {
  return (
    <div
      className={`flex flex-none items-center ${
        wide ? "h-[4.25rem] gap-0.5 px-1.5" : "gap-1 px-2 pb-2"
      }`}
    >
      <PageArrow
        dir="prev"
        onClick={onPrev}
        label="Previous week"
        large={!wide}
      />
      <div
        className={`flex flex-1 justify-center ${
          wide ? "flex-col items-center gap-1.5" : "items-baseline gap-2"
        }`}
      >
        <span
          className={`font-semibold leading-none text-ink-100 ${
            wide ? "text-[0.9375rem]" : "text-[1.0625rem]"
          }`}
        >
          Week {isoWeekNumber(weekStart)}
        </span>
        <span
          className={`font-mono font-medium uppercase leading-none tracking-[0.075rem] text-ink-500 ${
            wide ? "text-[0.625rem]" : "text-[0.65625rem]"
          }`}
        >
          {formatWeekRange(weekStart)}
        </span>
      </div>
      <PageArrow dir="next" onClick={onNext} label="Next week" large={!wide} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tablet/desktop week panel
// ---------------------------------------------------------------------------

type LineKind = "event" | "done" | "late" | "moved" | "due";

type Line = {
  key: string;
  kind: LineKind;
  /** Events: the clock time, null for all-day. */
  time: string | null;
  text: string;
  /** Identical lines (a repeated habit, a duplicated task) fold into one. */
  count: number;
  /** The event on now / next. */
  hot: boolean;
  struck: boolean;
  /** The day is behind us: everything reads quieter. */
  past: boolean;
};

/** What a day card or peek lists: events, then tasks, duplicates folded. */
function panelLines(view: DayView | null): Line[] {
  if (!view) return [];
  const past = view.rel === "past";
  const lines: Line[] = [];
  view.events.forEach((e, i) => {
    const phase = view.phases[i];
    lines.push({
      key: e.key,
      kind: "event",
      time: e.startMin === null ? null : formatClock(e.startMin),
      text: e.title,
      count: 1,
      hot: phase === "now" || phase === "next",
      struck: phase === "past" && view.rel === "today",
      past,
    });
  });
  for (const t of view.tasks) {
    const kind: LineKind = t.done
      ? "done"
      : t.late
        ? "late"
        : t.carried
          ? "moved"
          : "due";
    const same = lines.find(
      (l) => l.kind === kind && l.text === t.title,
    );
    if (same) {
      same.count += 1;
      continue;
    }
    lines.push({
      key: t.id,
      kind,
      time: null,
      text: t.title,
      count: 1,
      hot: false,
      struck: t.done,
      past,
    });
  }
  return lines;
}

/** The marker column: an event's time, or a task's state as a small glyph. */
function LineMark({ line }: { line: Line }) {
  if (line.kind === "event") {
    if (line.time === null) {
      return (
        <span
          aria-label="All day"
          className="h-[0.3125rem] w-[0.3125rem] rounded-full bg-ink-500"
        />
      );
    }
    return (
      <span
        className={`font-mono text-[0.625rem] leading-none font-medium ${
          line.hot ? "text-steel" : line.past ? "text-ink-600" : "text-ink-400"
        }`}
      >
        {line.time}
      </span>
    );
  }
  if (line.kind === "done") {
    return (
      <span
        aria-label="Done"
        className="flex h-[0.6875rem] w-[0.6875rem] items-center justify-center rounded-[0.1875rem] bg-sage/45"
      >
        <CheckGlyph size="sm" />
      </span>
    );
  }
  if (line.kind === "moved") {
    return (
      <span aria-label="Moved" className="text-[0.6875rem] leading-none text-overdue">
        →
      </span>
    );
  }
  return (
    <span
      aria-label={line.kind === "late" ? "Late" : "Due"}
      className={`h-[0.6875rem] w-[0.6875rem] rounded-[0.1875rem] border-[1.5px] ${
        line.kind === "late" ? "border-overdue" : "border-ink-500"
      }`}
    />
  );
}

function LineRow({ line }: { line: Line }) {
  const tone = line.struck
    ? "text-ink-600 line-through decoration-ink-700"
    : line.kind === "late" || line.kind === "moved"
      ? "text-ink-200"
      : line.past
        ? "text-ink-500"
        : line.hot
          ? "text-ink-100"
          : "text-ink-300";
  return (
    <span className="flex min-w-0 flex-none items-center gap-2">
      <span className="flex w-[1.875rem] flex-none items-center justify-center">
        <LineMark line={line} />
      </span>
      <span className={`min-w-0 truncate text-[0.78125rem] leading-[1.3] ${tone}`}>
        {line.text}
      </span>
      {line.count > 1 && (
        <span className="flex-none font-mono text-[0.625rem] leading-none text-ink-600">
          ×{line.count}
        </span>
      )}
    </span>
  );
}

/** A card shows this many lines before "+N more". */
const CARD_LINES = 4;

/**
 * Sidebar 1's header on Today (Notes Sidebars design §5a): ‹ This week ›
 * with the date range under it. PageLayout appends the collapse toggle.
 */
export function WeekPanelHeader({
  weekStart,
  today,
  onPrev,
  onNext,
}: {
  weekStart: string;
  today: string;
  onPrev: () => void;
  onNext: () => void;
}) {
  const thisWeek = today >= weekStart && today < addDays(weekStart, 7);
  return (
    <div className="flex min-w-0 flex-1 items-center">
      <PageArrow dir="prev" onClick={onPrev} label="Previous week" />
      <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
        <span className="truncate text-[0.9375rem] leading-none font-semibold text-ink-100">
          {thisWeek ? "This week" : `Week ${isoWeekNumber(weekStart)}`}
        </span>
        <span className="whitespace-nowrap text-[0.71875rem] leading-none text-ink-500">
          {formatWeekRange(weekStart)}
        </span>
      </div>
      <PageArrow dir="next" onClick={onNext} label="Next week" />
    </div>
  );
}

/**
 * The week's seven day cards, sharing the panel's full height evenly (§5a):
 * each card shows that day's events, what's due (state as a glyph, repeats
 * folded into "×N") and the first line of its note — up to CARD_LINES lines,
 * then "+N more". On a short window the cards keep a floor height and the
 * column scrolls instead.
 */
export function WeekPanelDays({
  days,
  today,
  selected,
  onSelect,
}: {
  days: WeekDay[];
  today: string;
  selected: string;
  onSelect: (date: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2.5 pt-2.5 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {days.map((d, i) => {
        const isSel = d.date === selected;
        const isToday = d.date === today;
        const past = d.date < today;
        const all = panelLines(d.view);
        const shown = all.slice(0, CARD_LINES);
        const more = all.length - shown.length;
        const note = d.noteText.trim();
        const card = isSel
          ? isToday
            ? "border-[1.5px] border-sage bg-sage/7"
            : "border-[1.5px] border-ink-100/55 bg-white/5"
          : isToday
            ? "border border-sage/45"
            : "border border-white/6 hover:bg-white/2";
        return (
          <button
            key={d.date}
            type="button"
            onClick={() => onSelect(d.date)}
            aria-pressed={isSel}
            aria-label={`${DOW_SHORT[i]} ${dayOfMonth(d.date)}${
              all.length ? `, ${all.length} items` : ""
            }`}
            className={`grid min-h-[5.25rem] flex-1 grid-cols-[2.5rem_minmax(0,1fr)] gap-2.5 overflow-hidden rounded-xl py-2.5 pr-2.5 pl-1.5 text-left focus-visible:outline-2 focus-visible:outline-sage/70 ${card}`}
          >
            <span className="flex flex-col items-center gap-[0.3125rem]">
              <span
                className={`font-mono text-[0.59375rem] leading-none font-semibold ${
                  isToday ? "text-sage" : past ? "text-ink-700" : "text-ink-500"
                }`}
              >
                {DOW_SHORT[i]}
              </span>
              <span
                className={`flex h-[1.875rem] min-w-[1.875rem] items-center justify-center rounded-lg px-1 text-base leading-none font-semibold ${
                  isToday
                    ? "bg-sage text-sage-ink"
                    : isSel
                      ? "bg-ink-100 text-sage-ink"
                      : past
                        ? "text-ink-600"
                        : "text-ink-200"
                }`}
              >
                {dayOfMonth(d.date)}
              </span>
            </span>
            <span className="flex min-h-0 min-w-0 flex-col gap-1.5 overflow-hidden pt-px">
              {shown.map((l) => (
                <LineRow key={l.key} line={l} />
              ))}
              {more > 0 && (
                <span className="pl-[2.375rem] text-[0.6875rem] leading-none text-ink-500">
                  +{more} more
                </span>
              )}
              {all.length === 0 && (
                <span className="text-[0.78125rem] leading-[1.25] text-ink-700">
                  {past ? "Nothing logged" : "Nothing planned"}
                </span>
              )}
              {note && (
                <span className="flex min-w-0 flex-none items-center gap-2 pt-0.5">
                  <span className="flex w-[1.875rem] flex-none justify-center">
                    <NotesMark />
                  </span>
                  <span className="min-w-0 truncate text-[0.75rem] leading-[1.25] text-ink-400">
                    {note}
                  </span>
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The week panel folded down to a strip of date tabs (PageLayout puts the
 *  reopen toggle above it). Hovering a day that isn't open lifts its tab and
 *  pops out a peek at it — the same lines its card shows unfolded. */
export function WeekStripFolded({
  days,
  today,
  selected,
  onSelect,
}: {
  days: WeekDay[];
  today: string;
  selected: string;
  onSelect: (date: string) => void;
}) {
  const [peek, setPeek] = useState<{ date: string; rect: DOMRect } | null>(
    null,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);

  // A short delay on the first peek so sweeping past the strip stays quiet;
  // once one is up, moving to the next tab swaps it at once.
  const enter = (date: string, el: HTMLElement) => {
    clear();
    if (date === selected) {
      setPeek(null);
      return;
    }
    const show = () => setPeek({ date, rect: el.getBoundingClientRect() });
    if (peek) show();
    else timer.current = setTimeout(show, 180);
  };
  const leave = () => {
    clear();
    timer.current = setTimeout(() => setPeek(null), 80);
  };

  const peeked = peek ? days.find((d) => d.date === peek.date) : undefined;

  return (
    <div className="flex min-h-0 w-[4.125rem] flex-1 flex-col items-center gap-1 overflow-y-auto pt-2 pb-3.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {days.map((d, i) => (
        <div
          key={d.date}
          className="flex flex-none"
          onMouseEnter={(e) => enter(d.date, e.currentTarget)}
          onMouseLeave={leave}
        >
          <DayTab
            date={d.date}
            today={today}
            index={i}
            selected={d.date === selected}
            dot={dayDot(d.view)}
            onSelect={() => {
              clear();
              setPeek(null);
              onSelect(d.date);
            }}
            narrow
          />
        </div>
      ))}
      {peek && peeked && (
        <DayPeek day={peeked} today={today} anchor={peek.rect} />
      )}
    </div>
  );
}

/** The folded strip's hover card, portaled out of the sidebar's clip. */
function DayPeek({
  day,
  today,
  anchor,
}: {
  day: WeekDay;
  today: string;
  anchor: DOMRect;
}) {
  const lines = panelLines(day.view);
  const shown = lines.slice(0, 6);
  const past = day.date < today;
  const tag = relativeDayTag(day.date, today);
  const note = day.noteText.trim();
  // Centred on the tab by the card's measured height (it varies with the
  // day), kept inside the viewport.
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    setHeight(cardRef.current?.offsetHeight ?? 0);
  }, [day]);
  const top = Math.max(
    8,
    Math.min(
      anchor.top + anchor.height / 2 - height / 2,
      window.innerHeight - height - 8,
    ),
  );

  return createPortal(
    <div
      ref={cardRef}
      role="tooltip"
      style={{ top, left: anchor.right + 10 }}
      className="animate-pop-in pointer-events-none fixed z-50 flex w-[16.5rem] flex-col gap-2 rounded-xl border border-white/10 bg-panel px-3.5 py-3 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.6)]"
    >
      <div className="flex items-baseline gap-2">
        <span className="text-[0.9375rem] leading-none font-semibold text-ink-100">
          {weekdayLong(day.date)} {dayOfMonth(day.date)}
        </span>
        {tag && (
          <span className="font-mono text-[0.59375rem] leading-none font-semibold tracking-[0.06rem] text-sage uppercase">
            {tag}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        {shown.map((l) => (
          <LineRow key={l.key} line={l} />
        ))}
        {lines.length > shown.length && (
          <span className="pl-[2.375rem] text-[0.71875rem] leading-none text-ink-500">
            +{lines.length - shown.length} more
          </span>
        )}
        {lines.length === 0 && (
          <span className="text-[0.78125rem] leading-[1.25] text-ink-600">
            {past ? "Nothing logged" : "Nothing planned"}
          </span>
        )}
      </div>
      {note && (
        <div className="flex min-w-0 gap-[0.4375rem] border-t border-white/6 pt-2">
          <span className="flex w-[1.875rem] flex-none justify-center pt-0.5">
            <NotesMark />
          </span>
          <span className="line-clamp-3 min-w-0 text-[0.75rem] leading-[1.35] text-ink-400">
            {note}
          </span>
        </div>
      )}
    </div>,
    document.body,
  );
}
