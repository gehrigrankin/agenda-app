import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { bubbles, type Bubble } from "@/db/schema";

/**
 * Data-access layer for the nested bubble map. All access is owner-scoped
 * (Clerk user id). Deleting a bubble relies on the self-referential FK
 * (ON DELETE CASCADE) to remove its whole subtree.
 */

export async function listBubbles(ownerId: string): Promise<Bubble[]> {
  return db
    .select()
    .from(bubbles)
    .where(eq(bubbles.ownerId, ownerId))
    .orderBy(asc(bubbles.sortOrder), asc(bubbles.createdAt));
}

/** Ensures the user has a root bubble (parent_id IS NULL) and returns it. */
export async function getOrCreateRoot(ownerId: string): Promise<Bubble> {
  const existing = await db
    .select()
    .from(bubbles)
    .where(and(eq(bubbles.ownerId, ownerId), isNull(bubbles.parentId)))
    .orderBy(asc(bubbles.createdAt))
    .limit(1);

  if (existing[0]) return existing[0];

  const [root] = await db
    .insert(bubbles)
    .values({ ownerId, parentId: null, title: "My Map" })
    .returning();
  return root;
}

export async function getBubble(
  ownerId: string,
  id: string,
): Promise<Bubble | null> {
  const [bubble] = await db
    .select()
    .from(bubbles)
    .where(and(eq(bubbles.id, id), eq(bubbles.ownerId, ownerId)))
    .limit(1);
  return bubble ?? null;
}

export async function createBubble(
  ownerId: string,
  parentId: string,
  title: string,
): Promise<Bubble> {
  // The parent id comes from the client — make sure it's one of the caller's
  // own bubbles, or a hostile caller could graft nodes into another user's
  // tree (and have them cascade-deleted by that user later).
  const parent = await getBubble(ownerId, parentId);
  if (!parent) throw new Error("Parent bubble not found");

  const [bubble] = await db
    .insert(bubbles)
    .values({ ownerId, parentId, title: title.trim() || "Untitled" })
    .returning();
  return bubble;
}

export async function renameBubble(
  ownerId: string,
  id: string,
  title: string,
): Promise<void> {
  await db
    .update(bubbles)
    .set({ title: title.trim() || "Untitled", updatedAt: new Date() })
    .where(and(eq(bubbles.id, id), eq(bubbles.ownerId, ownerId)));
}

export async function updateBubbleStyle(
  ownerId: string,
  id: string,
  style: { emoji?: string | null; color?: string | null },
): Promise<void> {
  await db
    .update(bubbles)
    .set({ ...style, updatedAt: new Date() })
    .where(and(eq(bubbles.id, id), eq(bubbles.ownerId, ownerId)));
}

/** Opt a bubble in/out of appearing as a folder in the Notes sidebar. */
export async function setBubbleFolder(
  ownerId: string,
  id: string,
  isFolder: boolean,
): Promise<void> {
  await db
    .update(bubbles)
    .set({ isFolder, updatedAt: new Date() })
    .where(and(eq(bubbles.id, id), eq(bubbles.ownerId, ownerId)));
}

/** Deletes the bubble and (via ON DELETE CASCADE) its entire subtree. */
export async function deleteBubble(ownerId: string, id: string): Promise<void> {
  await db
    .delete(bubbles)
    .where(and(eq(bubbles.id, id), eq(bubbles.ownerId, ownerId)));
}
