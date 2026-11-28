import { nextOccurrence, type RecurrenceSpec } from "./recurrence";

export type HabitDayState = "completed" | "missed" | "scheduled";

export interface HabitScheduleForDay {
  paused: boolean;
  anchorDate: string;
  endDate: string | null;
  spec: RecurrenceSpec;
}

/**
 * Listing habits for a day other than today must not materialize occurrences
 * or sweep open check-ins. `listHabitsForDay` treats its date argument as
 * "today" for both of those writes, so a preview of tomorrow would delete
 * today's uncompleted habit task and claim `lastDate` forward.
 */
export function habitListWritesOccurrences(
  requestedDate: string,
  todayDate: string,
): boolean {
  return requestedDate === todayDate;
}

/**
 * Resolve one habit on one local calendar day without creating an occurrence.
 * This is deliberately pure: calendar previews may inspect any past/future day
 * without advancing a rule's materialization cursor or writing task rows.
 */
export function habitStateForDay(
  rule: HabitScheduleForDay,
  selectedDate: string,
  todayDate: string,
  completed: boolean,
): HabitDayState | null {
  if (
    rule.paused ||
    selectedDate < rule.anchorDate ||
    (rule.endDate !== null && selectedDate > rule.endDate) ||
    nextOccurrence(rule.spec, rule.anchorDate, selectedDate) !== selectedDate
  ) {
    return null;
  }
  if (completed) return "completed";
  return selectedDate < todayDate ? "missed" : "scheduled";
}
