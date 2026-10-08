import { addDays, isoWeekNumber, parseLocalDate } from "./dates";

/**
 * Pure rules behind the Today agenda page (design: "Today Agenda", Turns 6–7):
 * the time field's parser and formatters, where a day sits relative to today,
 * which event is "now", what each task's due pill says, and the one-line
 * summaries a folded section shows. Kept free of React and server types so
 * every rule is unit-tested (agenda-today.test.ts).
 */

export type DayRel = "past" | "today" | "future";

export function dayRel(dateStr: string, today: string): DayRel {
  if (dateStr < today) return "past";
  if (dateStr > today) return "future";
  return "today";
}

export const DOW_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const DOW_LETTER = ["M", "T", "W", "T", "F", "S", "S"];

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(dateStr: string): number {
  return (parseLocalDate(dateStr).getDay() + 6) % 7;
}

export function dayOfMonth(dateStr: string): number {
  return Number(dateStr.slice(8, 10));
}

/** "Wednesday" */
export function weekdayLong(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString("en-US", {
    weekday: "long",
  });
}

/** Day of the year, 1-based. */
export function dayOfYear(dateStr: string): number {
  const d = parseLocalDate(dateStr);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  // Round: a DST change inside the span makes it a non-whole number of days.
  return Math.round((d.getTime() - jan1.getTime()) / 86_400_000) + 1;
}

/** The line under the weekday: "July · Week 28 · day 190" (shown uppercase). */
export function dayMetaLine(dateStr: string): string {
  const month = parseLocalDate(dateStr).toLocaleDateString("en-US", {
    month: "long",
  });
  return `${month} · Week ${isoWeekNumber(dateStr)} · day ${dayOfYear(dateStr)}`;
}

/** "Today" / "Yesterday" / "Tomorrow", else null. */
export function relativeDayTag(dateStr: string, today: string): string | null {
  if (dateStr === today) return "Today";
  if (dateStr === addDays(today, -1)) return "Yesterday";
  if (dateStr === addDays(today, 1)) return "Tomorrow";
  return null;
}

