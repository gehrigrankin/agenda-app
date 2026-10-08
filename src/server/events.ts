import "server-only";

import { and, eq, gte, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { calendarEvents, tags } from "@/db/schema";

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
  /** Subject tag id (owner-checked on write); null = no subject. */
  tagId: string | null;
  /** Free-text notes for this one event; null = none. */
  notes: string | null;
}

export const EVENT_NOTES_MAX = 5000;

const EVENT_COLUMNS = {
  id: calendarEvents.id,
  title: calendarEvents.title,
  localDate: calendarEvents.localDate,
  endLocalDate: calendarEvents.endLocalDate,
  startMin: calendarEvents.startMin,
  endMin: calendarEvents.endMin,
  tagId: calendarEvents.tagId,
  notes: calendarEvents.notes,
};

/** Throws unless `tagId` is one of the owner's tags. */
async function assertOwnTag(ownerId: string, tagId: string): Promise<void> {
  const [row] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.id, tagId), eq(tags.ownerId, ownerId)))
    .limit(1);
  if (!row) throw new Error("Unknown tag");
}

/** Clamp a start/end pair the way every writer stores it. */
function clampTimes(
  startMin: number | null,
  endMin: number | null,
): { start: number | null; end: number | null } {
  if (startMin === null) return { start: null, end: null };
  const start = Math.max(0, Math.min(1439, Math.round(startMin)));
  // Untimed end is fine (a bare "3pm" event), but an end needs a start.
  // Outer clamp last: a start near midnight must not push the end past
  // 1440 (the timeline would map it into the next day).
  const end =
    endMin === null
      ? null
      : Math.min(1440, Math.max(start + 5, Math.round(endMin)));
  return { start, end };
}

function normalizeNotes(notes: string | null): string | null {
  if (notes === null) return null;
  const trimmed = notes.slice(0, EVENT_NOTES_MAX);
  return trimmed.trim() ? trimmed : null;
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
    .select(EVENT_COLUMNS)
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
  tagId: string | null = null,
  notes: string | null = null,
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
  const { start, end } = clampTimes(startMin, endMin);
  if (tagId !== null) await assertOwnTag(ownerId, tagId);
  const [row] = await db
    .insert(calendarEvents)
    .values({
      ownerId,
      title: trimmed,
      localDate,
      endLocalDate: spanEnd,
      startMin: start,
      endMin: end,
      tagId,
      notes: normalizeNotes(notes),
    })
    .returning(EVENT_COLUMNS);
  return row;
}

export interface EventPatch {
  title?: string;
  /** Moves the event; a multi-day span keeps its length. */
  localDate?: string;
  /** Both together: null start = all-day. */
  times?: { startMin: number | null; endMin: number | null };
  tagId?: string | null;
  notes?: string | null;
}

/**
 * Partial update — only the fields present in `patch` change. Returns the
 * stored row, or null when the event isn't the owner's.
 */
export async function updateEvent(
  ownerId: string,
  id: string,
  patch: EventPatch,
): Promise<UserEvent | null> {
  const [current] = await db
    .select(EVENT_COLUMNS)
    .from(calendarEvents)
    .where(and(eq(calendarEvents.id, id), eq(calendarEvents.ownerId, ownerId)))
    .limit(1);
  if (!current) return null;

  const set: Partial<typeof calendarEvents.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (patch.title !== undefined) {
    const trimmed = patch.title.trim().slice(0, 300);
    if (!trimmed) throw new Error("Empty title");
    set.title = trimmed;
  }
  if (patch.localDate !== undefined) {
    assertDate(patch.localDate);
    set.localDate = patch.localDate;
    if (current.endLocalDate !== null) {
      const span =
        (Date.parse(`${current.endLocalDate}T00:00:00Z`) -
          Date.parse(`${current.localDate}T00:00:00Z`)) /
        86_400_000;
      const end = new Date(`${patch.localDate}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + span);
      set.endLocalDate = end.toISOString().slice(0, 10);
    }
  }
  if (patch.times !== undefined) {
    const { start, end } = clampTimes(patch.times.startMin, patch.times.endMin);
    set.startMin = start;
    set.endMin = end;
  }
  if (patch.tagId !== undefined) {
    if (patch.tagId !== null) await assertOwnTag(ownerId, patch.tagId);
    set.tagId = patch.tagId;
  }
  if (patch.notes !== undefined) set.notes = normalizeNotes(patch.notes);

  const [row] = await db
    .update(calendarEvents)
    .set(set)
    .where(and(eq(calendarEvents.id, id), eq(calendarEvents.ownerId, ownerId)))
    .returning(EVENT_COLUMNS);
  return row ?? null;
}

export async function deleteEvent(ownerId: string, id: string): Promise<void> {
  await db
    .delete(calendarEvents)
    .where(and(eq(calendarEvents.id, id), eq(calendarEvents.ownerId, ownerId)));
}
