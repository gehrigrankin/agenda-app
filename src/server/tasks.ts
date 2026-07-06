import "server-only";

import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  notInArray,
} from "drizzle-orm";
import type { SerializedEditorState } from "lexical";

import { db } from "@/db";
import { bubbles, notes, noteTasks, recurringTasks, tasks } from "@/db/schema";
import type { RecurrenceSpec } from "@/lib/recurrence";

import { getNote } from "./notes";

/**
 * Data-access layer for tasks. Tasks are FIRST-CLASS rows (see schema notes):
 * a task node in the editor only caches title/completed/dueAt — these rows are
 * the source of truth, and `note_tasks` records which notes a task appears in.
 */

const TITLE_MAX = 500;
const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;

function sanitizeTitle(title: string): string {
  return title.trim().slice(0, TITLE_MAX) || "Untitled task";
}

/**
 * Create a task and link it to the note it was typed into. Verifies the note
 * belongs to the owner first. No transaction (Neon HTTP): if the link insert
 * fails after the task insert, the task is a linkless orphan the next
 * reconciliation pass won't touch — harmless, and the user simply retries.
 */
export async function createTask(
  ownerId: string,
  noteId: string,
  title: string,
) {
  const note = await getNote(ownerId, noteId);
  if (!note || note.deletedAt) throw new Error("Note not found");

  const [task] = await db
    .insert(tasks)
    .values({ ownerId, title: sanitizeTitle(title) })
    .returning();
  await db
    .insert(noteTasks)
    .values({ noteId, taskId: task.id })
    .onConflictDoNothing();
  return task;
}

export async function toggleTask(
  ownerId: string,
  taskId: string,
  completed: boolean,
) {
  const [task] = await db
    .update(tasks)
    .set({ completedAt: completed ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.ownerId, ownerId)))
    .returning();
  return task ?? null;
}

export async function renameTask(
  ownerId: string,
  taskId: string,
  title: string,
) {
  const [task] = await db
    .update(tasks)
    .set({ title: sanitizeTitle(title), updatedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.ownerId, ownerId)))
    .returning();
  return task ?? null;
}

export async function setTaskDue(
  ownerId: string,
  taskId: string,
  dueAt: Date | null,
) {
  const [task] = await db
    .update(tasks)
    .set({ dueAt, updatedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.ownerId, ownerId)))
    .returning();
  return task ?? null;
}

/**
 * Create a task with no note link (typed into the daily map's task dock).
 * `dueAt` is midnight UTC of the client's local date, matching setTaskDue.
 */
export async function createStandaloneTask(
  ownerId: string,
  title: string,
  dueAt: Date | null,
) {
  const [task] = await db
    .insert(tasks)
    .values({ ownerId, title: sanitizeTitle(title), dueAt })
    .returning();
  return task;
}

/**
 * Tasks completed within [start, end) — the client supplies its local day's
 * absolute bounds since completedAt is a real instant, not a calendar date.
 */
export async function listTasksCompletedBetween(
  ownerId: string,
  start: Date,
  end: Date,
) {
  return db
    .select({ id: tasks.id, title: tasks.title, completedAt: tasks.completedAt })
    .from(tasks)
    .where(
      and(
        eq(tasks.ownerId, ownerId),
        isNotNull(tasks.completedAt),
        gte(tasks.completedAt, start),
        lt(tasks.completedAt, end),
      ),
    )
    .orderBy(asc(tasks.completedAt));
}

/**
 * Incomplete tasks due on — or overdue as of — the user's local date
 * (`dateStr` = YYYY-MM-DD from the client, same convention as daily jots).
 * Due dates are stored as midnight UTC of the chosen day, so "due by the end
 * of dateStr" is simply `dueAt < next-day midnight UTC`.
 *
 * Left-joined to note_tasks for a note to link to; a task linked to several
 * notes is deduped to its first link, and an unlinked task yields noteId null.
 */
export async function listTasksDue(ownerId: string, dateStr: string) {
  if (!DATE_STR_RE.test(dateStr)) {
    throw new Error(`Invalid date: ${dateStr}`);
  }
  const [y, m, d] = dateStr.split("-").map(Number);
  // Date.UTC normalizes overflow (Jan 32 -> Feb 1), so +1 day is safe.
  const endExclusive = new Date(Date.UTC(y, m - 1, d + 1));

  const rows = await db
    .select(openTaskColumns)
    .from(tasks)
    .leftJoin(noteTasks, eq(noteTasks.taskId, tasks.id))
    .leftJoin(notes, eq(notes.id, noteTasks.noteId))
    .leftJoin(bubbles, eq(bubbles.id, notes.bubbleId))
    .leftJoin(recurringTasks, eq(recurringTasks.id, tasks.recurringTaskId))
    .where(
      and(
        eq(tasks.ownerId, ownerId),
        isNull(tasks.completedAt),
        isNotNull(tasks.dueAt),
        lt(tasks.dueAt, endExclusive),
      ),
    )
    .orderBy(asc(tasks.dueAt));

  return dedupeOpenTasks(rows);
}