/** "Today", "Tomorrow", else "Tue, Jul 8" — the item panel's meta line. */
export function panelDateText(dateStr: string, today: string): string {
  if (dateStr === today) return "Today";
  if (dateStr === addDays(today, 1)) return "Tomorrow";
  return parseLocalDate(dateStr).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

const TIME_RE = /^(\d{1,2})(?::(\d{2}))?\s*(a|p|am|pm)?$/;

/**
 * Parse the agenda's free-text time field. Returns minutes from midnight,
 * null for an empty field (all day), or "invalid".
 *
 * "2:30", "9a", "4pm", "13:00". Without am/pm a planner-style guess applies:
 * hours 1–7 are afternoon ("2:30" is 2:30 PM, "7" is 7 PM), 8–12 read as
 * written, 0 and 13–23 are 24-hour.
 */
export function parseTimeInput(raw: string): number | null | "invalid" {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const m = TIME_RE.exec(s);
  if (!m) return "invalid";
  let h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (h > 23 || min > 59) return "invalid";
  const suffix = m[3];
  if (suffix) {
    if (h === 0 || h > 12) return "invalid";
    h = (h % 12) + (suffix.startsWith("p") ? 12 : 0);
  } else if (h >= 1 && h < 8) {
    h += 12;
  }
  return h * 60 + min;
}

/** "2:00", "9:30" — the clock face, no am/pm (lists and cards). */
export function formatClock(min: number | null): string {
  if (min === null) return "—";
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}`;
}

/**
 * The item panel's editable time: the clock face plus a suffix wherever the
 * bare number would parse back to a different time ("7:30am", "8:00pm").
 * Empty for all-day.
 */
export function formatClockInput(min: number | null): string {
  if (min === null) return "";
  const face = formatClock(min);
  const withoutSuffix = parseTimeInput(face);
  if (withoutSuffix === min) return face;
  return `${face}${min >= 720 ? "pm" : "am"}`;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** What the agenda needs to place an event in the day. */
export type TimedItem = {
  startMin: number | null;
  endMin: number | null;
};

/** An event with no end is treated as half an hour long. */
export const DEFAULT_EVENT_MINUTES = 30;

export function eventEnd(e: TimedItem): number | null {
  if (e.startMin === null) return null;
  return e.endMin ?? e.startMin + DEFAULT_EVENT_MINUTES;
}

/** Timed events by start, all-day ones last (they read "—"). */
export function sortEvents<T extends TimedItem & { title: string }>(
  events: T[],
): T[] {
  return [...events].sort((a, b) => {
    const sa = a.startMin ?? Number.POSITIVE_INFINITY;
    const sb = b.startMin ?? Number.POSITIVE_INFINITY;
    if (sa !== sb) return sa - sb;
    return a.title.localeCompare(b.title);
  });
}

export type EventPhase = "past" | "now" | "next" | "later";

/**
 * Each event's phase on its day. Only today has a "now": the event running at
 * `nowMin` (if any), and otherwise the first one still ahead is "next" — the
 * one the page highlights. Earlier days are all past, later days all later.
 */
export function eventPhases<T extends TimedItem>(
  sorted: T[],
  rel: DayRel,
  nowMin: number,
): EventPhase[] {
  if (rel === "past") return sorted.map(() => "past");
  if (rel === "future") return sorted.map(() => "later");
  let highlighted = false;
  return sorted.map((e) => {
    const end = eventEnd(e);
    if (e.startMin === null || end === null) return "later";
    if (end <= nowMin) return "past";
    if (highlighted) return "later";
    highlighted = true;
    return e.startMin <= nowMin ? "now" : "next";
  });
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type DuePill = {
  text: string;
  tone: "late" | "today" | "due";
};

/**
 * The pill at the right of a task row on the page for `pageDate`.
 * - On today, a task due before today is LATE.
 * - On the past day it was due, an unfinished (or finished-late) task reads
 *   "→ TODAY" when that day is yesterday, else "→ WED" (today's weekday): it
 *   was carried forward.
 * - Due on the page's own day: "Today" on today, "Due" elsewhere.
 */
export function duePill(
  dueDate: string,
  pageDate: string,
  today: string,
  carried: boolean,
): DuePill {
  if (pageDate === today && dueDate < today) return { text: "LATE", tone: "late" };
  if (carried) {
    const text =
      pageDate === addDays(today, -1)
        ? "→ TODAY"
        : `→ ${DOW_SHORT[weekdayIndex(today)].toUpperCase()}`;
    return { text, tone: "late" };
  }
  if (pageDate === today) return { text: "Today", tone: "today" };
  return { text: "Due", tone: "due" };
}

/**
 * Heavy-day fold: past `limit + 1` tasks only the first `limit` show, behind
 * a "N more due" row. Exactly `limit + 1` shows them all — folding away a
 * single row would save nothing.
 */
export function foldTasks<T>(
  tasks: T[],
  limit: number,
  expanded: boolean,
): { visible: T[]; hidden: number; foldable: boolean } {
  const foldable = tasks.length > limit + 1;
  if (!foldable || expanded) return { visible: tasks, hidden: 0, foldable };
  return {
    visible: tasks.slice(0, limit),
    hidden: tasks.length - limit,
    foldable,
  };
}

// ---------------------------------------------------------------------------
// Summaries (folded section headers, the writing-mode context bar)
// ---------------------------------------------------------------------------

export type ChipTone = "neutral" | "muted" | "now" | "late" | "text";

export type SummaryChip = { text: string; tone: ChipTone };

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

type SummaryEvent = TimedItem & { title: string };

/** The event a summary points at: the one on now, else the next one. */
function highlightedEvent<T extends SummaryEvent>(
  sorted: T[],
  phases: EventPhase[],
): { event: T; now: boolean } | null {
  const i = phases.findIndex((p) => p === "now" || p === "next");
  if (i >= 0) return { event: sorted[i], now: phases[i] === "now" };
  const later = phases.findIndex((p) => p === "later");
  return later >= 0 ? { event: sorted[later], now: false } : null;
}

function eventChip(hit: { event: SummaryEvent; now: boolean }): SummaryChip {
  const { event, now } = hit;
  if (now) return { text: `Now · ${event.title}`, tone: "now" };
  if (event.startMin === null) return { text: event.title, tone: "now" };
  return { text: `${formatClock(event.startMin)} ${event.title}`, tone: "now" };
}

export function scheduleSummary<T extends SummaryEvent>(
  sorted: T[],
  phases: EventPhase[],
): SummaryChip[] {
  if (sorted.length === 0) return [{ text: "Nothing scheduled", tone: "muted" }];
  const chips: SummaryChip[] = [
    { text: plural(sorted.length, "event"), tone: "neutral" },
  ];
  const hit = highlightedEvent(sorted, phases);
  if (hit) chips.push(eventChip(hit));
  return chips;
}

export type SummaryTask = { title: string; done: boolean; late: boolean };

export function tasksSummary(tasks: SummaryTask[], rel: DayRel): SummaryChip[] {
  if (tasks.length === 0) {
    return [
      { text: rel === "past" ? "Nothing was due" : "Nothing due", tone: "muted" },
    ];
  }
  const done = tasks.filter((t) => t.done).length;
  const chips: SummaryChip[] = [
    { text: `${done}/${tasks.length} done`, tone: "neutral" },
  ];
  const lateOpen = tasks.filter((t) => t.late && !t.done).length;
  if (lateOpen > 0) {
    chips.push({
      text: `${lateOpen} ${rel === "past" ? "carried" : "late"}`,
      tone: "late",
    });
  }
  const next = tasks.find((t) => !t.done && !t.late);
  if (next) chips.push({ text: next.title, tone: "text" });
  return chips;
}

export function notesSummary(text: string): SummaryChip[] {
  const words = wordCount(text);
  if (words === 0) return [{ text: "Empty", tone: "muted" }];
  return [
    { text: plural(words, "word"), tone: "neutral" },
    { text: text.trim(), tone: "text" },
  ];
}

/** Writing mode's context bar: what's on, what's late, what's due. */
export function focusSummary<T extends SummaryEvent>(
  sorted: T[],
  phases: EventPhase[],
  tasks: SummaryTask[],
  rel: DayRel,
): SummaryChip[] {
  const chips: SummaryChip[] = [];
  const hit = highlightedEvent(sorted, phases);
  if (hit && rel !== "past") chips.push(eventChip(hit));
  const lateOpen = tasks.filter((t) => t.late && !t.done).length;
  if (lateOpen > 0) {
    chips.push({
      text: `${lateOpen} ${rel === "past" ? "carried" : "late"}`,
      tone: "late",
    });
  }
  const due = tasks.filter((t) => !t.late && !t.done).length;
  if (due > 0) chips.push({ text: `${due} due`, tone: "neutral" });
  if (chips.length === 0) return [{ text: "Nothing on", tone: "muted" }];
  return chips;
}
