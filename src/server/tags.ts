import "server-only";

import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { tags, taskTags, tasks } from "@/db/schema";
import { isValidTagName, normalizeTagName } from "@/lib/hashtags";

/**
 * Data-access layer for tags. Tags are FLAT labels (ROADMAP item 4); the
 * `parentId` column left over from the abandoned tags-as-folder-tree design is
 * never written here.
 *
 * `isPinned`/`sortOrder` ARE written — by the agenda lines feature. A pinned
 * tag is one ruled line on the Today agenda: the handful of "subjects" a paper
 * school agenda prints on every day, in the order the user dragged them
 * (`sortOrder` asc, then name). Pinning is therefore a small ordered SET, not a
 * per-tag flag people toggle at random, which is why `setAgendaLines` rewrites
 * the whole set rather than offering pin/unpin.
 *
 * Tags are owner-scoped by `tags.ownerId`. The join tables carry no owner of
 * their own, so every write below re-checks that BOTH ends belong to the
 * caller before linking — otherwise a guessed uuid could staple one user's
 * tag onto another's task.
 *
 * No transactions (Neon HTTP). Find-or-create is therefore
 * select → insert-ignoring-conflicts → select, leaning on the
 * `tags_owner_name_uq` index to collapse a race into one row.
 */

/** A tag as the UI needs it. */
export type TagRow = {
  id: string;
  name: string;
  color: string | null;
};

/** A tag plus how many of the owner's OPEN tasks carry it, and its agenda-line
 * standing (pinned tags are the ruled lines, `sortOrder` is their order). */
export type TagWithCount = TagRow & {
  taskCount: number;
  pinned: boolean;
  sortOrder: number;
};

/** A pinned tag — one ruled line on the agenda. */
export type AgendaLineRow = TagRow & { sortOrder: number };

function toTagRow(t: { id: string; name: string; color: string | null }): TagRow {
  return { id: t.id, name: t.name, color: t.color };
}

/**
 * Every tag the owner has, alphabetical, with a count of the open (incomplete)
 * tasks carrying each. Tags with no open tasks are still returned — they're
 * the ones you want to re-use rather than re-type.
 */
export async function listTags(ownerId: string): Promise<TagWithCount[]> {
  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      color: tags.color,
      pinned: tags.isPinned,
      sortOrder: tags.sortOrder,
      taskCount: sql<number>`count(${tasks.id})::int`,
    })
    .from(tags)
    .leftJoin(taskTags, eq(taskTags.tagId, tags.id))
    .leftJoin(
      tasks,
      and(
        eq(tasks.id, taskTags.taskId),
        eq(tasks.ownerId, ownerId),
        sql`${tasks.completedAt} is null`,
      ),
    )
    .where(eq(tags.ownerId, ownerId))
    .groupBy(tags.id, tags.name, tags.color, tags.isPinned, tags.sortOrder)
    .orderBy(asc(sql`lower(${tags.name})`));
  return rows.map((r) => ({
    ...toTagRow(r),
    taskCount: Number(r.taskCount),
    pinned: r.pinned,
    sortOrder: r.sortOrder,
  }));
}

/**
 * Find-or-create by name — what "#health" in the quick-add resolves through.
 * Names are normalized and deduped first; invalid ones are dropped rather
 * than throwing, so one bad token can't fail the whole capture. Returns the
 * tags in the order the (normalized) names were given.
 */
export async function resolveTagsByName(
  ownerId: string,
  names: string[],
): Promise<TagRow[]> {
  const wanted = [...new Set(names.map(normalizeTagName))].filter(isValidTagName);
  if (wanted.length === 0) return [];

  const existing = await db
    .select({ id: tags.id, name: tags.name, color: tags.color })
    .from(tags)
    .where(
      and(eq(tags.ownerId, ownerId), inArray(sql`lower(${tags.name})`, wanted)),
    );

  const byName = new Map(existing.map((t) => [normalizeTagName(t.name), t]));
  const missing = wanted.filter((n) => !byName.has(n));

  if (missing.length > 0) {
    // A concurrent capture may have created the same name between the select
    // above and here; the unique index turns that into a no-op rather than a
    // duplicate, and the re-select below picks up whichever row won.
    await db
      .insert(tags)
      .values(missing.map((name) => ({ ownerId, name })))
      .onConflictDoNothing();
    const created = await db
      .select({ id: tags.id, name: tags.name, color: tags.color })
      .from(tags)
      .where(
        and(
          eq(tags.ownerId, ownerId),
          inArray(sql`lower(${tags.name})`, missing),
        ),
      );
    for (const t of created) byName.set(normalizeTagName(t.name), t);
  }

  return wanted
    .map((n) => byName.get(n))
    .filter((t): t is NonNullable<typeof t> => t !== undefined)
    .map(toTagRow);
}

