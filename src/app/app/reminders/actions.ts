"use server";

import { snoozeTaskReminder } from "@/server/reminders";
import { requireOwnerId } from "../owner";

export async function snoozeTaskReminderAction(
  taskId: string,
  untilIso: string,
): Promise<boolean> {
  const ownerId = await requireOwnerId();
  const until = new Date(untilIso);
  const now = Date.now();
  if (
    !/^[0-9a-f-]{36}$/i.test(taskId) ||
    !Number.isFinite(until.getTime()) ||
    until.getTime() < now + 30_000 ||
    until.getTime() > now + 8 * 86_400_000
  ) {
    throw new Error("Invalid snooze");
  }
  return snoozeTaskReminder(ownerId, taskId, until);
}
