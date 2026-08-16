import { nextOccurrence, type RecurrenceSpec } from "./recurrence";

export type HabitDayState = "completed" | "missed" | "scheduled";

export interface HabitScheduleForDay {
  paused: boolean;
  anchorDate: string;
  endDate: string | null;
  spec: RecurrenceSpec;
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
