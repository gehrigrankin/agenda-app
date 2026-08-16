import "server-only";

import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
} from "drizzle-orm";

import { db } from "@/db";
import { recurringTasks, tasks, type RecurringTask } from "@/db/schema";
import { habitStateForDay, type HabitDayState } from "@/lib/habit-day";
import { nextOccurrence, type RecurrenceSpec } from "@/lib/recurrence";
import {
  createRecurringTask,
  materializeDueOccurrences,
  specOf,
} from "@/server/recurring";

/**
 * Habits (design 16b): a habit is just a recurring task flagged `isHabit`. The
 * daily note grows a quiet strip for it — one tap to log, a chain of streak
 * dots that DIMS on a miss instead of resetting to zero. There is no separate
 * log table: a "log" is the completion of that day's occurrence task, so the
 * whole history already lives in `tasks` alongside everything else.
 */

/** How many scheduled occurrences the streak chain shows (mockup shows 7). */
const CHAIN_LENGTH = 7;

export type HabitDotState = "done" | "missed" | "today";

export interface HabitDot {
  /** YYYY-MM-DD of the scheduled occurrence. */
  date: string;
  state: HabitDotState;
}

export interface HabitForDay {
  /** The recurrence rule id (a habit's identity). */
  id: string;
  title: string;
  paused: boolean;
  weekdays: number[] | null;
  startDate: string;
  endDate: string | null;
  remindAt: string | null;
  /** Today's occurrence task, when one exists (materialized or logged). */
  todayTaskId: string | null;
  todayCompleted: boolean;
  /** ISO timestamp of today's log — the client renders it in local time. */
  loggedAtIso: string | null;
  /** True when today is a scheduled day for this habit. */
  scheduledToday: boolean;
  /** Trailing run of completed scheduled days (today-not-yet doesn't break it). */
  runDays: number;
  /** Oldest → newest scheduled occurrences (up to CHAIN_LENGTH). */
  dots: HabitDot[];
}

export interface HabitStatusForDate {
  id: string;
  title: string;
  state: HabitDayState;
  remindAt: string | null;
  completedAtIso: string | null;
}

/**
 * Scheduled habits and their status for an arbitrary calendar date. Unlike
 * `listHabitsForDay`, this preview reader performs no materialization, sweep,
 * or other write. That makes it safe for browsing backward and forward in a
 * calendar without changing recurrence state.
 */
export async function listHabitStatusesForDate(
  ownerId: string,
  selectedDate: string,
  todayDate: string,
): Promise<HabitStatusForDate[]> {
  const rules = await db
    .select()
    .from(recurringTasks)
    .where(
      and(
        eq(recurringTasks.ownerId, ownerId),
        eq(recurringTasks.isHabit, true),
        eq(recurringTasks.paused, false),
      ),
    );
  if (rules.length === 0) return [];

  const dueAt = new Date(`${selectedDate}T00:00:00.000Z`);
  const occurrences = await db
    .select({
      ruleId: tasks.recurringTaskId,
      completedAt: tasks.completedAt,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.ownerId, ownerId),
        inArray(
          tasks.recurringTaskId,
          rules.map((rule) => rule.id),
        ),
        eq(tasks.dueAt, dueAt),
      ),
    );

  const completedByRule = new Map<string, Date>();
  for (const occurrence of occurrences) {
    if (occurrence.ruleId && occurrence.completedAt) {
      completedByRule.set(occurrence.ruleId, occurrence.completedAt);
    }
  }

  return rules.flatMap((rule): HabitStatusForDate[] => {
    const completedAt = completedByRule.get(rule.id) ?? null;
    const state = habitStateForDay(
      {
        paused: rule.paused,
        anchorDate: rule.anchorDate,
        endDate: rule.endDate,
        spec: specOf(rule),
      },
      selectedDate,
      todayDate,
      completedAt !== null,
    );
    return state
      ? [
          {
            id: rule.id,
            title: rule.title,
            state,
            remindAt: rule.remindAt,
            completedAtIso: completedAt?.toISOString() ?? null,
          },
        ]
      : [];
  });
}

