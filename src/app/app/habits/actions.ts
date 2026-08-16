"use server";

import {
  listHabitsForDay,
  logHabitToday,
  setRecurringHabit,
  createScheduledHabit,
  updateScheduledHabit,
  setHabitPaused,
  deleteHabit,
  type HabitScheduleInput,
  type HabitForDay,
} from "@/server/habits";

import { requireOwnerId } from "../owner";

/**
 * Server actions for habits (design 16b). Same contract as ../actions.ts:
 * Clerk auth via requireOwnerId, owner-scoped repo calls, client-supplied local
 * dates validated here, plain-serializable returns.
 */

const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function listHabitsForDayAction(
  dateStr: string,
  includePaused = false,
): Promise<HabitForDay[]> {
  const userId = await requireOwnerId();
  if (!DATE_STR_RE.test(dateStr)) throw new Error("Invalid date");
  return listHabitsForDay(userId, dateStr, includePaused === true);
}

export async function logHabitAction(
  ruleId: string,
  dateStr: string,
): Promise<{ completed: boolean } | null> {
  const userId = await requireOwnerId();
  if (!DATE_STR_RE.test(dateStr)) throw new Error("Invalid date");
  return logHabitToday(userId, ruleId, dateStr);
}

export async function setRecurringHabitAction(
  ruleId: string,
  isHabit: boolean,
): Promise<void> {
  const userId = await requireOwnerId();
  await setRecurringHabit(userId, ruleId, isHabit === true);
}

function validateInput(input: HabitScheduleInput): HabitScheduleInput {
  if (!Array.isArray(input.weekdays)) throw new Error("Invalid weekdays");
  return input;
}

export async function createHabitAction(
  input: HabitScheduleInput,
): Promise<void> {
  const userId = await requireOwnerId();
  await createScheduledHabit(userId, validateInput(input));
}

export async function updateHabitAction(
  id: string,
  input: HabitScheduleInput,
): Promise<void> {
  const userId = await requireOwnerId();
  await updateScheduledHabit(userId, id, validateInput(input));
}

export async function setHabitPausedAction(
  id: string,
  paused: boolean,
): Promise<void> {
  const userId = await requireOwnerId();
  await setHabitPaused(userId, id, paused === true);
}

export async function deleteHabitAction(id: string): Promise<void> {
  const userId = await requireOwnerId();
  await deleteHabit(userId, id);
}
