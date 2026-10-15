/**
 * Pure rules behind the desktop/tablet Calendar page (Notes Sidebars design
 * §5c / §6c): which days a view shows, how it pages, what its header says,
 * and how timed items share a day column. No React, no Date.now — `today`
 * and every date are the user's LOCAL calendar day as YYYY-MM-DD (same
 * convention as lib/dates), times are minutes from local midnight.
 */

import { addDays, isoWeekNumber, parseLocalDate } from "./dates";

export type CalendarView = "day" | "week" | "month";

export const CALENDAR_VIEWS: readonly CalendarView[] = ["day", "week", "month"];

export function isCalendarView(v: unknown): v is CalendarView {
  return v === "day" || v === "week" || v === "month";
}

/** Sunday on or before `dateStr` — the desktop week runs Sun–Sat (design 5c). */
export function sundayOf(dateStr: string): string {
  return addDays(dateStr, -parseLocalDate(dateStr).getDay());
}

/** Monday of the Mon–Fri work week holding `dateStr` (a weekend day maps to
 *  the week it closes: Sat/Sun → the preceding Monday). */
export function workWeekMonday(dateStr: string): string {
  return addDays(dateStr, -((parseLocalDate(dateStr).getDay() + 6) % 7));
}

export function isWeekend(dateStr: string): boolean {
  const dow = parseLocalDate(dateStr).getDay();
  return dow === 0 || dow === 6;
}

/**
 * The day columns a time-grid view draws: one for Day, Sun–Sat for Week, or
 * Mon–Fri when `workWeek` (tablet widths, design 6c). Month has no columns —
 * see `monthCells`.
 */
export function visibleDays(
  anchor: string,
  view: CalendarView,
  workWeek: boolean,
): string[] {
  if (view === "day") return [anchor];
  if (view === "week") {
    const start = workWeek ? workWeekMonday(anchor) : sundayOf(anchor);
    return Array.from({ length: workWeek ? 5 : 7 }, (_, i) =>
      addDays(start, i),
    );
  }
  const { start, end } = monthBounds(anchor);
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** First and last day of the month holding `dateStr`. */
export function monthBounds(dateStr: string): { start: string; end: string } {
  const [y, m] = dateStr.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  const prefix = `${y}-${String(m).padStart(2, "0")}`;
  return {
    start: `${prefix}-01`,
    end: `${prefix}-${String(days).padStart(2, "0")}`,
  };
}

/**
 * A month as whole Sun–Sat weeks: the month's days with null padding before
 * the 1st and after the last day (the grid leaves those cells blank).
 */
export function monthCells(dateStr: string): (string | null)[] {
  const { start, end } = monthBounds(dateStr);
  const out: (string | null)[] = Array.from(
    { length: parseLocalDate(start).getDay() },
    () => null,
  );
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  while (out.length % 7 !== 0) out.push(null);
  return out;
}

/** The anchor one page forward/back: a day, a week, or a month (clamped to
 *  the target month's length, so Jan 31 → Feb 28). */
export function stepAnchor(
  anchor: string,
  view: CalendarView,
  delta: number,
): string {
  if (view === "day") return addDays(anchor, delta);
  if (view === "week") return addDays(anchor, delta * 7);
  const [y, m, d] = anchor.split("-").map(Number);
  const target = new Date(y, m - 1 + delta, 1);
  const days = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0,
  ).getDate();
  const day = Math.min(d, days);
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const MONTH_LONG: Intl.DateTimeFormatOptions = { month: "long" };

/**
 * Header title + subline for a view: "October 4 – 10" / "Week 41",
 * "September 28 – October 4", "Friday, October 9" / "Week 41",
 * "October 2026". A range crossing a year names both years.
 */
export function rangeTitle(
  days: string[],
  view: CalendarView,
  workWeek: boolean,
): { title: string; subline: string } {
  const first = days[0];
  const last = days[days.length - 1];
  const a = parseLocalDate(first);
  const b = parseLocalDate(last);
  // ISO weeks run Mon–Sun; a Sun–Sat week is numbered by its Monday.
  const week = `Week ${isoWeekNumber(view === "week" && !workWeek ? addDays(first, 1) : first)}`;
  if (view === "month") {
    return {
      title: a.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
      subline: "",
    };
  }
  if (view === "day") {
    return {
      title: a.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
      subline: `${week} · ${a.getFullYear()}`,
    };
  }
  const subline = workWeek ? "Work week" : week;
  if (a.getFullYear() !== b.getFullYear()) {
    const withYear: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
      year: "numeric",
    };
    return {
      title: `${a.toLocaleDateString("en-US", withYear)} – ${b.toLocaleDateString("en-US", withYear)}`,
      subline,
    };
  }
  const from = `${a.toLocaleDateString("en-US", MONTH_LONG)} ${a.getDate()}`;
  const to =
    a.getMonth() === b.getMonth()
      ? String(b.getDate())
      : `${b.toLocaleDateString("en-US", MONTH_LONG)} ${b.getDate()}`;
  return { title: `${from} – ${to}`, subline };
}

