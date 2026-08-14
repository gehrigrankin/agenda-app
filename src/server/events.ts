import "server-only";

import { and, eq, gte, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { calendarEvents } from "@/db/schema";

/**
 * Data-access layer for user-created calendar events (`calendar_events`).
 * These are the events typed into the calendar quick-add — the only calendar
 * data the app writes; the ICS feed (server/calendar.ts) stays read-only.
 * Same local-time convention as task blocks: a client-supplied YYYY-MM-DD day
 * plus minutes from local midnight (null start = all-day).
 */

const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(dateStr: string) {
  if (!DATE_STR_RE.test(dateStr)) throw new Error(`Invalid date: ${dateStr}`);
}

export interface UserEvent {
  id: string;
  title: string;
  localDate: string;
  /** Last day a multi-day event covers (inclusive); null = single-day. */
  endLocalDate: string | null;
  startMin: number | null;
  endMin: number | null;
}

/** Last day an event covers — its span end, or its single day. */
export function eventLastDay(e: UserEvent): string {
  return e.endLocalDate ?? e.localDate;
}

/**
 * Events OVERLAPPING an inclusive local-date range, day then start-time order.
 * Overlap, not containment: a multi-day event that started before the range
 * still runs through it, and a month grid has to draw its bar.
 */
export async function listEventsForRange(
  ownerId: string,
  startDate: string,
  endDate: string,
): Promise<UserEvent[]> {
  assertDate(startDate);
  assertDate(endDate);
  const rows = await db
    .select({
      id: calendarEvents.id,
      title: calendarEvents.title,
      localDate: calendarEvents.localDate,
      endLocalDate: calendarEvents.endLocalDate,
      startMin: calendarEvents.startMin,
      endMin: calendarEvents.endMin,
    })
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.ownerId, ownerId),
        lte(calendarEvents.localDate, endDate),
        // coalesce, not a second column test: single-day rows keep a null end.
        gte(
          sql`coalesce(${calendarEvents.endLocalDate}, ${calendarEvents.localDate})`,
          startDate,
        ),
      ),
    )
    .orderBy(calendarEvents.localDate, calendarEvents.startMin);
  return rows;
}

export async function createEvent(
  ownerId: string,
  title: string,
  localDate: string,
  startMin: number | null,
  endMin: number | null,
  endLocalDate: string | null = null,
): Promise<UserEvent> {
  assertDate(localDate);
  const trimmed = title.trim();
  if (!trimmed) throw new Error("Empty title");
  // An end on or before the start is not a span — store null rather than a
  // backwards one, so `endLocalDate !== null` always means "covers >1 day".
  let spanEnd: string | null = null;
  if (endLocalDate !== null) {
    assertDate(endLocalDate);
    if (endLocalDate > localDate) spanEnd = endLocalDate;
  }
  let start: number | null = null;
  let end: number | null = null;
  if (startMin !== null) {
    start = Math.max(0, Math.min(1439, Math.round(startMin)));
    // Untimed end is fine (a bare "3pm" event), but an end needs a start.
    // Outer clamp last: a start near midnight must not push the end past
    // 1440 (the timeline would map it into the next day).
    end =
      endMin === null
        ? null
        : Math.min(1440, Math.max(start + 5, Math.round(endMin)));
  }
  const [row] = await db
    .insert(calendarEvents)
    .values({
      ownerId,
      title: trimmed,
      localDate,
      endLocalDate: spanEnd,
      startMin: start,
      endMin: end,
    })
    .returning({
      id: calendarEvents.id,
      title: calendarEvents.title,
      localDate: calendarEvents.localDate,
      endLocalDate: calendarEvents.endLocalDate,
      startMin: calendarEvents.startMin,
      endMin: calendarEvents.endMin,
    });
  return row;
}

export async function deleteEvent(ownerId: string, id: string): Promise<void> {
  await db
    .delete(calendarEvents)
    .where(and(eq(calendarEvents.id, id), eq(calendarEvents.ownerId, ownerId)));
}
