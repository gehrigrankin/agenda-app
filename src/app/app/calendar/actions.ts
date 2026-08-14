"use server";

import {
  listEventsForRange as listIcsEventsForRange,
  type RangeCalendarEvent,
} from "@/server/calendar";
import {
  createEvent,
  deleteEvent,
  listEventsForRange,
  type UserEvent,
} from "@/server/events";

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

export async function createEventAction(input: {
  title: string;
  date: string;
  /** Inclusive last day for a multi-day event; omit/null for a single day. */
  endDate?: string | null;
  startMin: number | null;
  endMin: number | null;
}): Promise<UserEvent> {
  const userId = await requireOwnerId();
  if (!DATE_STR_RE.test(input.date)) throw new Error("Invalid date");
  const endDate = input.endDate ?? null;
  if (endDate !== null && !DATE_STR_RE.test(endDate)) {
    throw new Error("Invalid date");
  }
  const title = input.title.trim().slice(0, 300);
  if (!title) throw new Error("Empty title");
  if (input.startMin !== null && !Number.isFinite(input.startMin)) {
    throw new Error("Invalid time");
  }
  if (input.endMin !== null && !Number.isFinite(input.endMin)) {
    throw new Error("Invalid time");
  }
  return createEvent(
    userId,
    title,
    input.date,
    input.startMin,
    input.endMin,
    endDate,
  );
}

export async function deleteEventAction(id: string): Promise<void> {
  const userId = await requireOwnerId();
  await deleteEvent(userId, id);
}