/** The last `count` scheduled occurrences on or before `todayStr`, oldest first. */
function recentScheduledDays(
  rule: { anchorDate: string; endDate?: string | null },
  spec: ReturnType<typeof specOf>,
  todayStr: string,
  count: number,
): string[] {
  // Walk forward from a generous lookback window, collecting occurrences up to
  // today, then keep the last `count`. A daily habit yields every day; a weekly
  // one only its weekday — either way we end on a clean N-dot chain.
  const days: string[] = [];
  const start =
    rule.anchorDate > isoDaysBefore(todayStr, 400)
      ? rule.anchorDate
      : isoDaysBefore(todayStr, 400);
  let cursor = start;
  for (let i = 0; i < 500 && days.length < 4000; i++) {
    const occ = nextOccurrence(spec, rule.anchorDate, cursor);
    if (!occ || occ > todayStr || (rule.endDate && occ > rule.endDate)) break;
    days.push(occ);
    cursor = isoDaysAfter(occ, 1);
  }
  return days.slice(-count);
}

function isoDaysBefore(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
function isoDaysAfter(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Every habit the user keeps, resolved for `todayStr`: today's log state plus a
 * streak chain built from the occurrence tasks' completion history. Materializes
 * due occurrences first so today's task exists to toggle.
 */
export async function listHabitsForDay(
  ownerId: string,
  todayStr: string,
  includePaused = false,
): Promise<HabitForDay[]> {
  await materializeDueOccurrences(ownerId, todayStr);
  await sweepStaleHabitOccurrences(ownerId, todayStr);

  const rules = await db
    .select()
    .from(recurringTasks)
    .where(
      and(
        eq(recurringTasks.ownerId, ownerId),
        eq(recurringTasks.isHabit, true),
        ...(includePaused ? [] : [eq(recurringTasks.paused, false)]),
      ),
    );
  if (rules.length === 0) return [];

  // One pass over the habits' occurrence tasks across the chain window.
  const windowStart = isoDaysBefore(todayStr, 400);
  const occ = await db
    .select({
      id: tasks.id,
      ruleId: tasks.recurringTaskId,
      dueAt: tasks.dueAt,
      completedAt: tasks.completedAt,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.ownerId, ownerId),
        inArray(
          tasks.recurringTaskId,
          rules.map((r) => r.id),
        ),
        isNotNull(tasks.dueAt),
        gte(tasks.dueAt, new Date(`${windowStart}T00:00:00.000Z`)),
        lte(tasks.dueAt, new Date(`${todayStr}T00:00:00.000Z`)),
      ),
    );

  // rule id → (dueDay → { taskId, completedAt })
  const byRule = new Map<
    string,
    Map<string, { taskId: string; completedAt: Date | null }>
  >();
  for (const o of occ) {
    if (!o.ruleId || !o.dueAt) continue;
    const day = o.dueAt.toISOString().slice(0, 10);
    let m = byRule.get(o.ruleId);
    if (!m) byRule.set(o.ruleId, (m = new Map()));
    m.set(day, { taskId: o.id, completedAt: o.completedAt });
  }

  return rules.map((rule) => {
    const spec = specOf(rule);
    const days = recentScheduledDays(rule, spec, todayStr, CHAIN_LENGTH);
    const occByDay = byRule.get(rule.id) ?? new Map();

    const dots: HabitDot[] = days.map((date) => {
      const done = (occByDay.get(date)?.completedAt ?? null) !== null;
      if (date === todayStr) return { date, state: done ? "done" : "today" };
      return { date, state: done ? "done" : "missed" };
    });

    // Trailing run: count back from the newest, skipping a today that isn't
    // logged yet (so an unfinished today never reads as a broken chain).
    let runDays = 0;
    for (let i = dots.length - 1; i >= 0; i--) {
      if (dots[i].state === "today") continue;
      if (dots[i].state === "done") runDays++;
      else break;
    }

    const todayEntry = occByDay.get(todayStr);
    const todayCompleted = (todayEntry?.completedAt ?? null) !== null;
    if (todayCompleted) runDays++;

    return {
      id: rule.id,
      title: rule.title,
      paused: rule.paused,
      weekdays: rule.weekdays,
      startDate: rule.anchorDate,
      endDate: rule.endDate,
      remindAt: rule.remindAt,
      todayTaskId: todayEntry?.taskId ?? null,
      todayCompleted,
      loggedAtIso: todayEntry?.completedAt
        ? todayEntry.completedAt.toISOString()
        : null,
      scheduledToday:
        !rule.paused &&
        todayStr >= rule.anchorDate &&
        (!rule.endDate || todayStr <= rule.endDate) &&
        days.includes(todayStr),
      runDays,
      dots,
    };
  });
}

/**
 * Missed-day semantics (CONTEXT.md, "Habits are not tasks"): a habit never
 * goes overdue and never carries — a missed day breaks the streak and passes.
 * The streak reads COMPLETED rows only (dots above check `completedAt`), so an
 * uncompleted occurrence for a past day serves nothing; sweep such rows
 * opportunistically on every habits read. Owner-scoped, habit rules only
 * (including paused ones — their stale open rows are just as dead).
 */
async function sweepStaleHabitOccurrences(
  ownerId: string,
  todayStr: string,
): Promise<void> {
  await db.delete(tasks).where(
    and(
      eq(tasks.ownerId, ownerId),
      isNull(tasks.completedAt),
      lt(tasks.dueAt, new Date(`${todayStr}T00:00:00.000Z`)),
      inArray(
        tasks.recurringTaskId,
        db
          .select({ id: recurringTasks.id })
          .from(recurringTasks)
          .where(
            and(
              eq(recurringTasks.ownerId, ownerId),
              eq(recurringTasks.isHabit, true),
            ),
          ),
      ),
    ),
  );
}

/**
 * Log (or un-log) today for a habit: toggles today's occurrence task, creating
 * it if the day wasn't a materialized occurrence yet (so you can log a habit on
 * a day the scheduler didn't reach). Returns the new completed state.
 */
export async function logHabitToday(
  ownerId: string,
  ruleId: string,
  todayStr: string,
): Promise<{ completed: boolean } | null> {
  const [rule] = await db
    .select()
    .from(recurringTasks)
    .where(
      and(eq(recurringTasks.id, ruleId), eq(recurringTasks.ownerId, ownerId)),
    )
    .limit(1);
  if (!rule) return null;
  if (
    !rule.isHabit ||
    rule.paused ||
    todayStr < rule.anchorDate ||
    (rule.endDate !== null && todayStr > rule.endDate) ||
    nextOccurrence(specOf(rule), rule.anchorDate, todayStr) !== todayStr
  )
    return null;

  const dueAt = new Date(`${todayStr}T00:00:00.000Z`);
  const rows = await db
    .select({ id: tasks.id, completedAt: tasks.completedAt })
    .from(tasks)
    .where(
      and(
        eq(tasks.ownerId, ownerId),
        eq(tasks.recurringTaskId, ruleId),
        eq(tasks.dueAt, dueAt),
      ),
    );
  // Prefer completing an open materialized occurrence over toggling a row
  // that's already done — so a lingering duplicate can't eat the tap.
  const existing = rows.find((r) => r.completedAt === null) ?? rows[0];

  let completed: boolean;
  if (existing) {
    completed = existing.completedAt === null;
    await db
      .update(tasks)
      .set({
        completedAt: completed ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.id, existing.id), eq(tasks.ownerId, ownerId)));
  } else {
    await db.insert(tasks).values({
      ownerId,
      title: rule.title,
      dueAt,
      remindAtLocal: rule.remindAt,
      recurringTaskId: ruleId,
      completedAt: new Date(),
    });
    completed = true;
  }

  // A task row for today now exists either way — claim the day on the rule so
  // a later materialize pass can't insert a second occurrence for it.
  await db
    .update(recurringTasks)
    .set({ lastDate: todayStr, updatedAt: new Date() })
    .where(
      and(
        eq(recurringTasks.id, ruleId),
        eq(recurringTasks.ownerId, ownerId),
        or(
          isNull(recurringTasks.lastDate),
          lt(recurringTasks.lastDate, todayStr),
        ),
      ),
    );

  return { completed };
}

