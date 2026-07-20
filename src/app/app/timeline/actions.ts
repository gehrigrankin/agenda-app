"use server";

import { auth } from "@clerk/nextjs/server";

import {
  countStaleBlocks,
  listBlocksForDay,
  placeBlock,
  removeBlock,
  rollForwardBlocks,
  type DayBlock,
} from "@/server/blocks";
import { listDayEvents, type DayEvent } from "@/server/calendar";
import { listEventsForRange } from "@/server/events";

/**
 * Server actions for the timeline planner (design 15d). Same contract as
 * ../actions.ts: Clerk auth, owner-scoped repo calls, client-supplied local
 * dates + day bounds validated here, plain-serializable returns.
 */

async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  return userId;
}

const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface TimelineResult {
  blocks: DayBlock[];
  events: DayEvent[];
  calendarConfigured: boolean;
  /** Unfinished blocks from earlier days waiting to roll forward. */
  staleCount: number;
}

/**
 * The day's plan: task blocks + read-only calendar events. `dayStartIso`/
 * `dayEndIso` are the client local day's absolute bounds (calendar events are
 * real instants). On today, unfinished blocks from the previous day are rolled
 * forward first so they land in today's plan automatically.
 */
export async function getTimelineAction(
  dateStr: string,
  dayStartIso: string,
  dayEndIso: string,
  prevDateStr: string | null,
): Promise<TimelineResult> {
  const userId = await requireUserId();
  if (!DATE_STR_RE.test(dateStr)) throw new Error("Invalid date");
  if (prevDateStr) {
    if (!DATE_STR_RE.test(prevDateStr)) throw new Error("Invalid date");
    // Idempotent: the (task, day) unique index means this no-ops once done.
    await rollForwardBlocks(userId, prevDateStr, dateStr);
  }
  const [blocks, events, userEvents, staleCount] = await Promise.all([
    listBlocksForDay(userId, dateStr),
    listDayEvents(userId, dayStartIso, dayEndIso),
    listEventsForRange(userId, dateStr, dateStr),
    countStaleBlocks(userId, dateStr),
  ]);
  // User-created events (calendar quick-add) join the ICS feed's events on the
  // timeline. All-day ones (no start time) are skipped — the timeline lays out
  // by clock position. Local minutes → instants via the client's day start.
  const dayStartMs = new Date(dayStartIso).getTime();
  const merged: DayEvent[] = [
    ...events.events,
    ...userEvents
      .filter((e) => e.startMin !== null)
      .map((e) => ({
        uid: `user-event:${e.id}`,
        title: e.title,
        startIso: new Date(dayStartMs + e.startMin! * 60_000).toISOString(),
        endIso:
          e.endMin === null
            ? null
            : new Date(dayStartMs + e.endMin * 60_000).toISOString(),
      })),
  ].sort((a, b) => a.startIso.localeCompare(b.startIso));
  return {
    blocks,
    events: merged,
    calendarConfigured: events.configured,
    staleCount,
  };
}

export async function scheduleBlockAction(
  taskId: string,
  dateStr: string,
  startMin: number,
  endMin: number,
): Promise<DayBlock | null> {
  const userId = await requireUserId();
  if (!DATE_STR_RE.test(dateStr)) throw new Error("Invalid date");
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) {
    throw new Error("Invalid time");
  }
  return placeBlock(userId, taskId, dateStr, startMin, endMin);
}

export async function unscheduleBlockAction(id: string): Promise<void> {
  const userId = await requireUserId();
  await removeBlock(userId, id);
}
