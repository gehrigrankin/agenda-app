import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { voiceMemos } from "@/db/schema";

/**
 * Data-access layer for voice memo metadata (`voice_memos`). Audio bytes go
 * through the storage adapter like image uploads; these rows keep the raw
 * audio and its transcript attached to the (daily) note it landed in.
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

export async function listVoiceMemosForNote(ownerId: string, noteId: string) {
  return db
    .select()
    .from(voiceMemos)
    .where(and(eq(voiceMemos.ownerId, ownerId), eq(voiceMemos.noteId, noteId)))
    .orderBy(desc(voiceMemos.createdAt));
}
