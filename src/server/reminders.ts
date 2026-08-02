import "server-only";

import { and, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";

import { db } from "@/db";
import { recurringTasks, tasks, userSettings } from "@/db/schema";

/**
 * Data-access for the reminder cron (/api/cron/reminders): which reminders
 * are due in a given owner's local-time window, and the dedupe stamps that
 * make each fire at most once. All date/time inputs are the OWNER'S local
 * calendar strings (YYYY-MM-DD / HH:MM) — the cron derives them from the
 * stored IANA timezone; nothing here touches Date-now.
 */

/** Owners' stored IANA timezones, for the cron fan-out. */
export async function listTimezonesForOwners(
  ownerIds: string[],
): Promise<Map<string, string>> {
  if (ownerIds.length === 0) return new Map();
  const rows = await db
    .select({ ownerId: userSettings.ownerId, timezone: userSettings.timezone })
    .from(userSettings)
    .where(
      and(
        inArray(userSettings.ownerId, ownerIds),
        isNotNull(userSettings.timezone),
      ),
    );
  return new Map(rows.map((r) => [r.ownerId, r.timezone!]));
}

/**
 * Open, not-yet-reminded tasks due on the owner's local `localDate` with a
 * reminder time in `times` ("HH:MM" values covering the cron window).
 * `dueAt` is stored as the local day's midnight UTC (see setTaskDue), so the
 * date match is an exact timestamp equality.
 */
export async function findDueTaskReminders(
  ownerId: string,
  localDate: string,
  times: string[],
): Promise<{ id: string; title: string; remindAtLocal: string | null }[]> {
  if (times.length === 0) return [];
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      remindAtLocal: tasks.remindAtLocal,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.ownerId, ownerId),
        isNull(tasks.completedAt),
        isNull(tasks.remindedAt),
        eq(tasks.dueAt, new Date(`${localDate}T00:00:00.000Z`)),
        inArray(tasks.remindAtLocal, times),
      ),
    );
}

/** Stamp a task's reminder as sent (fires at most once per task). */
export async function markTaskReminded(
  ownerId: string,
  taskId: string,
): Promise<void> {
  await db
    .update(tasks)
    .set({ remindedAt: new Date() })
    .where(and(eq(tasks.ownerId, ownerId), eq(tasks.id, taskId)));
}

/**
 * Active habit rules with a reminder time in the window that have not been
 * reminded for `localDate` yet. Whether the habit is actually DUE on
 * `localDate` per its schedule is the caller's job (pure recurrence math in
 * src/lib/recurrence — kept out of the query on purpose).
 */
export async function findHabitReminderCandidates(
  ownerId: string,
  localDate: string,
  times: string[],
) {
  if (times.length === 0) return [];
  return db
    .select()
    .from(recurringTasks)
    .where(
      and(
        eq(recurringTasks.ownerId, ownerId),
        eq(recurringTasks.isHabit, true),
        eq(recurringTasks.paused, false),
        inArray(recurringTasks.remindAt, times),
        or(
          isNull(recurringTasks.lastRemindedDate),
          ne(recurringTasks.lastRemindedDate, localDate),
        ),
      ),
    );
}

/** Stamp a habit rule's reminder for the day (at most once per local day). */
export async function markHabitReminded(
  ownerId: string,
  ruleId: string,
  localDate: string,
): Promise<void> {
  await db
    .update(recurringTasks)
    .set({ lastRemindedDate: localDate })
    .where(
      and(eq(recurringTasks.ownerId, ownerId), eq(recurringTasks.id, ruleId)),
    );
}
