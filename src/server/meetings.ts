import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { meetingDeclines } from "@/db/schema";

/**
 * Data-access layer for declined meeting prompts (`meeting_declines`):
 * "decline it and it never asks again for that event". Keyed by the calendar
 * event's UID (the caller folds the start time into the uid string for
 * recurring events, so one occurrence can be declined without the rest).
 */

export async function listDeclinedEventUids(
  ownerId: string,
): Promise<string[]> {
  const rows = await db
    .select({ eventUid: meetingDeclines.eventUid })
    .from(meetingDeclines)
    .where(eq(meetingDeclines.ownerId, ownerId));
  return rows.map((r) => r.eventUid);
}

/** Idempotent: re-declining an already-declined event is a no-op. */
export async function declineEvent(
  ownerId: string,
  eventUid: string,
): Promise<void> {
  await db
    .insert(meetingDeclines)
    .values({ ownerId, eventUid })
    .onConflictDoNothing();
}
