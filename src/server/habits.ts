import "server-only";

import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";

import { db } from "@/db";
import { recurringTasks, tasks } from "@/db/schema";
import { nextOccurrence } from "@/lib/recurrence";
import { materializeDueOccurrences, specOf } from "@/server/recurring";

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
  /** Today's occurrence task, when one exists (materialized or logged). */
  todayTaskId: string | null;
  todayCompleted: boolean;
  /** Wall-clock time today's log landed ("HH:MM" → shown as "8:04 AM"). */
  loggedAt: string | null;
  /** True when today is a scheduled day for this habit. */
  scheduledToday: boolean;
  /** Trailing run of completed scheduled days (today-not-yet doesn't break it). */
  runDays: number;
  /** Oldest → newest scheduled occurrences (up to CHAIN_LENGTH). */
  dots: HabitDot[];
}

/** The last `count` scheduled occurrences on or before `todayStr`, oldest first. */
function recentScheduledDays(
  rule: { anchorDate: string },
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
    if (!occ || occ > todayStr) break;
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
): Promise<HabitForDay[]> {
  await materializeDueOccurrences(ownerId, todayStr);

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
      todayTaskId: todayEntry?.taskId ?? null,
      todayCompleted,
      loggedAt: todayEntry?.completedAt
        ? `${String(todayEntry.completedAt.getUTCHours()).padStart(2, "0")}:${String(
            todayEntry.completedAt.getUTCMinutes(),
          ).padStart(2, "0")}`
        : null,
      scheduledToday: days.includes(todayStr),
      runDays,
      dots,
    };
  });
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

  const dueAt = new Date(`${todayStr}T00:00:00.000Z`);
  const [existing] = await db
    .select({ id: tasks.id, completedAt: tasks.completedAt })
    .from(tasks)
    .where(
      and(
        eq(tasks.ownerId, ownerId),
        eq(tasks.recurringTaskId, ruleId),
        eq(tasks.dueAt, dueAt),
      ),
    )
    .limit(1);

  if (existing) {
    const completed = existing.completedAt === null;
    await db
      .update(tasks)
      .set({ completedAt: completed ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(tasks.id, existing.id), eq(tasks.ownerId, ownerId)));
    return { completed };
  }

  await db.insert(tasks).values({
    ownerId,
    title: rule.title,
    dueAt,
    remindAtLocal: rule.remindAt,
    recurringTaskId: ruleId,
    completedAt: new Date(),
  });
  return { completed: true };
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
