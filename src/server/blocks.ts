import "server-only";

import { and, desc, eq, gte, isNull, lt } from "drizzle-orm";

import { db } from "@/db";
import { tasks, taskBlocks } from "@/db/schema";
import { addDays, DATE_STR_RE } from "@/lib/dates";

/**
 * Data-access layer for timeline blocks (`task_blocks`, design 15d). A block is
 * a timeboxed note-to-self for a task on one local day; the task stays a task,
 * so blocks never touch task state. One block per (task, day) — dragging a task
 * onto the timeline again just moves its block. Calendar events are NOT stored
 * here; they're read live from the ICS feed (see server/calendar.ts).
 */

/** How far back `rollForwardBlocks`/`countStaleBlocks` look for a prior day
 * with unfinished blocks — enough to survive a skipped weekend without
 * reaching back indefinitely. */
const ROLL_FORWARD_LOOKBACK_DAYS = 7;

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
 * The most recent day strictly before `beforeDate` (searching back at most
 * `lookbackDays` days) that has at least one unfinished block. Returns null
 * when nothing unfinished is found in the window.
 */
async function findLatestDayWithUnfinishedBlocks(
  ownerId: string,
  beforeDate: string,
  lookbackDays: number,
): Promise<string | null> {
  const earliest = addDays(beforeDate, -lookbackDays);
  const [row] = await db
    .select({ localDate: taskBlocks.localDate })
    .from(taskBlocks)
    .innerJoin(tasks, eq(tasks.id, taskBlocks.taskId))
    .where(
      and(
        eq(taskBlocks.ownerId, ownerId),
        gte(taskBlocks.localDate, earliest),
        lt(taskBlocks.localDate, beforeDate),
        isNull(tasks.completedAt),
      ),
    )
    .orderBy(desc(taskBlocks.localDate))
    .limit(1);
  return row?.localDate ?? null;
}

/**
 * Roll unfinished blocks forward onto `toDate`: looks back up to
 * `lookbackDays` (default 7, so skipping a weekend doesn't silently lose
 * Friday's plan) for the most recent prior day that has any unfinished
 * blocks, and carries just that one day's blocks — never merging multiple
 * stale days together. For every block on that day whose task is still open,
 * ensures a block exists on `toDate` at the same time. Idempotent — the
 * (task, day) unique index means a task already scheduled on `toDate` is left
 * as-is (onConflictDoNothing). Completed tasks' blocks are left behind.
 * Returns how many blocks were carried.
 */
export async function rollForwardBlocks(
  ownerId: string,
  toDate: string,
  lookbackDays: number = ROLL_FORWARD_LOOKBACK_DAYS,
): Promise<number> {
  assertDate(toDate);
  const fromDate = await findLatestDayWithUnfinishedBlocks(
    ownerId,
    toDate,
    lookbackDays,
  );
  if (!fromDate) return 0;
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
 * Unfinished blocks waiting to roll forward onto `beforeDate` — the "N
 * unfinished blocks" hint, without materializing anything. Scoped to the same
 * `lookbackDays` window `rollForwardBlocks` actually reaches, so the hint
 * never advertises blocks so old they'd never auto-roll (blocks stale beyond
 * the window need a manual look, not a silent carry-forward).
 */
export async function countStaleBlocks(
  ownerId: string,
  beforeDate: string,
  lookbackDays: number = ROLL_FORWARD_LOOKBACK_DAYS,
): Promise<number> {
  assertDate(beforeDate);
  const earliest = addDays(beforeDate, -lookbackDays);
  const rows = await db
    .select({ id: taskBlocks.id })
    .from(taskBlocks)
    .innerJoin(tasks, eq(tasks.id, taskBlocks.taskId))
    .where(
      and(
        eq(taskBlocks.ownerId, ownerId),
        gte(taskBlocks.localDate, earliest),
        lt(taskBlocks.localDate, beforeDate),
        isNull(tasks.completedAt),
      ),
    );
  return rows.length;
}
