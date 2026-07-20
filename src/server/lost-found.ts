import "server-only";

import { and, asc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import { noteTasks, notes, taskBlocks, tasks } from "@/db/schema";

/**
 * Lost & found: a live sweep for things that quietly fell through the cracks
 * of a working library. Unlike Gardener suggestions (persisted, accept/
 * dismiss), this is a read-only report computed fresh on every visit — the
 * fix for a lost item is just going to it. Like Gardener, deliberately NOT
 * an AI feature: every heuristic is a plain owner-scoped query.
 *
 * Three ways things get lost:
 * - a task created with no due date that never got scheduled, whose source
 *   note has gone cold (or is gone entirely)
 * - a note started and abandoned — short, non-daily, untouched for weeks
 * - a note sitting in Trash long enough that it's clearly been forgotten
 */

const STRANDED_TASK_DAYS = 14;
const ABANDONED_DRAFT_DAYS = 14;
const ABANDONED_DRAFT_MAX_CHARS = 280;
const AGING_TRASH_DAYS = 14;
const MAX_PER_SECTION = 15;

export interface StrandedTask {
  id: string;
  title: string;
  createdAt: Date;
  /** Freshest live note containing the task, when one exists. */
  noteId: string | null;
  noteTitle: string | null;
}

export interface AbandonedDraft {
  id: string;
  title: string;
  updatedAt: Date;
  chars: number;
}

export interface AgingTrashNote {
  id: string;
  title: string;
  deletedAt: Date;
}

export interface LostFoundReport {
  strandedTasks: StrandedTask[];
  abandonedDrafts: AbandonedDraft[];
  agingTrash: AgingTrashNote[];
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Open tasks with no due date, no timeline block, and no recurrence, created
 * more than two weeks ago — nothing on any surface will ever resurface them.
 */
async function listStrandedTasks(ownerId: string): Promise<StrandedTask[]> {
  const rows = await db
    .select({ id: tasks.id, title: tasks.title, createdAt: tasks.createdAt })
    .from(tasks)
    .where(
      and(
        eq(tasks.ownerId, ownerId),
        isNull(tasks.completedAt),
        isNull(tasks.dueAt),
        isNull(tasks.recurringTaskId),
        lt(tasks.createdAt, daysAgo(STRANDED_TASK_DAYS)),
      ),
    )
    .orderBy(asc(tasks.createdAt))
    .limit(MAX_PER_SECTION * 2);
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [blocked, linked] = await Promise.all([
    db
      .select({ taskId: taskBlocks.taskId })
      .from(taskBlocks)
      .where(
        and(eq(taskBlocks.ownerId, ownerId), inArray(taskBlocks.taskId, ids)),
      ),
    db
      .select({
        taskId: noteTasks.taskId,
        noteId: notes.id,
        noteTitle: notes.title,
        noteUpdatedAt: notes.updatedAt,
      })
      .from(noteTasks)
      .innerJoin(notes, eq(notes.id, noteTasks.noteId))
      .where(and(inArray(noteTasks.taskId, ids), isNull(notes.deletedAt))),
  ]);

  // A task with a block is planned, not stranded.
  const hasBlock = new Set(blocked.map((b) => b.taskId));
  // Keep the freshest live note per task as the way back to it.
  const noteByTask = new Map<
    string,
    { noteId: string; noteTitle: string; noteUpdatedAt: Date }
  >();
  for (const l of linked) {
    const prev = noteByTask.get(l.taskId);
    if (!prev || l.noteUpdatedAt > prev.noteUpdatedAt) {
      noteByTask.set(l.taskId, {
        noteId: l.noteId,
        noteTitle: l.noteTitle,
        noteUpdatedAt: l.noteUpdatedAt,
      });
    }
  }

  return rows
    .filter((r) => !hasBlock.has(r.id))
    .slice(0, MAX_PER_SECTION)
    .map((r) => {
      const note = noteByTask.get(r.id);
      return {
        id: r.id,
        title: r.title,
        createdAt: r.createdAt,
        noteId: note?.noteId ?? null,
        noteTitle: note?.noteTitle ?? null,
      };
    });
}

/** Short non-daily notes untouched for weeks — started and walked away from. */
async function listAbandonedDrafts(ownerId: string): Promise<AbandonedDraft[]> {
  const chars = sql<number>`length(coalesce(${notes.textContent}, ''))`;
  return db
    .select({
      id: notes.id,
      title: notes.title,
      updatedAt: notes.updatedAt,
      chars,
    })
    .from(notes)
    .where(
      and(
        eq(notes.ownerId, ownerId),
        isNull(notes.deletedAt),
        isNull(notes.dailyDate),
        lt(notes.updatedAt, daysAgo(ABANDONED_DRAFT_DAYS)),
        sql`${chars} < ${ABANDONED_DRAFT_MAX_CHARS}`,
      ),
    )
    .orderBy(asc(notes.updatedAt))
    .limit(MAX_PER_SECTION);
}

/** Notes trashed more than two weeks ago — restore them or let them go. */
async function listAgingTrash(ownerId: string): Promise<AgingTrashNote[]> {
  const rows = await db
    .select({ id: notes.id, title: notes.title, deletedAt: notes.deletedAt })
    .from(notes)
    .where(
      and(
        eq(notes.ownerId, ownerId),
        isNotNull(notes.deletedAt),
        lt(notes.deletedAt, daysAgo(AGING_TRASH_DAYS)),
      ),
    )
    .orderBy(asc(notes.deletedAt))
    .limit(MAX_PER_SECTION);
  return rows.map((r) => ({ ...r, deletedAt: r.deletedAt as Date }));
}

export async function buildLostFoundReport(
  ownerId: string,
): Promise<LostFoundReport> {
  const [strandedTasks, abandonedDrafts, agingTrash] = await Promise.all([
    listStrandedTasks(ownerId),
    listAbandonedDrafts(ownerId),
    listAgingTrash(ownerId),
  ]);
  return { strandedTasks, abandonedDrafts, agingTrash };
}
