import "server-only";

import { and, asc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { bubbles, notes } from "@/db/schema";
import { isSortMode, type SortMode } from "@/lib/explorer-tree";
import type { SerializedEditorState } from "lexical";

import { lexicalToPlainText } from "@/lib/lexical-text";
import { backfillTextContent, escapeLikePattern } from "@/server/notes";

/**
 * Data access for the Notes Explorer (Notes Sidebars design §2b/§3): the
 * folder tree with its per-folder style and sort, every note the tree shows,
 * body search for the filter, and manual ordering. No auth here — callers
 * pass `ownerId` (see src/app/app/notes/actions.ts).
 */

/** Folder bubbles with what the Explorer renders and sorts by. */
export async function listExplorerFolders(ownerId: string) {
  const rows = await db
    .select({
      id: bubbles.id,
      title: bubbles.title,
      parentId: bubbles.parentId,
      icon: bubbles.icon,
      emoji: bubbles.emoji,
      color: bubbles.color,
      sortOrder: bubbles.sortOrder,
      sortMode: bubbles.sortMode,
      createdAt: bubbles.createdAt,
    })
    .from(bubbles)
    .where(and(eq(bubbles.ownerId, ownerId), eq(bubbles.isFolder, true)))
    .orderBy(asc(bubbles.sortOrder), asc(bubbles.createdAt));
  return rows.map((r) => ({
    ...r,
    sortMode: isSortMode(r.sortMode) ? r.sortMode : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export type ExplorerFolderRow = Awaited<
  ReturnType<typeof listExplorerFolders>
>[number];

/**
 * Every note the tree shows: live, not a daily jot, and either loose
 * (unfiled) or inside a folder bubble. Notes in plain (non-folder) bubbles
 * stay canvas-only, as before. The preview is the first ~280 chars of the
 * plain-text mirror — enough for the hover peek's first lines.
 */
export async function listExplorerNotes(ownerId: string) {
  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      folderId: notes.bubbleId,
      sortOrder: notes.sortOrder,
      createdAt: notes.createdAt,
      updatedAt: notes.updatedAt,
      preview: sql<string>`coalesce(left(${notes.textContent}, 280), '')`,
      // Only notes whose plain-text mirror predates the column ship their
      // document, to derive a preview from.
      legacyContent: sql<unknown>`case when ${notes.textContent} is null then ${notes.content} end`,
    })
    .from(notes)
    .leftJoin(bubbles, eq(bubbles.id, notes.bubbleId))
    .where(
      and(
        eq(notes.ownerId, ownerId),
        isNull(notes.deletedAt),
        isNull(notes.dailyDate),
        or(isNull(notes.bubbleId), eq(bubbles.isFolder, true)),
      ),
    );
  return rows.map(({ legacyContent, ...r }) => ({
    ...r,
    preview:
      r.preview ||
      (legacyContent
        ? lexicalToPlainText(legacyContent as SerializedEditorState, 280)
        : ""),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export type ExplorerNoteRow = Awaited<
  ReturnType<typeof listExplorerNotes>
>[number];

/**
 * Body matches for the Explorer filter (titles are matched client-side). Uses
 * the `text_content` mirror; a note whose mirror hasn't been backfilled yet
 * just can't match by body until its next save.
 */
export async function searchNoteBodies(
  ownerId: string,
  query: string,
  limit = 200,
): Promise<{ id: string; snippet: string }[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  // Notes older than the plain-text mirror can't match by body until it's
  // filled in; converge a batch per search (no-op once caught up).
  await backfillTextContent(ownerId, 60);
  const rows = await db
    .select({ id: notes.id, text: notes.textContent })
    .from(notes)
    .where(
      and(
        eq(notes.ownerId, ownerId),
        isNull(notes.deletedAt),
        isNull(notes.dailyDate),
        ilike(notes.textContent, `%${escapeLikePattern(q)}%`),
      ),
    )
    .limit(limit);
  const lower = q.toLowerCase();
  return rows.map((r) => {
    const text = r.text ?? "";
    const at = text.toLowerCase().indexOf(lower);
    const start = Math.max(0, at - 40);
    const snippet =
      (start > 0 ? "…" : "") +
      text
        .slice(start, at + q.length + 80)
        .replace(/\s+/g, " ")
        .trim();
    return { id: r.id, snippet };
  });
}

/** Per-folder sort override (null = inherit the Explorer's global sort). */
export async function setFolderSortMode(
  ownerId: string,
  id: string,
  mode: SortMode | null,
): Promise<void> {
  // The mode arrives from a server action (plain HTTP) — validate it.
  const sortMode = mode === null ? null : isSortMode(mode) ? mode : null;
  await db
    .update(bubbles)
    .set({ sortMode, updatedAt: new Date() })
    .where(and(eq(bubbles.id, id), eq(bubbles.ownerId, ownerId)));
}

/**
 * Manual order: `ids` in their new order get sortOrder 1..n in ONE statement
 * (Neon HTTP has no transactions, and a half-applied reorder would scramble
 * the folder). Ids that aren't the owner's are simply not matched.
 */
export async function reorderNotes(ownerId: string, ids: string[]) {
  const list = dedupe(ids).slice(0, 500);
  if (list.length === 0) return;
  const cases = sql.join(
    list.map((id, i) => sql`when ${id}::uuid then ${i + 1}`),
    sql` `,
  );
  await db
    .update(notes)
    .set({
      sortOrder: sql`case ${notes.id} ${cases} else ${notes.sortOrder} end`,
    })
    .where(and(eq(notes.ownerId, ownerId), inArray(notes.id, list)));
}

export async function reorderFolders(ownerId: string, ids: string[]) {
  const list = dedupe(ids).slice(0, 500);
  if (list.length === 0) return;
  const cases = sql.join(
    list.map((id, i) => sql`when ${id}::uuid then ${i + 1}`),
    sql` `,
  );
  await db
    .update(bubbles)
    .set({
      sortOrder: sql`case ${bubbles.id} ${cases} else ${bubbles.sortOrder} end`,
    })
    .where(and(eq(bubbles.ownerId, ownerId), inArray(bubbles.id, list)));
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dedupe(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    if (typeof id !== "string" || !UUID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
