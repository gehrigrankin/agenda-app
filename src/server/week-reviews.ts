import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { weekReviews } from "@/db/schema";

/**
 * Data-access layer for cached week-review drafts (`week_reviews`), one per
 * owner per week (keyed by the Monday's local YYYY-MM-DD). Regenerating
 * overwrites the draft until the user inserts it into Sunday's note.
 */

export interface WeekReviewContent {
  done: string;
  /** Local YYYY-MM-DD dates the "done" summary references. */
  doneDays: string[];
  stillOpen: string;
  /** Local YYYY-MM-DD dates the "still open" summary references. */
  openDays: string[];
  threads: { topic: string; mentions: number }[];
}

export async function getWeekReview(ownerId: string, weekStart: string) {
  const [review] = await db
    .select()
    .from(weekReviews)
    .where(
      and(eq(weekReviews.ownerId, ownerId), eq(weekReviews.weekStart, weekStart)),
    )
    .limit(1);
  if (!review) return null;
  return { ...review, content: review.content as WeekReviewContent };
}

/**
 * Write (or regenerate) the draft for a week. Upserts on the
 * (ownerId, weekStart) unique index; a regenerated draft resets
 * `insertedNoteId` since the previously-inserted content no longer matches.
 */
export async function upsertWeekReview(
  ownerId: string,
  weekStart: string,
  content: WeekReviewContent,
) {
  const [review] = await db
    .insert(weekReviews)
    .values({ ownerId, weekStart, content })
    .onConflictDoUpdate({
      target: [weekReviews.ownerId, weekReviews.weekStart],
      set: { content, insertedNoteId: null, updatedAt: new Date() },
    })
    .returning();
  return review;
}

/** Record that the draft was inserted into a note (Sunday's daily note). */
export async function markWeekReviewInserted(
  ownerId: string,
  weekStart: string,
  noteId: string,
) {
  const [review] = await db
    .update(weekReviews)
    .set({ insertedNoteId: noteId, updatedAt: new Date() })
    .where(
      and(eq(weekReviews.ownerId, ownerId), eq(weekReviews.weekStart, weekStart)),
    )
    .returning();
  return review ?? null;
}