/**
 * Tags for a batch of tasks, keyed by task id — one query for a whole list
 * rather than one per row. Tasks with no tags are absent from the map.
 */
export async function listTagsForTasks(
  ownerId: string,
  taskIds: string[],
): Promise<Map<string, TagRow[]>> {
  const out = new Map<string, TagRow[]>();
  if (taskIds.length === 0) return out;

  const rows = await db
    .select({
      taskId: taskTags.taskId,
      id: tags.id,
      name: tags.name,
      color: tags.color,
    })
    .from(taskTags)
    .innerJoin(tags, eq(tags.id, taskTags.tagId))
    .where(and(inArray(taskTags.taskId, taskIds), eq(tags.ownerId, ownerId)))
    .orderBy(asc(sql`lower(${tags.name})`));

  for (const r of rows) {
    const list = out.get(r.taskId);
    if (list) list.push(toTagRow(r));
    else out.set(r.taskId, [toTagRow(r)]);
  }
  return out;
}

/** The subset of `tagIds` that actually belongs to `ownerId`. */
async function ownedTagIds(ownerId: string, tagIds: string[]) {
  if (tagIds.length === 0) return [];
  const rows = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.ownerId, ownerId), inArray(tags.id, tagIds)));
  return rows.map((r) => r.id);
}

/** Whether `taskId` belongs to `ownerId`. */
async function ownsTask(ownerId: string, taskId: string) {
  const [row] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.ownerId, ownerId)))
    .limit(1);
  return row !== undefined;
}

/**
 * Link tags to a task without disturbing the ones already on it — what the
 * quick-add's parsed "#health" does. Silently ignores ids the owner doesn't
 * own; returns the task's full tag list afterwards.
 */
export async function addTaskTags(
  ownerId: string,
  taskId: string,
  tagIds: string[],
): Promise<TagRow[]> {
  if (!(await ownsTask(ownerId, taskId))) throw new Error("Task not found");
  const owned = await ownedTagIds(ownerId, tagIds);
  if (owned.length > 0) {
    await db
      .insert(taskTags)
      .values(owned.map((tagId) => ({ taskId, tagId })))
      .onConflictDoNothing();
  }
  return (await listTagsForTasks(ownerId, [taskId])).get(taskId) ?? [];
}

/**
 * Replace a task's tags wholesale — what the row picker saves. Delete-then-
 * insert without a transaction: a failure between the two leaves the task
 * with fewer tags than intended, which the user sees and can redo. (The
 * alternative, insert-then-delete, can briefly show tags they removed.)
 */
export async function setTaskTags(
  ownerId: string,
  taskId: string,
  tagIds: string[],
): Promise<TagRow[]> {
  if (!(await ownsTask(ownerId, taskId))) throw new Error("Task not found");
  const owned = await ownedTagIds(ownerId, tagIds);
  await db.delete(taskTags).where(eq(taskTags.taskId, taskId));
  if (owned.length > 0) {
    await db
      .insert(taskTags)
      .values(owned.map((tagId) => ({ taskId, tagId })))
      .onConflictDoNothing();
  }
  return (await listTagsForTasks(ownerId, [taskId])).get(taskId) ?? [];
}

/**
 * Create one tag by name — get-or-create, never "already exists": the caller
 * asked for a tag with this name to exist, and it does either way. Racing
 * callers collapse onto the `tags_owner_name_uq` lower(name) index exactly as
 * in `resolveTagsByName` (insert-ignoring-conflicts, then re-select the winner).
 *
 * `color` is the one field this adds over that path — `tags.color` had no
 * writer before, only readers. Passing one means "this tag is this color", so
 * it's applied to an existing row too; omitting it leaves whatever is there.
 */
export async function createTag(
  ownerId: string,
  name: string,
  color?: string | null,
): Promise<TagRow> {
  const normalized = normalizeTagName(name);
  if (!isValidTagName(normalized)) throw new Error("Invalid tag name");
  const wanted = color?.trim() || null;

  const [inserted] = await db
    .insert(tags)
    .values({ ownerId, name: normalized, ...(wanted ? { color: wanted } : {}) })
    .onConflictDoNothing()
    .returning({ id: tags.id, name: tags.name, color: tags.color });
  if (inserted) return toTagRow(inserted);

  // Conflict: the tag already existed (or a concurrent create won the race).
  const nameMatch = and(
    eq(tags.ownerId, ownerId),
    eq(sql`lower(${tags.name})`, normalized),
  );
  if (wanted) {
    const [recolored] = await db
      .update(tags)
      .set({ color: wanted, updatedAt: new Date() })
      .where(nameMatch)
      .returning({ id: tags.id, name: tags.name, color: tags.color });
    if (recolored) return toTagRow(recolored);
  }

  const [existing] = await db
    .select({ id: tags.id, name: tags.name, color: tags.color })
    .from(tags)
    .where(nameMatch)
    .limit(1);
  // The insert conflicted, so a row with this name is there by construction;
  // only a delete between the two statements could get us here.
  if (!existing) throw new Error("Tag not found");
  return toTagRow(existing);
}

