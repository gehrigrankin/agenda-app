"use server";

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

import { requireOwnerId } from "../owner";

/**
 * Server actions for the timeline planner (design 15d). Same contract as
 * ../actions.ts: Clerk auth, owner-scoped repo calls, client-supplied local
 * dates + day bounds validated here, plain-serializable returns.
 */

const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A calendar event as the timeline renders it. ICS events are true instants —
 * `startIso`/`endIso` are the truth. User quick-add events store wall-clock
 * minutes-from-local-midnight, so the original minutes ride along here: on
 * DST-transition days elapsed-ms-from-midnight ≠ wall-clock, and rebuilding
 * minutes from the ISO instant would drift those events an hour against task
 * blocks (which also store minutes).
 */
export interface TimelineEvent extends DayEvent {
  /** Wall-clock minutes from local midnight — user-created events only. */
  startMin?: number;
  endMin?: number;
}

export interface TimelineResult {
  blocks: DayBlock[];
  events: TimelineEvent[];
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
  const userId = await requireOwnerId();
  if (!DATE_STR_RE.test(dateStr)) throw new Error("Invalid date");
  // `prevDateStr` used to be trusted as the exact day to roll blocks forward
  // from (always "yesterday" — see DayTimeline.tsx), which silently lost a
  // day's plan whenever the timeline was first opened after a skipped
  // weekend: Sunday has nothing on it, so nothing rolled forward. Its
  // presence still opt-in-gates roll-forward (the timeline only ever passes
  // it when it has a notion of "today"), but the actual lookback window is
  // now derived server-side (rollForwardBlocks looks back up to 7 days on
  // its own) instead of trusting the client's single guess.
  if (prevDateStr) {
    if (!DATE_STR_RE.test(prevDateStr)) throw new Error("Invalid date");
    // Idempotent: the (task, day) unique index means this no-ops once done.
    await rollForwardBlocks(userId, dateStr);
  }
  const [blocks, events, userEvents, staleCount] = await Promise.all([
    listBlocksForDay(userId, dateStr),
    listDayEvents(userId, dayStartIso, dayEndIso),
    listEventsForRange(userId, dateStr, dateStr),
    countStaleBlocks(userId, dateStr),
  ]);
  // User-created events (calendar quick-add) join the ICS feed's events on the
  // timeline. All-day ones (no start time, or `allDay` from the ICS feed) are
  // skipped — the timeline lays out by clock position only; all-day events
  // surface instead in the merged /app/calendar view. Local minutes →
  // instants via the client's day start.
  const dayStartMs = new Date(dayStartIso).getTime();
  const merged: TimelineEvent[] = [
    ...events.events.filter((e) => !e.allDay),
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
        allDay: false as const,
        // The wall-clock minutes are the source of truth for placement; the
        // ISO fields above are kept for sorting and non-timeline consumers.
        startMin: e.startMin!,
        endMin: e.endMin ?? undefined,
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
  const userId = await requireOwnerId();
  if (!DATE_STR_RE.test(dateStr)) throw new Error("Invalid date");
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) {
    throw new Error("Invalid time");
  }
  return placeBlock(userId, taskId, dateStr, startMin, endMin);
}

export async function unscheduleBlockAction(id: string): Promise<void> {
  const userId = await requireOwnerId();
  await removeBlock(userId, id);
}
