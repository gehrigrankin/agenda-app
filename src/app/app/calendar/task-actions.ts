"use server";

import { scheduleTask } from "@/server/task-schedule";

import { requireOwnerId } from "../owner";

/**
 * Calendar page: schedule a task by dropping it on the grid. `dateStr` is the
 * user's LOCAL day (YYYY-MM-DD), `startMin` the block start in minutes from
 * local midnight, or null for "that day, no time" (a month cell or the all-day
 * strip — clears the block). Passing both null unschedules the task. The
 * reminder is never touched. Like setTaskDueAction this skips revalidatePath:
 * the calendar re-reads its own range, and a revalidation would remount any
 * live note editor showing the task.
 */
export async function scheduleTaskAction(
  taskId: string,
  dateStr: string | null,
  startMin: number | null,
): Promise<{
  id: string;
  due: string | null;
  startMin: number | null;
  durationMin: number | null;
} | null> {
  const ownerId = await requireOwnerId();
  if (typeof taskId !== "string" || !taskId) throw new Error("Invalid task");
  if (dateStr !== null && typeof dateStr !== "string") {
    throw new Error("Invalid date");
  }
  if (startMin !== null && typeof startMin !== "number") {
    throw new Error("Invalid time");
  }
  return scheduleTask(ownerId, taskId, dateStr, startMin);
}
