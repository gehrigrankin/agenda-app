import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { tasks } from "@/db/schema";

/**
 * Calendar drag-to-schedule (Notes Sidebars §5c): a task dropped on a day
 * gets that due day; dropped on a time slot it also gets a block starting at
 * that slot. One UPDATE so the two halves can't disagree (setTaskDue +
 * setTaskBlock in tasks.ts would be two round trips with a window between
 * them).
 *
 * Same storage conventions as the rest of the task repo: `dueAt` is midnight
 * UTC of the client's LOCAL day, and the block is `start_min` (minutes from
 * local midnight on that day) + `duration_min`. A timed drop keeps the task's
 * existing `duration_min` (null = the UI's default length); a day-only drop
 * clears both, making the task untimed. The reminder (`remind_at_local`,
 * `remindedAt`) is deliberately untouched: where a task sits on the calendar
 * is its plan, not when to nag about it.
 */

const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function scheduleTask(
  ownerId: string,
  taskId: string,
  dateStr: string | null,
  startMin: number | null,
): Promise<{
  id: string;
  due: string | null;
  startMin: number | null;
  durationMin: number | null;
} | null> {
  if (dateStr !== null && !DATE_STR_RE.test(dateStr)) {
    throw new Error("Invalid date");
  }
  if (
    startMin !== null &&
    (!Number.isInteger(startMin) || startMin < 0 || startMin > 1439)
  ) {
    throw new Error("Invalid time");
  }
  // A time without a day means nothing on the calendar.
  if (dateStr === null && startMin !== null) {
    throw new Error("Time needs a date");
  }
  const [row] = await db
    .update(tasks)
    .set({
      dueAt: dateStr === null ? null : new Date(`${dateStr}T00:00:00.000Z`),
      startMin,
      // Keep the block's length across a move (by not setting it); no block,
      // no length.
      ...(startMin === null ? { durationMin: null } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.ownerId, ownerId)))
    .returning({
      id: tasks.id,
      dueAt: tasks.dueAt,
      startMin: tasks.startMin,
      durationMin: tasks.durationMin,
    });
  if (!row) return null;
  return {
    id: row.id,
    due: row.dueAt ? row.dueAt.toISOString().slice(0, 10) : null,
    startMin: row.startMin,
    durationMin: row.durationMin,
  };
}