/**
 * Distinct days (YYYY-MM-DD) with OPEN tasks due between startStr and endStr
 * inclusive — the calendar's "something is due here" indicator. Due dates are
 * midnight-UTC of the local day, so the date part of the ISO string is the
 * local day by construction.
 */
export async function listTaskDueDates(
  ownerId: string,
  startStr: string,
  endStr: string,
): Promise<string[]> {
  if (!DATE_STR_RE.test(startStr) || !DATE_STR_RE.test(endStr)) {
    throw new Error("Invalid date range");
  }
  const start = new Date(`${startStr}T00:00:00.000Z`);
  const [y, m, d] = endStr.split("-").map(Number);
  const endExclusive = new Date(Date.UTC(y, m - 1, d + 1));

  const rows = await db
    .select({ dueAt: tasks.dueAt })
    .from(tasks)
    .where(
      and(
        eq(tasks.ownerId, ownerId),
        isNull(tasks.completedAt),
        isNotNull(tasks.dueAt),
        gte(tasks.dueAt, start),
        lt(tasks.dueAt, endExclusive),
      ),
    );

  const days = new Set<string>();
  for (const r of rows) {
    if (r.dueAt) days.add(r.dueAt.toISOString().slice(0, 10));
  }
  return [...days].sort();
}

/**
 * All tasks (open and completed) with a due date inside [startStr, endStr]
 * inclusive — the calendar page's month feed. Lean columns on purpose.
 */
export async function listTasksInRange(
  ownerId: string,
  startStr: string,
  endStr: string,
): Promise<
  { id: string; title: string; dueAt: Date; completedAt: Date | null }[]
> {
  if (!DATE_STR_RE.test(startStr) || !DATE_STR_RE.test(endStr)) {
    throw new Error("Invalid date range");
  }
  const start = new Date(`${startStr}T00:00:00.000Z`);
  const [y, m, d] = endStr.split("-").map(Number);
  const endExclusive = new Date(Date.UTC(y, m - 1, d + 1));

  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      dueAt: tasks.dueAt,
      completedAt: tasks.completedAt,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.ownerId, ownerId),
        isNotNull(tasks.dueAt),
        gte(tasks.dueAt, start),
        lt(tasks.dueAt, endExclusive),
      ),
    )
    .orderBy(asc(tasks.dueAt));

  return rows.filter((r): r is typeof r & { dueAt: Date } => r.dueAt !== null);
}

/** Incomplete tasks due strictly AFTER the user's local date, soonest first. */
export async function listTasksUpcoming(
  ownerId: string,
  dateStr: string,
  limit = 30,
) {
  if (!DATE_STR_RE.test(dateStr)) {
    throw new Error(`Invalid date: ${dateStr}`);
  }
  const [y, m, d] = dateStr.split("-").map(Number);
  const startInclusive = new Date(Date.UTC(y, m - 1, d + 1));

  const rows = await db
    .select(openTaskColumns)
    .from(tasks)
    .leftJoin(noteTasks, eq(noteTasks.taskId, tasks.id))
    .leftJoin(notes, eq(notes.id, noteTasks.noteId))
    .leftJoin(bubbles, eq(bubbles.id, notes.bubbleId))
    .leftJoin(recurringTasks, eq(recurringTasks.id, tasks.recurringTaskId))
    .where(
      and(
        eq(tasks.ownerId, ownerId),
        isNull(tasks.completedAt),
        isNotNull(tasks.dueAt),
        gte(tasks.dueAt, startInclusive),
      ),
    )
    .orderBy(asc(tasks.dueAt))
    // Dedupe below collapses multi-note links, so over-fetch a little.
    .limit(limit * 2);

  return dedupeOpenTasks(rows).slice(0, limit);
}

/**
 * Shared row shape for the open-task lists: the containing note (first link
 * wins), its board (bubble) chip, and the recurrence rule behind the task.
 */
const openTaskColumns = {
  id: tasks.id,
  title: tasks.title,
  dueAt: tasks.dueAt,
  remindAt: tasks.remindAtLocal,
  noteId: noteTasks.noteId,
  boardTitle: bubbles.title,
  boardColor: bubbles.color,
  ruleFreq: recurringTasks.freq,
  ruleWeekday: recurringTasks.weekday,
  ruleIntervalDays: recurringTasks.intervalDays,
  ruleMonthDay: recurringTasks.monthDay,
};

export type OpenTaskRow = {
  id: string;
  title: string;
  dueAt: Date;
  remindAt: string | null;
  noteId: string | null;
  boardTitle: string | null;
  boardColor: string | null;
  recurring: RecurrenceSpec | null;
};

