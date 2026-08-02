import { NextResponse } from "next/server";

import { isDbConfigured } from "@/db";
import { formatTimeShort, nextOccurrence } from "@/lib/recurrence";
import {
  isPushConfigured,
  listOwnersWithSubscriptions,
  sendToOwner,
} from "@/server/push";
import {
  findDueTaskReminders,
  findHabitReminderCandidates,
  listTimezonesForOwners,
  markHabitReminded,
  markTaskReminded,
} from "@/server/reminders";

/**
 * Reminder scheduler, hit by Vercel cron every 5 minutes (see vercel.json).
 *
 * For each owner with at least one push subscription AND a stored IANA
 * timezone (captured by the Settings row), compute their local date + the
 * trailing 5-minute window of "HH:MM" values and push:
 *   - open tasks due today with remindAtLocal in the window  → "Task: <title>"
 *   - habit rules (isHabit) with remindAt in the window whose schedule has an
 *     occurrence today                                       → "Habit: <title>"
 * Dedupe: tasks.remindedAt (once per task) and
 * recurring_tasks.lastRemindedDate (once per rule per local day).
 *
 * Auth: Vercel sends `Authorization: Bearer $CRON_SECRET` on cron requests.
 * Local/manual trigger (cron never runs in dev): the same GET also accepts
 * the secret as a query param —
 *   curl "http://localhost:3000/api/cron/reminders?secret=$CRON_SECRET"
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MINUTES = 5; // must match the vercel.json cron cadence

/** An instant rendered in an IANA zone as local YYYY-MM-DD + HH:MM. */
function localParts(
  instant: Date,
  timeZone: string,
): { date: string; hhmm: string } | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(instant)) parts[p.type] = p.value;
    // Some ICU versions render midnight as "24" with hour12:false.
    const hour = parts.hour === "24" ? "00" : parts.hour;
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      hhmm: `${hour}:${parts.minute}`,
    };
  } catch {
    return null; // bad/unknown timezone string — skip this owner
  }
}

/**
 * The trailing window as local "HH:MM" values grouped by local date (the
 * window can straddle midnight). Trailing so a cron tick at :05 covers
 * reminder times :01–:05 — each wall-clock minute lands in exactly one tick.
 */
function windowByDate(now: Date, timeZone: string): Map<string, string[]> {
  const byDate = new Map<string, string[]>();
  for (let i = 0; i < WINDOW_MINUTES; i++) {
    const p = localParts(new Date(now.getTime() - i * 60_000), timeZone);
    if (!p) return new Map();
    const list = byDate.get(p.date) ?? [];
    if (!list.includes(p.hhmm)) list.push(p.hhmm);
    byDate.set(p.date, list);
  }
  return byDate;
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not set" }, { status: 503 });
  }
  const url = new URL(req.url);
  const provided =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    url.searchParams.get("secret");
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isDbConfigured || !isPushConfigured) {
    return NextResponse.json({
      skipped: !isDbConfigured ? "db not configured" : "push not configured",
    });
  }

  const now = new Date();
  const owners = await listOwnersWithSubscriptions();
  const timezones = await listTimezonesForOwners(owners);

  let taskPushes = 0;
  let habitPushes = 0;

  for (const ownerId of owners) {
    const tz = timezones.get(ownerId);
    if (!tz) continue; // no timezone captured yet — can't place the wall clock

    for (const [localDate, times] of windowByDate(now, tz)) {
      // --- task reminders ---------------------------------------------------
      const due = await findDueTaskReminders(ownerId, localDate, times);
      for (const task of due) {
        await sendToOwner(ownerId, {
          title: `Task: ${task.title}`,
          body: task.remindAtLocal
            ? `Due today · ${formatTimeShort(task.remindAtLocal)}`
            : "Due today",
          url: "/app",
          tag: `task-${task.id}`,
        });
        await markTaskReminded(ownerId, task.id);
        taskPushes += 1;
      }

      // --- habit reminders --------------------------------------------------
      // Schedule check via nextOccurrence(...) === today — NOT dueOccurrence:
      // that walks from `lastDate`, which is the materializer's atomic claim
      // (touching it would fight occurrence creation), and it also returns
      // carried-over PAST occurrences, which a wall-clock reminder must not
      // fire for. lastRemindedDate is this route's own dedupe instead.
      const candidates = await findHabitReminderCandidates(
        ownerId,
        localDate,
        times,
      );
      for (const rule of candidates) {
        const spec = {
          freq: rule.freq,
          weekday: rule.weekday,
          intervalDays: rule.intervalDays,
          monthDay: rule.monthDay,
          remindAt: rule.remindAt,
        };
        if (nextOccurrence(spec, rule.anchorDate, localDate) !== localDate) {
          continue; // not an occurrence day for this habit
        }
        await sendToOwner(ownerId, {
          title: `Habit: ${rule.title}`,
          body: rule.remindAt
            ? `Today · ${formatTimeShort(rule.remindAt)}`
            : "Today",
          url: "/app/habits",
          tag: `habit-${rule.id}`,
        });
        await markHabitReminded(ownerId, rule.id, localDate);
        habitPushes += 1;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    owners: owners.length,
    taskPushes,
    habitPushes,
  });
}
