"use server";

import {
  listEventsForRange as listIcsEventsForRange,
  listIcsDayMarkers,
  type EventSpan,
  type RangeCalendarEvent,
} from "@/server/calendar";
import {
  createEvent,
  deleteEvent,
  listEventsForRange,
  type UserEvent,
} from "@/server/events";
import * as notesRepo from "@/server/notes";
import * as tasksRepo from "@/server/tasks";

import { requireOwnerId } from "../owner";

/**
 * Server actions for user-created calendar events (calendar quick-add). Same
 * contract as ../timeline/actions.ts: Clerk auth, owner-scoped repo calls,
 * client-supplied local dates validated here, plain-serializable returns. The
 * natural-language parsing happens client-side (lib/quick-event) so the input
 * can show a live preview; actions only ever see structured fields.
 */

const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function listEventsForRangeAction(
  startDate: string,
  endDate: string,
): Promise<UserEvent[]> {
  const userId = await requireOwnerId();
  if (!DATE_STR_RE.test(startDate) || !DATE_STR_RE.test(endDate)) {
    throw new Error("Invalid date");
  }
  return listEventsForRange(userId, startDate, endDate);
}

/**
 * ICS feed events over the same inclusive local-date range — the read-only
 * layer /app/calendar overlays alongside quick-add events. The server import
 * is aliased: this file's listEventsForRangeAction above wraps the QUICK-ADD
 * repo's listEventsForRange (server/events.ts); the ICS reader
 * (server/calendar.ts) shares the name. `configured: false` means no feed URL
 * is set — callers render exactly as if there were no ICS layer at all.
 */
export async function listIcsEventsForRangeAction(
  startStr: string,
  endStr: string,
): Promise<{ configured: boolean; events: RangeCalendarEvent[] }> {
  const userId = await requireOwnerId();
  if (!DATE_STR_RE.test(startStr) || !DATE_STR_RE.test(endStr)) {
    throw new Error("Invalid date");
  }
  return listIcsEventsForRange(userId, startStr, endStr);
}

export interface MiniCalendarMonthData {
  /** date (YYYY-MM-DD) → daily note id. */
  dailyNotes: { id: string; date: string }[];
  /** Days with open tasks due. */
  dueDays: string[];
  /** Days with a single-day event (quick-add, or a single-day/timed/recurring
   * ICS occurrence) — the dot indicator. */
  eventDays: string[];
  /** Multi-day all-day ICS events, as continuous ranges — the bar indicator. */
  spans: EventSpan[];
}

/**
 * Everything the mini calendar widget needs for a viewed month, in one round
 * trip: daily-note days, task-due days, and event days/spans (quick-add +
 * ICS). Four repo reads run concurrently server-side, but the client makes
 * exactly one request.
 */
export async function getMiniCalendarMonthAction(
  startStr: string,
  endStr: string,
): Promise<MiniCalendarMonthData> {
  const ownerId = await requireOwnerId();
  if (!DATE_STR_RE.test(startStr) || !DATE_STR_RE.test(endStr)) {
    throw new Error("Invalid date");
  }
  const [dailyNoteRows, dueDays, userEvents, ics] = await Promise.all([
    notesRepo.listDailyNoteDatesBetween(ownerId, startStr, endStr),
    tasksRepo.listTaskDueDates(ownerId, startStr, endStr),
    listEventsForRange(ownerId, startStr, endStr),
    listIcsDayMarkers(ownerId, startStr, endStr),
  ]);
  // A day already covered by a spanning bar doesn't also get a dot — the bar
  // already says "something's here," even if the dot's own source (a
  // same-day quick-add event, say) is unrelated to the span.
  const spannedDays = new Set(ics.spans.flatMap((s) => datesInSpan(s)));
  const eventDays = new Set([
    ...userEvents.map((e) => e.localDate),
    ...ics.eventDays,
  ]);
  for (const d of spannedDays) eventDays.delete(d);
  return {
    dailyNotes: dailyNoteRows.map((r) => ({ id: r.id, date: r.date })),
    dueDays,
    eventDays: [...eventDays],
    spans: ics.spans,
  };
}

function datesInSpan(span: EventSpan): string[] {
  const out: string[] = [];
  let d = span.startDate;
  while (d <= span.endDate) {
    out.push(d);
    const [y, m, day] = d.split("-").map(Number);
    const next = new Date(y, m - 1, day + 1);
    d = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
  }
  return out;
}

export async function createEventAction(input: {
  title: string;
  date: string;
  startMin: number | null;
  endMin: number | null;
}): Promise<UserEvent> {
  const userId = await requireOwnerId();
  if (!DATE_STR_RE.test(input.date)) throw new Error("Invalid date");
  const title = input.title.trim().slice(0, 300);
  if (!title) throw new Error("Empty title");
  if (input.startMin !== null && !Number.isFinite(input.startMin)) {
    throw new Error("Invalid time");
  }
  if (input.endMin !== null && !Number.isFinite(input.endMin)) {
    throw new Error("Invalid time");
  }
  return createEvent(userId, title, input.date, input.startMin, input.endMin);
}

export async function deleteEventAction(id: string): Promise<void> {
  const userId = await requireOwnerId();
  await deleteEvent(userId, id);
}