function dedupeOpenTasks(
  rows: Array<
    Omit<OpenTaskRow, "dueAt" | "recurring"> & {
      dueAt: Date | null;
      ruleFreq: RecurrenceSpec["freq"] | null;
      ruleWeekday: number | null;
      ruleIntervalDays: number | null;
      ruleMonthDay: number | null;
    }
  >,
): OpenTaskRow[] {
  const seen = new Set<string>();
  const result: OpenTaskRow[] = [];
  for (const row of rows) {
    if (row.dueAt === null || seen.has(row.id)) continue;
    seen.add(row.id);
    result.push({
      id: row.id,
      title: row.title,
      dueAt: row.dueAt,
      remindAt: row.remindAt,
      noteId: row.noteId,
      boardTitle: row.boardTitle,
      boardColor: row.boardColor,
      recurring: row.ruleFreq
        ? {
            freq: row.ruleFreq,
            weekday: row.ruleWeekday,
            intervalDays: row.ruleIntervalDays,
            monthDay: row.ruleMonthDay,
            remindAt: row.remindAt,
          }
        : null,
    });
  }
  return result;
}

/** Recursively collect taskIds of "task" nodes in serialized Lexical JSON. */
function collectTaskIds(node: unknown, out: Set<string>): void {
  if (node === null || typeof node !== "object") return;
  const n = node as { type?: unknown; taskId?: unknown; children?: unknown };
  if (n.type === "task" && typeof n.taskId === "string" && n.taskId) {
    out.add(n.taskId);
  }
  if (Array.isArray(n.children)) {
    for (const child of n.children) collectTaskIds(child, out);
  }
}

/**
 * How long a fresh note_tasks link is immune from stale-link deletion. Guards
 * a race with autosave: a debounced save can serialize the editor while a
 * just-created task node still has taskId null; without the grace period that
 * snapshot would unlink (and orphan-delete) the brand-new task before the
 * follow-up save carrying its taskId lands.
 */
const RECONCILE_GRACE_MS = 60_000;

/**
 * Sync note_tasks (and orphaned tasks) for a note against its just-saved
 * serialized content. `noteId` MUST already be owner-verified by the caller
 * (saveNoteContentAction only calls this after an owner-scoped update hit).
 *
 * No transactions on Neon HTTP, so operations are ordered crash-safe:
 *   1. insert missing links   (crash after: extra links, next save re-syncs)
 *   2. delete stale links     (crash after: unlinked tasks linger, harmless)
 *   3. delete orphaned tasks  (tasks whose last link was just removed — the
 *      user deleted the block from the doc)
 *
 * Known lingering-orphan case (accepted for MVP): deleting a NOTE outright
 * cascades away its note_tasks rows (FK ON DELETE CASCADE), so tasks that were
 * only linked to that note stick around with no links. They no longer surface
 * anywhere unless they had a due date; a periodic sweep can reap them later.
 */
export async function reconcileNoteTasks(
  ownerId: string,
  noteId: string,
  content: SerializedEditorState,
): Promise<void> {
  const ids = new Set<string>();
  collectTaskIds((content as { root?: unknown }).root, ids);

  // Only ever link tasks the owner actually owns — serialized content comes
  // from the client and could reference someone else's task ids.
  let keepIds: string[] = [];
  if (ids.size > 0) {
    const owned = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.ownerId, ownerId), inArray(tasks.id, [...ids])));
    keepIds = owned.map((r) => r.id);
  }

  // 1) Insert missing links.
  if (keepIds.length > 0) {
    await db
      .insert(noteTasks)
      .values(keepIds.map((taskId) => ({ noteId, taskId })))
      .onConflictDoNothing();
  }

  // 2) Delete links no longer present in the content (grace period above).
  const staleConditions = [
    eq(noteTasks.noteId, noteId),
    lt(noteTasks.createdAt, new Date(Date.now() - RECONCILE_GRACE_MS)),
  ];
  if (keepIds.length > 0) {
    staleConditions.push(notInArray(noteTasks.taskId, keepIds));
  }
  const removed = await db
    .delete(noteTasks)
    .where(and(...staleConditions))
    .returning({ taskId: noteTasks.taskId });

  // 3) Delete tasks that now have NO remaining links anywhere (only among the
  //    ones we just unlinked, so tasks created by other flows are never
  //    swept up).
  const removedIds = [...new Set(removed.map((r) => r.taskId))];
  if (removedIds.length === 0) return;
  const stillLinked = await db
    .select({ taskId: noteTasks.taskId })
    .from(noteTasks)
    .where(inArray(noteTasks.taskId, removedIds));
  const linkedSet = new Set(stillLinked.map((r) => r.taskId));
  const orphanIds = removedIds.filter((id) => !linkedSet.has(id));
  if (orphanIds.length > 0) {
    await db
      .delete(tasks)
      .where(and(eq(tasks.ownerId, ownerId), inArray(tasks.id, orphanIds)));
  }
}
