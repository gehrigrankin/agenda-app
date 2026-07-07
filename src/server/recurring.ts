import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { recurringTasks, tasks, type RecurringTask } from "@/db/schema";
import { dueOccurrence, type RecurrenceSpec } from "@/lib/recurrence";

/**
 * Data-access layer for recurrence RULES (`recurring_tasks`). Occurrences are
 * ordinary `tasks` rows created by `materializeDueOccurrences` — after that,
 * the existing task surfaces (due lists, toggling, the editor) handle them
 * with zero special cases.
 */

const TITLE_MAX = 500;
const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_STR_RE = /^\d{2}:\d{2}$/;

function sanitizeTitle(title: string): string {
  return title.trim().slice(0, TITLE_MAX) || "Untitled task";
}

function assertDateStr(dateStr: string): void {
  if (!DATE_STR_RE.test(dateStr)) throw new Error(`Invalid date: ${dateStr}`);
}

export function specOf(rule: RecurringTask): RecurrenceSpec {
  return {
    freq: rule.freq,
    weekday: rule.weekday,
    intervalDays: rule.intervalDays,
    monthDay: rule.monthDay,
    remindAt: rule.remindAt,
  };
}

function specColumns(spec: RecurrenceSpec) {
  if (spec.remindAt !== null && !TIME_STR_RE.test(spec.remindAt)) {
    throw new Error("Invalid reminder time");
  }
  return {
    freq: spec.freq,
    weekday: spec.weekday,
    intervalDays: spec.intervalDays,
    monthDay: spec.monthDay,
    remindAt: spec.remindAt,
  };
}

export async function listRecurringTasks(ownerId: string) {
  return db
    .select()
    .from(recurringTasks)
    .where(eq(recurringTasks.ownerId, ownerId))
    .orderBy(asc(recurringTasks.createdAt));
}

/**
 * `anchorDate` is the client's local day — the schedule counts from it.
 * `isRule` tags which Tasks-page section the row belongs to (structured
 * "Recurring task" vs. typed "Rule"); it's presentation-only.
 */
export async function createRecurringTask(
  ownerId: string,
  title: string,
  spec: RecurrenceSpec,
  anchorDate: string,
  isRule = false,
) {
  assertDateStr(anchorDate);
  const [rule] = await db
    .insert(recurringTasks)
    .values({
      ownerId,
      title: sanitizeTitle(title),
      anchorDate,
      isRule,
      ...specColumns(spec),
    })
    .returning();
  return rule;
}

/**
 * Reschedule a rule. The anchor moves to the client's local day and the
 * occurrence cursor resets with it, so the next occurrence is computed purely
 * from the new schedule (yesterday's materialized task, if any, stays).
 */
export async function updateRecurringTask(
  ownerId: string,
  id: string,
  title: string,
  spec: RecurrenceSpec,
  anchorDate: string,
) {
  assertDateStr(anchorDate);
  const [rule] = await db
    .update(recurringTasks)
    .set({
      title: sanitizeTitle(title),
      anchorDate,
      lastDate: null,
      updatedAt: new Date(),
      ...specColumns(spec),
    })
    .where(and(eq(recurringTasks.id, id), eq(recurringTasks.ownerId, ownerId)))
    .returning();
  return rule ?? null;
}

export async function setRecurringPaused(
  ownerId: string,
  id: string,
  paused: boolean,
) {
  const [rule] = await db
    .update(recurringTasks)
    .set({ paused, updatedAt: new Date() })
    .where(and(eq(recurringTasks.id, id), eq(recurringTasks.ownerId, ownerId)))
    .returning();
  return rule ?? null;
}

export async function deleteRecurringTask(ownerId: string, id: string) {
  await db
    .delete(recurringTasks)
    .where(and(eq(recurringTasks.id, id), eq(recurringTasks.ownerId, ownerId)));
}

/**
 * Materialize each active rule's due occurrence (if any) as a real task row.
 * Called lazily from the due-task list path — serverless-friendly, no cron.
 *
 * Concurrency: two simultaneous list calls race here. The UPDATE claiming
 * `lastDate` (guarded on its previous value) is the lock — only the request
 * whose claim lands inserts the task. A crash between claim and insert drops
 * that one occurrence rather than ever duplicating it; the next scheduled
 * occurrence self-heals the rule.
 */
export async function materializeDueOccurrences(
  ownerId: string,
  todayStr: string,
): Promise<void> {
  assertDateStr(todayStr);
  const rules = await db
    .select()
    .from(recurringTasks)
    .where(
      and(eq(recurringTasks.ownerId, ownerId), eq(recurringTasks.paused, false)),
    );

  for (const rule of rules) {
    const due = dueOccurrence(specOf(rule), rule.anchorDate, rule.lastDate, todayStr);
    if (!due) continue;

    const claimed = await db
      .update(recurringTasks)
      .set({ lastDate: due, updatedAt: new Date() })
      .where(
        and(
          eq(recurringTasks.id, rule.id),
          rule.lastDate === null
            ? isNull(recurringTasks.lastDate)
            : eq(recurringTasks.lastDate, rule.lastDate),
        ),
      )
      .returning({ id: recurringTasks.id });
    if (claimed.length === 0) continue;

    await db.insert(tasks).values({
      ownerId,
      title: rule.title,
      dueAt: new Date(`${due}T00:00:00.000Z`),
      remindAtLocal: rule.remindAt,
      recurringTaskId: rule.id,
    });
  }
}
