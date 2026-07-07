import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { userSettings, type UserSettings } from "@/db/schema";

/**
 * Data-access layer for per-user settings (`user_settings`) — the handful of
 * knobs the AI features read (calendar feed URL, recall toggle, thread-scan
 * cursor). One row per owner, keyed by the Clerk user id.
 */

/**
 * Read the owner's settings. Reads never insert: when no row exists yet the
 * defaults are returned in-memory, so merely opening a settings page doesn't
 * write to the DB.
 */
export async function getSettings(ownerId: string): Promise<UserSettings> {
  const [row] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.ownerId, ownerId))
    .limit(1);
  if (row) return row;
  const now = new Date();
  return {
    ownerId,
    calendarIcsUrl: null,
    recallEnabled: true,
    threadsScannedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Upsert a settings patch. Insert-or-update on the ownerId primary key — the
 * Neon HTTP driver has no transactions, so the upsert is the atomic unit.
 */
export async function updateSettings(
  ownerId: string,
  patch: { calendarIcsUrl?: string | null; recallEnabled?: boolean },
) {
  const [row] = await db
    .insert(userSettings)
    .values({ ownerId, ...patch })
    .onConflictDoUpdate({
      target: userSettings.ownerId,
      set: { ...patch, updatedAt: new Date() },
    })
    .returning();
  return row;
}

/** Record when thread detection last scanned this owner's notes. */
export async function setThreadsScannedAt(ownerId: string, when: Date) {
  const [row] = await db
    .insert(userSettings)
    .values({ ownerId, threadsScannedAt: when })
    .onConflictDoUpdate({
      target: userSettings.ownerId,
      set: { threadsScannedAt: when, updatedAt: new Date() },
    })
    .returning();
  return row;
}
