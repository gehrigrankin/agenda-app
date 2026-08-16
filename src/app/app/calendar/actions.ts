"use server";

import {
  listEventsForRange as listIcsEventsForRange,
  type RangeCalendarEvent,
} from "@/server/calendar";
import {
  createEvent,
  deleteEvent,
  listEventsForRange,
  type UserEvent,
} from "@/server/events";
import {
  listHabitStatusesForDate,
  type HabitStatusForDate,
} from "@/server/habits";
import { getDailyNote } from "@/server/notes";
import {
  listRecurringTaskPlansForDate,
  type RecurringTaskPlanForDate,
} from "@/server/recurring";
import { listTasksCompletedBetween, listTasksInRange } from "@/server/tasks";
import type { SerializedEditorState } from "lexical";

import { requireOwnerId } from "../owner";

/**
 * Server actions for user-created calendar events (calendar quick-add). Same
 * contract as ../timeline/actions.ts: Clerk auth, owner-scoped repo calls,
 * client-supplied local dates validated here, plain-serializable returns. The
 * natural-language parsing happens client-side (lib/quick-event) so the input
 * can show a live preview; actions only ever see structured fields.
 */

const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface CalendarDayDetail {
  date: string;
  tasks: Array<{
    id: string;
    title: string;
    completed: boolean;
    remindAt: string | null;
  }>;
  completedTasks: Array<{ id: string; title: string }>;
  recurringPlans: RecurringTaskPlanForDate[];
  note: {
    id: string;
    title: string;
    content: SerializedEditorState | null;
  } | null;
  events: UserEvent[];
  ics: { configured: boolean; events: RangeCalendarEvent[] };
  habits: HabitStatusForDate[];
}

/**
 * Everything the phone calendar needs beneath its selected date. This action
 * is read-only by design: it neither creates a missing daily note nor
 * materializes recurring task/habit occurrences while the user browses.
 */
export async function getCalendarDayDetailAction(
  date: string,
  todayDate: string,
  dayStartIso: string,
  dayEndIso: string,
): Promise<CalendarDayDetail> {
  const ownerId = await requireOwnerId();
  if (!DATE_STR_RE.test(date) || !DATE_STR_RE.test(todayDate)) {
    throw new Error("Invalid date");
  }
  const dayStart = new Date(dayStartIso);
  const dayEnd = new Date(dayEndIso);
  if (
    Number.isNaN(dayStart.getTime()) ||
    Number.isNaN(dayEnd.getTime()) ||
    dayEnd <= dayStart
  ) {
    throw new Error("Invalid day bounds");
  }

  const [
    taskRows,
    completedTaskRows,
    recurringPlans,
    noteRow,
    events,
    ics,
    habits,
  ] = await Promise.all([
    listTasksInRange(ownerId, date, date),
    listTasksCompletedBetween(ownerId, dayStart, dayEnd),
    listRecurringTaskPlansForDate(ownerId, date),
    getDailyNote(ownerId, date),
    listEventsForRange(ownerId, date, date),
    listIcsEventsForRange(ownerId, date, date),
    listHabitStatusesForDate(ownerId, date, todayDate),
  ]);

  return {
    date,
    tasks: taskRows.map((task) => ({
      id: task.id,
      title: task.title,
      completed: task.completedAt !== null,
      remindAt: task.remindAt,
    })),
    completedTasks: completedTaskRows.map((task) => ({
      id: task.id,
      title: task.title,
    })),
    recurringPlans,
    note: noteRow
      ? {
          id: noteRow.id,
          title: noteRow.title,
          content: (noteRow.content as SerializedEditorState | null) ?? null,
        }
      : null,
    events,
    ics,
    habits,
  };
}

export async function listEventsForRangeAction(
  startDate: string,
  endDate: string,
): Promise<UserEvent[]> {
  const userId = await requireOwnerId();
  if (!DATE_STR_RE.test(startDate) || !DATE_STR_RE.test(endDate)) {
    throw new Error("Invalid date");
  }
  return listEventsForRange(userId, startDate, endDate);
}

/**
 * ICS feed events over the same inclusive local-date range — the read-only
 * layer /app/calendar overlays alongside quick-add events. The server import
 * is aliased: this file's listEventsForRangeAction above wraps the QUICK-ADD
 * repo's listEventsForRange (server/events.ts); the ICS reader
 * (server/calendar.ts) shares the name. `configured: false` means no feed URL
 * is set — callers render exactly as if there were no ICS layer at all.
 */
export async function listIcsEventsForRangeAction(
  startStr: string,
  endStr: string,
): Promise<{ configured: boolean; events: RangeCalendarEvent[] }> {
  const userId = await requireOwnerId();
  if (!DATE_STR_RE.test(startStr) || !DATE_STR_RE.test(endStr)) {
    throw new Error("Invalid date");
  }
  return listIcsEventsForRange(userId, startStr, endStr);
}

export async function createEventAction(input: {
  title: string;
  date: string;
  /** Inclusive last day for a multi-day event; omit/null for a single day. */
  endDate?: string | null;
  startMin: number | null;
  endMin: number | null;
}): Promise<UserEvent> {
  const userId = await requireOwnerId();
  if (!DATE_STR_RE.test(input.date)) throw new Error("Invalid date");
  const endDate = input.endDate ?? null;
  if (endDate !== null && !DATE_STR_RE.test(endDate)) {
    throw new Error("Invalid date");
  }
  const title = input.title.trim().slice(0, 300);
  if (!title) throw new Error("Empty title");
  if (input.startMin !== null && !Number.isFinite(input.startMin)) {
    throw new Error("Invalid time");
  }
  if (input.endMin !== null && !Number.isFinite(input.endMin)) {
    throw new Error("Invalid time");
  }
  return createEvent(
    userId,
    title,
    input.date,
    input.startMin,
    input.endMin,
    endDate,
  );
}

export async function deleteEventAction(id: string): Promise<void> {
  const userId = await requireOwnerId();
  await deleteEvent(userId, id);
}
