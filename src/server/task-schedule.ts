import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { tasks } from "@/db/schema";

/**
 * Calendar drag-to-schedule (Notes Sidebars §5c): a task dropped on a day
 * gets that due day; dropped on a time slot it also gets that wall-clock
 * time. One UPDATE so the two halves can't disagree (setTaskDue + setTaskTime
 * in tasks.ts would be two round trips with a window between them).
 *
 * Same storage conventions as the rest of the task repo: `dueAt` is midnight
 * UTC of the client's LOCAL day, the time rides `remind_at_local` ("HH:MM",
 * what the time chip and the reminders cron read), and `remindedAt` resets so
 * a rescheduled reminder can fire again.
 */

const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function scheduleTask(
  ownerId: string,
  taskId: string,
  dateStr: string | null,
  time: string | null,
): Promise<{ id: string; due: string | null; remindAt: string | null } | null> {
  if (dateStr !== null && !DATE_STR_RE.test(dateStr)) {
    throw new Error("Invalid date");
  }
  if (time !== null && !TIME_RE.test(time)) throw new Error("Invalid time");
  // A time without a day means nothing on the calendar.
  if (dateStr === null && time !== null) throw new Error("Time needs a date");
  const [row] = await db
    .update(tasks)
    .set({
      dueAt: dateStr === null ? null : new Date(`${dateStr}T00:00:00.000Z`),
      remindAtLocal: time,
      remindedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.ownerId, ownerId)))
    .returning({
      id: tasks.id,
      dueAt: tasks.dueAt,
      remindAt: tasks.remindAtLocal,
    });
  if (!row) return null;
  return {
    id: row.id,
    due: row.dueAt ? row.dueAt.toISOString().slice(0, 10) : null,
    remindAt: row.remindAt,
  };
}
