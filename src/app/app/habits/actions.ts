"use server";

import {
  listHabitsForDay,
  logHabitToday,
  setRecurringHabit,
  type HabitForDay,
} from "@/server/habits";

import { requireUserId } from "../require-user-id";

/**
 * Server actions for habits (design 16b). Same contract as ../actions.ts:
 * Clerk auth via requireUserId, owner-scoped repo calls, client-supplied local
 * dates validated here, plain-serializable returns.
 */

const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function listHabitsForDayAction(
  dateStr: string,
): Promise<HabitForDay[]> {
  const userId = await requireUserId();
  if (!DATE_STR_RE.test(dateStr)) throw new Error("Invalid date");
  return listHabitsForDay(userId, dateStr);
}

export async function logHabitAction(
  ruleId: string,
  dateStr: string,
): Promise<{ completed: boolean } | null> {
  const userId = await requireUserId();
  if (!DATE_STR_RE.test(dateStr)) throw new Error("Invalid date");
  return logHabitToday(userId, ruleId, dateStr);
}

export async function setRecurringHabitAction(
  ruleId: string,
  isHabit: boolean,
): Promise<void> {
  const userId = await requireUserId();
  await setRecurringHabit(userId, ruleId, isHabit === true);
}