/**
 * Create a habit — a recurrence rule plus the `isHabit` flag, since that flag
 * is all a habit is. Same two steps the Habits page runs (HabitsPageClient's
 * add form), including `isRule: true`: a habit is captured as a phrase, so it
 * belongs to the same presentation bucket as the typed rules.
 */
export async function createHabit(
  ownerId: string,
  title: string,
  spec: RecurrenceSpec,
  anchorDate: string,
): Promise<RecurringTask> {
  const rule = await createRecurringTask(
    ownerId,
    title,
    spec,
    anchorDate,
    true,
  );
  await setRecurringHabit(ownerId, rule.id, true);
  // The flag setter returns nothing, so `rule` still reads isHabit false —
  // re-read rather than hand back a row that lies about its own state.
  const [flagged] = await db
    .select()
    .from(recurringTasks)
    .where(
      and(eq(recurringTasks.id, rule.id), eq(recurringTasks.ownerId, ownerId)),
    )
    .limit(1);
  return flagged ?? { ...rule, isHabit: true };
}

/** Flag / unflag a recurrence rule as a habit (from the Tasks page). */
export async function setRecurringHabit(
  ownerId: string,
  ruleId: string,
  isHabit: boolean,
): Promise<void> {
  await db
    .update(recurringTasks)
    .set({ isHabit, updatedAt: new Date() })
    .where(
      and(eq(recurringTasks.id, ruleId), eq(recurringTasks.ownerId, ownerId)),
    );
}

