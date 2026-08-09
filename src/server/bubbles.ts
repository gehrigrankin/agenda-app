import "server-only";

import { and, asc, eq, ilike, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { bubbles, notes, type Bubble } from "@/db/schema";
import { escapeLikePattern } from "@/server/notes";

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

  // Two concurrent first-touch requests can both reach this insert; the
  // partial unique index (one root per owner) makes the loser no-op, so
  // re-select instead of returning nothing.
  const [root] = await db
    .insert(bubbles)
    .values({ ownerId, parentId: null, title: "My Map" })
    .onConflictDoNothing()
    .returning();
  if (root) return root;

  const [winner] = await db
    .select()
    .from(bubbles)
    .where(and(eq(bubbles.ownerId, ownerId), isNull(bubbles.parentId)))
    .orderBy(asc(bubbles.createdAt))
    .limit(1);
  return winner;
}

/** Title search over the user's bubbles, for the command palette. */
export async function searchBubbles(ownerId: string, query: string, limit = 8) {
  return db
    .select({
      id: bubbles.id,
      title: bubbles.title,
      emoji: bubbles.emoji,
      parentId: bubbles.parentId,
    })
    .from(bubbles)
    .where(
      and(
        eq(bubbles.ownerId, ownerId),
        ilike(bubbles.title, `%${escapeLikePattern(query)}%`),
      ),
    )
    .orderBy(asc(bubbles.title))
    .limit(limit);
}

/** Folder bubbles (isFolder): editor "move to folder" menu + Boards dropdown. */
export async function listFolderBubbles(ownerId: string) {
  return db
    .select({
      id: bubbles.id,
      title: bubbles.title,
      emoji: bubbles.emoji,
      color: bubbles.color,
    })
    .from(bubbles)
    .where(and(eq(bubbles.ownerId, ownerId), eq(bubbles.isFolder, true)))
    .orderBy(asc(bubbles.title));
}

/**
 * Folder bubbles with their parentId, for the Notes folder tree. A folder
 * whose parent is another folder renders nested; any other parent (the root
 * bubble, or a non-folder bubble) makes it a top-level section — the tree
 * builder in src/lib/folderTree.ts does that normalization.
 */
export async function listFolderTreeBubbles(ownerId: string) {
  return db
    .select({
      id: bubbles.id,
      title: bubbles.title,
      emoji: bubbles.emoji,
      color: bubbles.color,
      parentId: bubbles.parentId,
      sortOrder: bubbles.sortOrder,
    })
    .from(bubbles)
    .where(and(eq(bubbles.ownerId, ownerId), eq(bubbles.isFolder, true)))
    .orderBy(asc(bubbles.sortOrder), asc(bubbles.title));
}

export type FolderTreeBubble = Awaited<
  ReturnType<typeof listFolderTreeBubbles>
>[number];

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
  // Whitelist the writable fields explicitly: `style` arrives from a server
  // action (plain HTTP), so the TypeScript shape isn't enforced at runtime —
  // spreading it would let a crafted payload set any bubbles column
  // (ownerId, parentId, isFolder, …).
  const set: { emoji?: string | null; color?: string | null; updatedAt: Date } =
    { updatedAt: new Date() };
  if ("emoji" in style) set.emoji = style.emoji ?? null;
  if ("color" in style) set.color = style.color ?? null;
  await db
    .update(bubbles)
    .set(set)
    .where(and(eq(bubbles.id, id), eq(bubbles.ownerId, ownerId)));
}

/**
 * Enforce the "notes live in folders" invariant (CONTEXT.md, product
 * coherence 2026-08-02): make `bubbleId` a folder and walk its parentId chain
 * so every ancestor is a folder too — a note filed anywhere in the map is
 * then always reachable from the Notes sidebar. The root bubble is never
 * promoted as an *ancestor* (top-level folders are expected to hang off a
 * non-folder root — see src/lib/folderTree.ts), but a note filed directly
 * into the root does promote the root itself, since visibility wins.
 *
 * Idempotent: rows already flagged are skipped, so repeat calls are no-ops.
 * A seen-set guards against a corrupt parentId cycle, like the repo's other
 * chain walks. Single batched UPDATE — no transaction needed (Neon HTTP has
 * none), and a crash between nothing-and-everything just leaves the same
 * call to re-run.
 */