/**
 * Rename a tag. The unique index makes a collision with an existing name a
 * hard error rather than a silent merge — merging two tags is a different
 * operation than renaming one, and guessing wrong loses information.
 */
export async function renameTag(
  ownerId: string,
  tagId: string,
  name: string,
): Promise<TagRow | null> {
  const normalized = normalizeTagName(name);
  if (!isValidTagName(normalized)) throw new Error("Invalid tag name");
  const [row] = await db
    .update(tags)
    .set({ name: normalized, updatedAt: new Date() })
    .where(and(eq(tags.id, tagId), eq(tags.ownerId, ownerId)))
    .returning({ id: tags.id, name: tags.name, color: tags.color });
  return row ? toTagRow(row) : null;
}

/** Delete a tag entirely; `task_tags` rows cascade away with it. */
export async function deleteTag(ownerId: string, tagId: string): Promise<void> {
  await db
    .delete(tags)
    .where(and(eq(tags.id, tagId), eq(tags.ownerId, ownerId)));
}

// ---------------------------------------------------------------------------
// Agenda lines — the pinned tags printed as ruled lines on every agenda day.
// ---------------------------------------------------------------------------

/**
 * The owner's ruled lines, in the order they're printed: `sortOrder` first,
 * then name so a tie (two rows written with the same order, or the column's
 * default 0 on a tag pinned by some other path) still reads alphabetically
 * instead of by insertion accident.
 */
export async function listAgendaLines(
  ownerId: string,
): Promise<AgendaLineRow[]> {
  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      color: tags.color,
      sortOrder: tags.sortOrder,
    })
    .from(tags)
    .where(and(eq(tags.ownerId, ownerId), eq(tags.isPinned, true)))
    .orderBy(asc(tags.sortOrder), asc(sql`lower(${tags.name})`));
  return rows.map((r) => ({ ...toTagRow(r), sortOrder: r.sortOrder }));
}

/**
 * Replace the pinned set AND its order in one call — the settings editor saves
 * the whole list it shows, so anything missing from `orderedTagIds` is meant to
 * be unpinned. Ids the owner doesn't own are dropped; duplicates collapse to
 * their first mention, which is what the caller's list showed.
 *
 * Unpin-the-rest runs first and the per-tag re-pin follows: without a
 * transaction (Neon HTTP) a failure in between leaves FEWER lines than asked
 * for, which the user sees and can redo — the other order would briefly leave a
 * tag on two lines at once.
 */
export async function setAgendaLines(
  ownerId: string,
  orderedTagIds: string[],
): Promise<AgendaLineRow[]> {
  const wanted = [...new Set(orderedTagIds)];
  const owned = new Set(await ownedTagIds(ownerId, wanted));
  const kept = wanted.filter((id) => owned.has(id));

  const stillPinned = and(eq(tags.ownerId, ownerId), eq(tags.isPinned, true));
  await db
    .update(tags)
    .set({ isPinned: false, updatedAt: new Date() })
    .where(
      kept.length > 0 ? and(stillPinned, notInArray(tags.id, kept)) : stillPinned,
    );

  // One statement per line: the list is a handful of subjects, and the ids are
  // distinct, so these are independent writes rather than a CASE expression
  // nobody can read.
  await Promise.all(
    kept.map((id, i) =>
      db
        .update(tags)
        .set({ isPinned: true, sortOrder: i, updatedAt: new Date() })
        .where(and(eq(tags.id, id), eq(tags.ownerId, ownerId))),
    ),
  );

  return listAgendaLines(ownerId);
}

/**
 * Add one more line at the bottom — the "new line" row in the agenda, which
 * shouldn't have to know the rest of the list. Already-pinned is a no-op, not
 * a move: the user asked for the line to exist, not to be reordered.
 */
export async function appendAgendaLine(
  ownerId: string,
  tagId: string,
): Promise<AgendaLineRow[]> {
  const lines = await listAgendaLines(ownerId);
  if (lines.some((l) => l.id === tagId)) return lines;

  const nextOrder =
    lines.reduce((max, l) => Math.max(max, l.sortOrder), -1) + 1;
  await db
    .update(tags)
    .set({ isPinned: true, sortOrder: nextOrder, updatedAt: new Date() })
    .where(and(eq(tags.id, tagId), eq(tags.ownerId, ownerId)));
  return listAgendaLines(ownerId);
}
