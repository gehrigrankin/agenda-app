import "server-only";

import { and, eq, isNull, lt } from "drizzle-orm";

import { db } from "@/db";
import { tasks, taskBlocks } from "@/db/schema";

/**
 * Data-access layer for timeline blocks (`task_blocks`, design 15d). A block is
 * a timeboxed note-to-self for a task on one local day; the task stays a task,
 * so blocks never touch task state. One block per (task, day) — dragging a task
 * onto the timeline again just moves its block. Calendar events are NOT stored
 * here; they're read live from the ICS feed (see server/calendar.ts).
 */

const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(dateStr: string) {
  if (!DATE_STR_RE.test(dateStr)) throw new Error(`Invalid date: ${dateStr}`);
}

export interface DayBlock {
  id: string;
  taskId: string;
  title: string;
  completed: boolean;
  startMin: number;
  endMin: number;
}

/** All blocks on a local day, joined to their task's title + completion. */
export async function listBlocksForDay(
  ownerId: string,
  dateStr: string,
): Promise<DayBlock[]> {
  assertDate(dateStr);
  const rows = await db
    .select({
      id: taskBlocks.id,
      taskId: taskBlocks.taskId,
      title: tasks.title,
      completedAt: tasks.completedAt,
      startMin: taskBlocks.startMin,
      endMin: taskBlocks.endMin,
    })
    .from(taskBlocks)
    .innerJoin(tasks, eq(tasks.id, taskBlocks.taskId))
    .where(
      and(eq(taskBlocks.ownerId, ownerId), eq(taskBlocks.localDate, dateStr)),
    )
    .orderBy(taskBlocks.startMin);
  return rows.map((r) => ({
    id: r.id,
    taskId: r.taskId,
    title: r.title,
    completed: r.completedAt !== null,
    startMin: r.startMin,
    endMin: r.endMin,
  }));
}

/**
 * Place (or move) a task's block on a day. Owner-verifies the task first, then
 * upserts on the (task, day) unique index so re-dropping a task moves its
 * existing block instead of creating a duplicate.
 */
export async function placeBlock(
  ownerId: string,
  taskId: string,
  dateStr: string,
  startMin: number,
  endMin: number,
): Promise<DayBlock | null> {
  assertDate(dateStr);
  const start = Math.max(0, Math.min(1440, Math.round(startMin)));
  const end = Math.max(start + 15, Math.min(1440, Math.round(endMin)));

  const [task] = await db
    .select({ id: tasks.id, title: tasks.title, completedAt: tasks.completedAt })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.ownerId, ownerId)))
    .limit(1);
  if (!task) return null;

  const [block] = await db
    .insert(taskBlocks)
    .values({ ownerId, taskId, localDate: dateStr, startMin: start, endMin: end })
    .onConflictDoUpdate({
      target: [taskBlocks.taskId, taskBlocks.localDate],
      set: { startMin: start, endMin: end, updatedAt: new Date() },
    })
    .returning();
  return {
    id: block.id,
    taskId,
    title: task.title,
    completed: task.completedAt !== null,
    startMin: block.startMin,
    endMin: block.endMin,
  };
}

/** Remove a block (never touches the task itself). */
export async function removeBlock(ownerId: string, id: string): Promise<void> {
  await db
    .delete(taskBlocks)
    .where(and(eq(taskBlocks.id, id), eq(taskBlocks.ownerId, ownerId)));
}

/**
 * Roll unfinished blocks forward: for every block on `fromDate` whose task is
 * still open, ensure a block exists on `toDate` at the same time. Idempotent —
 * the (task, day) unique index means a task already scheduled on `toDate` is
 * left as-is (onConflictDoNothing). Completed tasks' blocks are left behind.
 * Returns how many blocks were carried.
 */
export async function rollForwardBlocks(
  ownerId: string,
  fromDate: string,
  toDate: string,
): Promise<number> {
  assertDate(fromDate);
  assertDate(toDate);
  const stale = await db
    .select({
      taskId: taskBlocks.taskId,
      startMin: taskBlocks.startMin,
      endMin: taskBlocks.endMin,
    })
    .from(taskBlocks)
    .innerJoin(tasks, eq(tasks.id, taskBlocks.taskId))
    .where(
      and(
        eq(taskBlocks.ownerId, ownerId),
        eq(taskBlocks.localDate, fromDate),
        isNull(tasks.completedAt),
      ),
    );
  if (stale.length === 0) return 0;
  const inserted = await db
    .insert(taskBlocks)
    .values(
      stale.map((s) => ({
        ownerId,
        taskId: s.taskId,
        localDate: toDate,
        startMin: s.startMin,
        endMin: s.endMin,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: taskBlocks.id });
  return inserted.length;
}

/**
 * Blocks whose day is before `beforeDate` and whose task is still open — the
 * "N unfinished blocks waiting to roll forward" hint, without materializing
 * anything. (Uses note_tasks nowhere; blocks link straight to tasks.)
 */
export async function countStaleBlocks(
  ownerId: string,
  beforeDate: string,
): Promise<number> {
  assertDate(beforeDate);
  const rows = await db
    .select({ id: taskBlocks.id })
    .from(taskBlocks)
    .innerJoin(tasks, eq(tasks.id, taskBlocks.taskId))
    .where(
      and(
        eq(taskBlocks.ownerId, ownerId),
        lt(taskBlocks.localDate, beforeDate),
        isNull(tasks.completedAt),
      ),
    );
  return rows.length;
}