export async function promoteToFolder(
  ownerId: string,
  bubbleId: string,
): Promise<void> {
  const all = await listBubbles(ownerId);
  const byId = new Map(all.map((b) => [b.id, b] as const));

  const toPromote: string[] = [];
  const seen = new Set<string>();
  let cursor = byId.get(bubbleId);
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    // Stop before promoting the root as an ancestor; the target itself is
    // promoted even when it IS the root (its notes must stay visible).
    if (cursor.id !== bubbleId && cursor.parentId === null) break;
    if (!cursor.isFolder) toPromote.push(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  if (toPromote.length === 0) return;

  await db
    .update(bubbles)
    .set({ isFolder: true, updatedAt: new Date() })
    .where(and(eq(bubbles.ownerId, ownerId), inArray(bubbles.id, toPromote)));
}

/**
 * Create a bubble and make it a folder in one call — the repo-level equivalent
 * of the Notes sidebar's createSubfolderAction, for callers with no UI to walk
 * (the machine-facing API). No `parentId` means the owner's root, so a folder
 * asked for with no home still lands somewhere real.
 *
 * Promotion goes through `promoteToFolder`, not `setBubbleFolder`: flagging the
 * ancestor chain too is what makes the new folder actually reachable in the
 * sidebar tree.
 */
export async function createFolder(
  ownerId: string,
  title: string,
  parentId?: string | null,
): Promise<Bubble> {
  const parent = parentId ?? (await getOrCreateRoot(ownerId)).id;
  const bubble = await createBubble(ownerId, parent, title);
  await promoteToFolder(ownerId, bubble.id);
  // The insert above returned the pre-promotion row (isFolder false) — re-read
  // rather than hand back a row that lies about its own state.
  return (await getBubble(ownerId, bubble.id)) ?? { ...bubble, isFolder: true };
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

/**
 * Reparent a bubble (drag & drop). Refuses self-moves, moving the root, and
 * moves into the bubble's own subtree (which would orphan the whole branch as
 * an unreachable cycle). Check-then-act without a transaction is fine here:
 * the tree is single-owner, so there's no concurrent writer to race.
 */
export async function moveBubble(
  ownerId: string,
  id: string,
  newParentId: string,
): Promise<void> {
  if (id === newParentId) {
    throw new Error("Cannot move a bubble into itself");
  }

  // One load gives us existence + ownership of both ends and the ancestor
  // chain for the cycle check.
  const all = await listBubbles(ownerId);
  const byId = new Map(all.map((b) => [b.id, b] as const));
  const moved = byId.get(id);
  const target = byId.get(newParentId);
  if (!moved || !target) throw new Error("Bubble not found");
  if (!moved.parentId) throw new Error("Cannot move the root bubble");

  // Walk the target's ancestor chain: if it passes through the moved bubble,
  // the target is inside the moved subtree. The seen-set stops us from
  // spinning on a pre-existing corrupt cycle.
  const seen = new Set<string>();
  let cursor: Bubble | undefined = target;
  while (cursor && !seen.has(cursor.id)) {
    if (cursor.id === id) {
      throw new Error("Cannot move a bubble into its own subtree");
    }
    seen.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }

  await db
    .update(bubbles)
    .set({ parentId: newParentId, updatedAt: new Date() })
    .where(and(eq(bubbles.id, id), eq(bubbles.ownerId, ownerId)));
}

/** Deletes the bubble and (via ON DELETE CASCADE) its entire subtree. */
export async function deleteBubble(ownerId: string, id: string): Promise<void> {
  await db
    .delete(bubbles)
    .where(and(eq(bubbles.id, id), eq(bubbles.ownerId, ownerId)));
}

/**
 * The safe folder delete (Notes sidebar): every note anywhere in the
 * folder's subtree moves to Trash as an unfiled note, THEN the bubble
 * subtree is removed. Detaching (bubbleId = null) matters — the notes FK
 * cascades on bubble delete, so a note still attached when the bubble goes
 * would be hard-deleted, skipping Trash entirely. This way "delete folder"
 * is always recoverable note-by-note, unlike the canvas's deleteBubble.
 */
export async function deleteFolderToTrash(
  ownerId: string,
  id: string,
): Promise<void> {
  const all = await listBubbles(ownerId);
  if (!all.some((b) => b.id === id)) return;

  // Collect the subtree (personal-scale: walk the full list in memory).
  const childrenOf = new Map<string, string[]>();
  for (const b of all) {
    if (!b.parentId) continue;
    const list = childrenOf.get(b.parentId);
    if (list) list.push(b.id);
    else childrenOf.set(b.parentId, [b.id]);
  }
  const subtree: string[] = [];
  const stack = [id];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    subtree.push(cur);
    for (const child of childrenOf.get(cur) ?? []) stack.push(child);
  }

  // Live notes → Trash, detached. Already-trashed notes just detach so the
  // cascade can't reach them either.
  await db
    .update(notes)
    .set({ deletedAt: new Date(), bubbleId: null })
    .where(
      and(
        eq(notes.ownerId, ownerId),
        inArray(notes.bubbleId, subtree),
        isNull(notes.deletedAt),
      ),
    );
  await db
    .update(notes)
    .set({ bubbleId: null })
    .where(and(eq(notes.ownerId, ownerId), inArray(notes.bubbleId, subtree)));

  await db
    .delete(bubbles)
    .where(and(eq(bubbles.id, id), eq(bubbles.ownerId, ownerId)));
}