/** "09:30" for minutes from midnight (the tasks' remindAtLocal format). */
export function minToHHMM(min: number): string {
  const m = Math.max(0, Math.min(1439, Math.round(min)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Minutes from midnight for "HH:MM", or null when malformed. */
export function hhmmToMin(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** Gutter label: "8a", "12p", "9p". */
export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const suffix = h < 12 ? "a" : "p";
  return `${h % 12 === 0 ? 12 : h % 12}${suffix}`;
}

/** Snap a minute mark to `step` minutes inside [0, 1440 - step]. */
export function snapMinutes(min: number, step = 15): number {
  return Math.max(0, Math.min(1440 - step, Math.floor(min / step) * step));
}

export interface TimedItem {
  key: string;
  start: number;
  end: number;
}

export interface PlacedItem {
  key: string;
  /** Column index inside its overlap cluster, and the cluster's width. */
  col: number;
  cols: number;
}

/**
 * Side-by-side layout for one day column: items that overlap (transitively —
 * a cluster) split the column into equal lanes, each item taking the first
 * lane free at its start. Items that touch end-to-start don't overlap.
 * Zero-length items are treated as `minLen` long so they still claim space.
 */
export function layoutOverlaps(
  items: TimedItem[],
  minLen = 30,
): Map<string, PlacedItem> {
  const sorted = [...items]
    .map((it) => ({ ...it, end: Math.max(it.end, it.start + minLen) }))
    .sort(
      (x, y) =>
        x.start - y.start || y.end - x.end || x.key.localeCompare(y.key),
    );
  const out = new Map<string, PlacedItem>();
  let cluster: { key: string; col: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;

  const flush = () => {
    const cols = Math.max(1, laneEnds.length);
    for (const c of cluster) out.set(c.key, { key: c.key, col: c.col, cols });
    cluster = [];
    laneEnds = [];
  };

  for (const it of sorted) {
    if (cluster.length > 0 && it.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= it.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(it.end);
    } else {
      laneEnds[lane] = it.end;
    }
    cluster.push({ key: it.key, col: lane });
    clusterEnd = cluster.length === 1 ? it.end : Math.max(clusterEnd, it.end);
  }
  if (cluster.length > 0) flush();
  return out;
}

export interface StripBar {
  key: string;
  /** First and last column index (inclusive) the bar covers in this view. */
  startCol: number;
  endCol: number;
  /** The bar's real first/last day falls inside the view (round that end). */
  isStart: boolean;
  isEnd: boolean;
  lane: number;
}

/**
 * All-day strip bars for a run of day columns: each item [start, end]
 * (inclusive local days) is clipped to the visible days and stacked into the
 * first lane free across its whole run. Items entirely outside are dropped.
 */
export function layoutStripBars(
  items: { key: string; start: string; end: string }[],
  days: string[],
): StripBar[] {
  if (days.length === 0) return [];
  const first = days[0];
  const last = days[days.length - 1];
  const lanes: number[] = []; // last occupied column per lane
  const bars: StripBar[] = [];
  const visible = items
    .filter((it) => it.end >= first && it.start <= last)
    .sort(
      (a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end),
    );
  for (const it of visible) {
    const startCol = it.start < first ? 0 : days.indexOf(it.start);
    const endCol = it.end > last ? days.length - 1 : days.indexOf(it.end);
    // A day missing from the columns (a weekend in the work week) — clamp to
    // the nearest visible column on that side.
    const s = startCol === -1 ? days.findIndex((d) => d > it.start) : startCol;
    const e =
      endCol === -1
        ? days.length - 1 - [...days].reverse().findIndex((d) => d < it.end)
        : endCol;
    if (s === -1 || e < s || e >= days.length) continue;
    let lane = lanes.findIndex((lastCol) => lastCol < s);
    if (lane === -1) {
      lane = lanes.length;
      lanes.push(e);
    } else {
      lanes[lane] = e;
    }
    bars.push({
      key: it.key,
      startCol: s,
      endCol: e,
      isStart: it.start >= first && days.includes(it.start),
      isEnd: it.end <= last && days.includes(it.end),
      lane,
    });
  }
  return bars;
}
