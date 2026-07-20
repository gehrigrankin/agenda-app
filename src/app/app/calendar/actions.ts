"use server";

import { auth } from "@clerk/nextjs/server";

import {
  createEvent,
  deleteEvent,
  listEventsForRange,
  type UserEvent,
} from "@/server/events";

/**
 * Server actions for user-created calendar events (calendar quick-add). Same
 * contract as ../timeline/actions.ts: Clerk auth, owner-scoped repo calls,
 * client-supplied local dates validated here, plain-serializable returns. The
 * natural-language parsing happens client-side (lib/quick-event) so the input
 * can show a live preview; actions only ever see structured fields.
 */

async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  return userId;
}

const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function listEventsForRangeAction(
  startDate: string,
  endDate: string,
): Promise<UserEvent[]> {
  const userId = await requireUserId();
  if (!DATE_STR_RE.test(startDate) || !DATE_STR_RE.test(endDate)) {
    throw new Error("Invalid date");
  }
  return listEventsForRange(userId, startDate, endDate);
}

export async function createEventAction(input: {
  title: string;
  date: string;
  startMin: number | null;
  endMin: number | null;
}): Promise<UserEvent> {
  const userId = await requireUserId();
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
  const userId = await requireUserId();
  await deleteEvent(userId, id);
}
