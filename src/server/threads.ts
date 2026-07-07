import "server-only";

import { and, asc, count, eq, inArray, isNull, max, min, ne } from "drizzle-orm";

import { db } from "@/db";
import { notes, threadMentions, threads } from "@/db/schema";

/**
 * Data-access layer for auto-assembled topic threads (`threads` +
 * `thread_mentions`). Thread detection writes these; the timeline UI reads
 * them. Rescans are idempotent: the (ownerId, topic) unique index dedupes
 * threads and the (threadId, noteId, snippet) index dedupes mentions.
 */

export type ThreadStatus = "active" | "promoted" | "dismissed";

/**
 * All non-dismissed threads with mention stats, ordered by most recent
 * mention activity. Two queries (threads + one aggregate over mentions) —
 * fine at personal scale.
 */
export async function listThreads(ownerId: string) {
  const rows = await db
    .select({
      id: threads.id,
      topic: threads.topic,
      status: threads.status,
      promotedNoteId: threads.promotedNoteId,
    })
    .from(threads)
    .where(and(eq(threads.ownerId, ownerId), ne(threads.status, "dismissed")));
  if (rows.length === 0) return [];

  const stats = await db
    .select({
      threadId: threadMentions.threadId,
      mentionCount: count(threadMentions.id),
      firstMentionAt: min(threadMentions.mentionDate),
      lastMentionAt: max(threadMentions.mentionDate),
    })
    .from(threadMentions)
    .where(
      inArray(
        threadMentions.threadId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(threadMentions.threadId);
  const byThread = new Map(stats.map((s) => [s.threadId, s]));

  return rows
    .map((r) => {
      const s = byThread.get(r.id);
      return {
        ...r,
        mentionCount: s?.mentionCount ?? 0,
        firstMentionAt: s?.firstMentionAt ?? null,
        lastMentionAt: s?.lastMentionAt ?? null,
      };
    })
    .sort(
      (a, b) =>
        (b.lastMentionAt?.getTime() ?? 0) - (a.lastMentionAt?.getTime() ?? 0),
    );
}

/**
 * One thread with its full mention timeline (oldest first). Mentions whose
 * note is in the Trash are hidden, but their rows stay put — restoring the
 * note resurfaces them without a rescan.
 */
export async function getThread(ownerId: string, threadId: string) {
  const [thread] = await db
    .select({
      id: threads.id,
      topic: threads.topic,
      status: threads.status,
      promotedNoteId: threads.promotedNoteId,
    })
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.ownerId, ownerId)))
    .limit(1);
  if (!thread) return null;

  const mentions = await db
    .select({
      id: threadMentions.id,
      noteId: threadMentions.noteId,
      noteTitle: notes.title,
      noteDailyDate: notes.dailyDate,
      snippet: threadMentions.snippet,
      mentionDate: threadMentions.mentionDate,
      quiet: threadMentions.quiet,
    })
    .from(threadMentions)
    .innerJoin(notes, eq(threadMentions.noteId, notes.id))
    .where(
      and(eq(threadMentions.threadId, thread.id), isNull(notes.deletedAt)),
    )
    .orderBy(asc(threadMentions.mentionDate));

  return { ...thread, mentions };
}

/**
 * Idempotent write path for the thread scanner: upsert the thread on
 * (ownerId, topic) — an existing thread keeps its status and just gets its
 * updatedAt bumped — then insert mentions, deduped by the
 * (threadId, noteId, snippet) index. Mention noteIds come from scan output
 * over client-saved content, so they're re-verified against the owner's own
 * notes before insert. Returns the thread id.
 */
export async function upsertThreadWithMentions(
  ownerId: string,
  topic: string,
  mentions: Array<{
    noteId: string;
    snippet: string;
    mentionDate: Date;
    quiet: boolean;
  }>,
) {
  const [thread] = await db
    .insert(threads)
    .values({ ownerId, topic })
    .onConflictDoUpdate({
      target: [threads.ownerId, threads.topic],
      set: { updatedAt: new Date() },
    })
    .returning({ id: threads.id });

  if (mentions.length > 0) {
    const owned = await db
      .select({ id: notes.id })
      .from(notes)
      .where(
        and(
          eq(notes.ownerId, ownerId),
          inArray(notes.id, [...new Set(mentions.map((m) => m.noteId))]),
        ),
      );
    const ownedIds = new Set(owned.map((r) => r.id));
    const values = mentions
      .filter((m) => ownedIds.has(m.noteId))
      .map((m) => ({
        threadId: thread.id,
        ownerId,
        noteId: m.noteId,
        snippet: m.snippet,
        mentionDate: m.mentionDate,
        quiet: m.quiet,
      }));
    if (values.length > 0) {
      await db.insert(threadMentions).values(values).onConflictDoNothing();
    }
  }

  return thread.id;
}

/** Update a thread's lifecycle status (promote sets `promotedNoteId` too). */
export async function setThreadStatus(
  ownerId: string,
  threadId: string,
  status: ThreadStatus,
  promotedNoteId?: string | null,
) {
  const [thread] = await db
    .update(threads)
    .set({
      status,
      updatedAt: new Date(),
      ...(promotedNoteId !== undefined ? { promotedNoteId } : {}),
    })
    .where(and(eq(threads.id, threadId), eq(threads.ownerId, ownerId)))
    .returning();
  return thread ?? null;
}
