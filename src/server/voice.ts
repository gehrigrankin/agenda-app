import "server-only";

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
