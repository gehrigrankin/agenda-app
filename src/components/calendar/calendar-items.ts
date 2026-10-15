/**
 * Event helpers shared by the phone calendar (CalendarPageClient) and the
 * desktop/tablet calendar (CalendarDesktop): the two feeds — quick-add
 * events (server/events.ts) and the read-only ICS layer (server/calendar.ts)
 * — normalized for drawing.
 */

import type React from "react";

import type { RangeCalendarEvent } from "@/server/calendar";
import type { UserEvent } from "@/server/events";
import { dedupeSpans, toSpan, type EventSpan } from "@/lib/event-spans";
import { formatTimeShort } from "@/lib/recurrence";

/** "HH:MM" for minutes-from-midnight, feeding the shared time formatter. */
export function minutesToHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(
    min % 60,
  ).padStart(2, "0")}`;
}

/** "45 min" / "1h" / "1h 30m" between two minute marks. */
export function durationLabel(startMin: number, endMin: number): string {
  const d = endMin - startMin;
  const h = Math.floor(d / 60);
  const m = d % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * The multi-day events in a range, one span each. Both feeds flatten spans —
 * quick-add rows carry an inclusive `endLocalDate`, ICS rows repeat per
 * covered day with a shared `spanStart`/`spanEnd` — so the grid collapses them
 * back into runs and draws one bar per event instead of a chip per day.
 */
export function collectSpans(
  userEvents: UserEvent[],
  icsEvents: RangeCalendarEvent[],
): EventSpan[] {
  return dedupeSpans(
    [
      ...userEvents.map((e) =>
        toSpan(userSpanKey(e), e.title, e.localDate, e.endLocalDate),
      ),
      ...icsEvents.map((e) =>
        toSpan(icsSpanKey(e), e.title, e.spanStart, e.spanEnd),
      ),
    ].filter((s): s is EventSpan => s !== null),
  );
}

/** Span identity for the two feeds — also what the chip renderers skip on. */
export function userSpanKey(e: UserEvent): string {
  return `u:${e.id}`;
}
export function icsSpanKey(e: RangeCalendarEvent): string {
  return `i:${e.uid}:${e.spanStart}`;
}

/** True when this row is one day of a multi-day run (a bar renders it). */
export function isSpanned(e: UserEvent | RangeCalendarEvent): boolean {
  return "id" in e
    ? e.endLocalDate !== null && e.endLocalDate > e.localDate
    : e.spanEnd > e.spanStart;
}

/** Local minutes-from-midnight of an ISO instant (timed ICS events). */
export function isoToLocalMin(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

// --- Desktop/tablet calendar (CalendarDesktop) -------------------------------

/** HTML5 drag payload for a task chip — same type the day-plan TimeRail uses. */
export const TASK_DRAG_TYPE = "text/task-id";

/** What the right-hand EVENT sidebar shows. Snapshots keep the panel filled
 *  when paging moves the item out of the loaded range. */
export type CalendarSelection =
  | { kind: "event"; id: string; snapshot: UserEvent }
  | { kind: "ics"; key: string; event: RangeCalendarEvent }
  | {
      kind: "task";
      id: string;
      snapshot: {
        id: string;
        title: string;
        due: string;
        completed: boolean;
        remindAt: string | null;
      };
    };

/** Untagged own events read sage (the "Events" layer); the feed reads steel. */
export const OWN_EVENT_COLOR = "var(--sage)";
export const ICS_COLOR = "var(--steel)";

/** Left border + tinted fill in an item's color (subject hex or a token). */
export function tintStyle(
  color: string,
  strength: "rest" | "selected" = "rest",
): React.CSSProperties {
  return {
    borderColor: color,
    backgroundColor: `color-mix(in srgb, ${color} ${strength === "selected" ? 30 : 15}%, transparent)`,
  };
}

/** Stable key for a timed ICS occurrence (uid alone repeats for recurrences). */
export function icsTimedKey(e: RangeCalendarEvent): string {
  return `i:${e.uid}:${e.startIso ?? e.date}`;
}

/** "9 AM – 10:15 AM" / "9 AM" for a minute window. */
export function timeRangeLabel(start: number, end: number | null): string {
  const a = formatTimeShort(minutesToHHMM(start));
  return end !== null && end > start
    ? `${a} – ${formatTimeShort(minutesToHHMM(Math.min(end, 1440)))}`
    : a;
}

/** Wall-clock window of a timed ICS occurrence on its own day; an end past
 *  midnight (or missing) is clipped/defaulted so the block stays in the day. */
export function icsWindow(e: RangeCalendarEvent): {
  start: number;
  end: number;
} {
  const start = isoToLocalMin(e.startIso!);
  if (!e.endIso) return { start, end: start + 30 };
  const endDate = new Date(e.endIso);
  const startDate = new Date(e.startIso!);
  const sameDay = endDate.toDateString() === startDate.toDateString();
  const end = sameDay ? isoToLocalMin(e.endIso) : 1440;
  return { start, end: Math.max(end, start + 15) };
}
