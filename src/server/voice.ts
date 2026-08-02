import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { voiceMemos } from "@/db/schema";

/**
 * Data-access layer for voice memo metadata (`voice_memos`). Audio bytes go
 * through the storage adapter like image uploads; these rows keep the raw
 * audio and its transcript attached to the (daily) note it landed in.
 *
 * There is no "kept" marker column: every recording uploads a memo row
 * whether or not the user pressed "Keep all", and the recovery list simply
 * shows the most recent rows so nothing recorded is ever lost.
 */

export async function insertVoiceMemo(
  ownerId: string,
  data: {
    noteId: string | null;
    url: string;
    storageKey?: string | null;
    durationSec?: number | null;
    transcript: string;
  },
) {
  const [memo] = await db
    .insert(voiceMemos)
    .values({ ownerId, ...data })
    .returning();
  return memo;
}

/** Most recent voice memos, newest first — the recovery popover's list. */
export async function listVoiceMemos(ownerId: string, limit = 10) {
  return db
    .select({
      id: voiceMemos.id,
      createdAt: voiceMemos.createdAt,
      transcript: voiceMemos.transcript,
      noteId: voiceMemos.noteId,
      durationSec: voiceMemos.durationSec,
    })
    .from(voiceMemos)
    .where(eq(voiceMemos.ownerId, ownerId))
    .orderBy(desc(voiceMemos.createdAt))
    .limit(limit);
}

/**
 * Hard-delete a memo row. Returns the removed row's storage key (when any) so
 * the caller can also delete the audio bytes via the storage adapter, or null
 * when no owned row matched.
 */
export async function deleteVoiceMemo(ownerId: string, id: string) {
  const [row] = await db
    .delete(voiceMemos)
    .where(and(eq(voiceMemos.id, id), eq(voiceMemos.ownerId, ownerId)))
    .returning({ id: voiceMemos.id, storageKey: voiceMemos.storageKey });
  return row ?? null;
}
