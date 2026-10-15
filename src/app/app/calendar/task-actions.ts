"use server";

import { scheduleTask } from "@/server/task-schedule";

import { requireOwnerId } from "../owner";

/**
 * Calendar page: schedule a task by dropping it on the grid. `dateStr` is the
 * user's LOCAL day (YYYY-MM-DD), `time` an "HH:MM" wall-clock time or null
 * for "that day, no time" (a month cell or the all-day strip). Passing both
 * null unschedules the task. Like setTaskDueAction this skips revalidatePath:
 * the calendar re-reads its own range, and a revalidation would remount any
 * live note editor showing the task.
 */
export async function scheduleTaskAction(
  taskId: string,
  dateStr: string | null,
  time: string | null,
): Promise<{ id: string; due: string | null; remindAt: string | null } | null> {
  const ownerId = await requireOwnerId();
  if (typeof taskId !== "string" || !taskId) throw new Error("Invalid task");
  if (dateStr !== null && typeof dateStr !== "string") {
    throw new Error("Invalid date");
  }
  if (time !== null && typeof time !== "string")
    throw new Error("Invalid time");
  return scheduleTask(ownerId, taskId, dateStr, time);
}