export interface HabitScheduleInput {
  title: string;
  weekdays: number[];
  startDate: string;
  endDate: string | null;
  remindAt: string | null;
}

function validateHabitInput(input: HabitScheduleInput): HabitScheduleInput {
  const weekdays = [...new Set(input.weekdays)].sort((a, b) => a - b);
  if (!input.title.trim()) throw new Error("Habit name is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate))
    throw new Error("Invalid start date");
  if (
    input.endDate &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(input.endDate) ||
      input.endDate < input.startDate)
  ) {
    throw new Error("End date must be on or after the start date");
  }
  if (
    weekdays.length === 0 ||
    weekdays.some((d) => d < 0 || d > 6 || !Number.isInteger(d))
  ) {
    throw new Error("Choose at least one weekday");
  }
  if (input.remindAt && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.remindAt))
    throw new Error("Invalid reminder time");
  return { ...input, title: input.title.trim().slice(0, 500), weekdays };
}

export async function createScheduledHabit(
  ownerId: string,
  raw: HabitScheduleInput,
) {
  const input = validateHabitInput(raw);
  const [rule] = await db
    .insert(recurringTasks)
    .values({
      ownerId,
      title: input.title,
      freq: "weekly",
      weekday: input.weekdays[0],
      weekdays: input.weekdays,
      anchorDate: input.startDate,
      endDate: input.endDate,
      remindAt: input.remindAt,
      isHabit: true,
      isRule: true,
    })
    .returning();
  return rule;
}

export async function updateScheduledHabit(
  ownerId: string,
  id: string,
  raw: HabitScheduleInput,
) {
  const input = validateHabitInput(raw);
  const [rule] = await db
    .update(recurringTasks)
    .set({
      title: input.title,
      freq: "weekly",
      weekday: input.weekdays[0],
      weekdays: input.weekdays,
      intervalDays: null,
      monthDay: null,
      anchorDate: input.startDate,
      endDate: input.endDate,
      remindAt: input.remindAt,
      lastDate: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(recurringTasks.id, id),
        eq(recurringTasks.ownerId, ownerId),
        eq(recurringTasks.isHabit, true),
      ),
    )
    .returning();
  return rule ?? null;
}

export async function setHabitPaused(
  ownerId: string,
  id: string,
  paused: boolean,
) {
  await db
    .update(recurringTasks)
    .set({ paused, updatedAt: new Date() })
    .where(
      and(
        eq(recurringTasks.id, id),
        eq(recurringTasks.ownerId, ownerId),
        eq(recurringTasks.isHabit, true),
      ),
    );
}

export async function deleteHabit(ownerId: string, id: string) {
  await db
    .delete(recurringTasks)
    .where(
      and(
        eq(recurringTasks.id, id),
        eq(recurringTasks.ownerId, ownerId),
        eq(recurringTasks.isHabit, true),
      ),
    );
}
