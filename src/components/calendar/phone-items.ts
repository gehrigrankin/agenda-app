/**
 * Pure rules behind the PHONE Calendar (design 6j): turning the three feeds
 * (own events, the read-only ICS layer, due tasks) into one day's agenda —
 * an all-day / untimed block on top, timed rows below in clock order — plus
 * the NOW-divider math and the compact clock labels. No React, no Date.now:
 * `day` is a local YYYY-MM-DD and times are minutes from local midnight.
 */

import type { CalendarRangeTask } from "@/app/app/calendar/actions";
import { addDays } from "@/lib/dates";
import type { RangeCalendarEvent } from "@/server/calendar";
import type { UserEvent } from "@/server/events";

import {
  icsWindow,
  icsTimedKey,
  icsSpanKey,
  isSpanned,
} from "./calendar-items";

export type PhoneItemSource =
  | { kind: "event"; event: UserEvent }
  | { kind: "ics"; event: RangeCalendarEvent; key: string }
  | { kind: "task"; task: CalendarRangeTask };

export interface PhoneItem {
  key: string;
  title: string;
  /** Null = all-day (events) / untimed (tasks). */
  startMin: number | null;
  endMin: number | null;
  tagId: string | null;
  notes: string | null;
  completed: boolean;
  /** True for a multi-day event's days (it has no clock time here). */
  multiDay: boolean;
  source: PhoneItemSource;
}

export interface DayItems {
  /** All-day events first, then untimed due tasks. */
  top: PhoneItem[];
  /** Everything with a clock time, earliest first. */
  timed: PhoneItem[];
  /** Own + subscribed events on the day (the "N EVENTS" count). */
  eventCount: number;
  taskCount: number;
}

/** "9:00a" / "12:30p" — compact, mono-friendly, still unambiguous. */
export function clockLabel(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m % 60).padStart(2, "0")}${h < 12 ? "a" : "p"}`;
}

/** "HH:MM" task time → minutes, or null. */
function hhmmMin(v: string | null): number | null {
  if (!v) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function eventCoversDay(e: UserEvent, day: string): boolean {
  return e.localDate <= day && day <= (e.endLocalDate ?? e.localDate);
}

export function buildDayItems(
  day: string,
  events: readonly UserEvent[],
  ics: readonly RangeCalendarEvent[],
  tasks: readonly CalendarRangeTask[],
): DayItems {
  const top: PhoneItem[] = [];
  const timed: PhoneItem[] = [];
  let eventCount = 0;

  for (const e of events) {
    if (!eventCoversDay(e, day)) continue;
    eventCount++;
    const multiDay = isSpanned(e);
    const item: PhoneItem = {
      key: `u:${e.id}`,
      title: e.title,
      startMin: multiDay ? null : e.startMin,
      endMin: multiDay ? null : e.endMin,
      tagId: e.tagId,
      notes: e.notes,
      completed: false,
      multiDay,
      source: { kind: "event", event: e },
    };
    (item.startMin === null ? top : timed).push(item);
  }

  for (const e of ics) {
    if (e.date !== day) continue;
    eventCount++;
    const multiDay = isSpanned(e);
    const win = !e.allDay && !multiDay ? icsWindow(e) : null;
    const item: PhoneItem = {
      key: e.allDay || multiDay ? icsSpanKey(e) + `:${day}` : icsTimedKey(e),
      title: e.title,
      startMin: win ? win.start : null,
      endMin: win ? win.end : null,
      tagId: null,
      notes: null,
      completed: false,
      multiDay,
      source: {
        kind: "ics",
        event: e,
        key: e.allDay || multiDay ? icsSpanKey(e) : icsTimedKey(e),
      },
    };
    (item.startMin === null ? top : timed).push(item);
  }

  let taskCount = 0;
  const topTasks: PhoneItem[] = [];
  for (const t of tasks) {
    if (t.due !== day) continue;
    taskCount++;
    const startMin = hhmmMin(t.remindAt);
    const item: PhoneItem = {
      key: `t:${t.id}`,
      title: t.title,
      startMin,
      endMin: null,
      tagId: null,
      notes: null,
      completed: t.completed,
      multiDay: false,
      source: { kind: "task", task: t },
    };
    (startMin === null ? topTasks : timed).push(item);
  }

  // Events before tasks within the top block; ICS keeps its feed order.
  top.push(...topTasks);
  const rank = (i: PhoneItem) => (i.source.kind === "task" ? 1 : 0);
  timed.sort(
    (a, b) =>
      a.startMin! - b.startMin! ||
      (a.endMin ?? a.startMin!) - (b.endMin ?? b.startMin!) ||
      rank(a) - rank(b),
  );
  return { top, timed, eventCount, taskCount };
}

/** Index in `timed` the NOW divider sits BEFORE (length = after the last). */
export function nowDividerIndex(
  timed: readonly PhoneItem[],
  nowMin: number,
): number {
  const i = timed.findIndex((t) => t.startMin! > nowMin);
  return i === -1 ? timed.length : i;
}

/** An event in progress at `nowMin` (tasks have no duration, never "now"). */
export function isHappeningNow(item: PhoneItem, nowMin: number): boolean {
  if (item.source.kind === "task" || item.startMin === null) return false;
  return item.startMin <= nowMin && nowMin < (item.endMin ?? item.startMin);
}

/**
 * Days in the loaded window that have anything on them — drives the week
 * strip's and the month sheet's dots. A multi-day event marks every covered
 * day (capped, so a corrupt year-long row can't spin).
 */
export function markedDays(
  events: readonly UserEvent[],
  ics: readonly RangeCalendarEvent[],
  tasks: readonly CalendarRangeTask[],
  notes: readonly { date: string }[] = [],
): Set<string> {
  const out = new Set<string>();
  for (const e of events) {
    const last = e.endLocalDate ?? e.localDate;
    let d = e.localDate;
    for (let n = 0; d <= last && n < 62; n++) {
      out.add(d);
      d = addDays(d, 1);
    }
  }
  for (const e of ics) out.add(e.date);
  for (const t of tasks) out.add(t.due);
  for (const n of notes) out.add(n.date);
  return out;
}
