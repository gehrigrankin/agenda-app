import "server-only";

import { and, desc, eq, ilike, isNotNull, isNull, ne } from "drizzle-orm";

import { db } from "@/db";
import { notes } from "@/db/schema";
import { addDays, DATE_STR_RE, parseLocalDate } from "@/lib/dates";
import {
  occursOnDay,
  occurrenceTimesOnDay,
  parseIcs,
  type IcsEvent,
} from "@/lib/ics";
import { listDeclinedEventUids } from "@/server/meetings";
import { escapeLikePattern } from "@/server/notes";
import { listOpenTasksForNote } from "@/server/tasks";
import { getSettings } from "@/server/settings";

/**
 * Meeting mode (design 14c): read the user's calendar via an ICS subscription
 * URL (Google/Apple "secret address" — stored in user_settings) and offer a
 * scaffold in the daily note for meetings happening today. Read-only: we never
 * write to the calendar.
 */

export interface MeetingAttendee {
  name: string | null;
  email: string | null;
}

export interface TodayMeeting {
  /** Stable id used for declines (the event's UID). */
  uid: string;
  title: string;
  startIso: string;
  endIso: string | null;
  attendees: MeetingAttendee[];
  /** Open tasks from the most recent past note that covered this meeting. */
  openItems: { taskId: string; title: string }[];
  /** YYYY-MM-DD of that past note's day, when found. */
  lastMetDate: string | null;
}

export interface TodayMeetingsResult {
  configured: boolean;
  meetings: TodayMeeting[];
}

const MAX_MEETINGS = 4;
const FETCH_TIMEOUT_MS = 8000;
/** Cap on how many local days `listEventsForRange` will expand over — a
 * generous window for a month-ish calendar view without letting a bad range
 * (or a degenerate multi-day all-day event within it) walk unboundedly. */
const MAX_RANGE_DAYS = 60;

/**
 * Fetch + parse the user's ICS feed. Shared by every reader below so the
 * fetch/cache/error-handling policy (8s timeout, 300s Next cache, swallow
 * failures) lives in one place. Returns null on any failure (network, bad
 * status, timeout) — callers treat that as "feed configured but unreachable
 * right now", same as an empty result.
 */
async function fetchCalendarFeed(icsUrl: string): Promise<IcsEvent[] | null> {
  try {
    const res = await fetch(icsUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      // The feed changes rarely; let Next cache it briefly across requests.
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return parseIcs(await res.text());
  } catch (err) {
    console.warn("[calendar] ICS fetch failed:", err);
    return null;
  }
}

export async function listTodayMeetings(
  ownerId: string,
  dayStartIso: string,
  dayEndIso: string,
  todayNoteId: string | null,
): Promise<TodayMeetingsResult> {
  const settings = await getSettings(ownerId);
  if (!settings.calendarIcsUrl) return { configured: false, meetings: [] };

  const events = await fetchCalendarFeed(settings.calendarIcsUrl);
  if (events === null) return { configured: true, meetings: [] };

  const dayStart = new Date(dayStartIso);
  const dayEnd = new Date(dayEndIso);
  const declined = new Set(await listDeclinedEventUids(ownerId));

  const meetings: TodayMeeting[] = [];
  for (const event of events) {
    if (meetings.length >= MAX_MEETINGS) break;
    // Deliberately excluded, not a bug: this scaffold formats a clock time
    // ("2:00 – 2:30 PM · from calendar") and offers a heading built from
    // startIso (MeetingModeCard.tsx), which only makes sense for a timed
    // meeting. All-day events surface instead via listEventsForRange/
    // listDayEvents for the merged calendar and timeline views.
    if (event.allDay) continue;
    if (!event.title.trim()) continue;
    if (declined.has(event.uid)) continue;
    if (!occursOnDay(event, dayStart, dayEnd)) continue;
    const times = event.recurring
      ? occurrenceTimesOnDay(event, dayStart)
      : { start: event.start, end: event.end };
    const past = await findLastMeetingNote(ownerId, event.title, todayNoteId);
    meetings.push({
      uid: event.uid,
      title: event.title,
      startIso: times.start.toISOString(),
      endIso: times.end ? times.end.toISOString() : null,
      attendees: event.attendees,
      openItems: past
        ? (await listOpenTasksForNote(ownerId, past.id)).map((t) => ({
            taskId: t.id,
            title: t.title,
          }))
        : [],
      lastMetDate: past?.day ?? null,
    });
  }
  meetings.sort((a, b) => a.startIso.localeCompare(b.startIso));
  return { configured: true, meetings };
}

export interface DayEvent {
  uid: string;
  title: string;
  /** Real instant for timed events. For an all-day event this is just local
   * midnight of the covered day — a placeholder so the field can stay a
   * required string; consumers must check `allDay` before treating it as a
   * clock time. */
  startIso: string;
  endIso: string | null;
  allDay: boolean;
}

/**
 * Calendar events overlapping a local day — the read-only background the
 * timeline planner (design 15d) lays task blocks around. Unlike
 * listTodayMeetings this keeps ALL events (not just recurring meetings with
 * attendees) and does no note-matching; it's just the day's shape. All-day
 * events ARE included (tagged `allDay: true`, no real start/end time) rather
 * than dropped — callers that only want a clock-positioned schedule (the
 * timeline drawer, via timeline/actions.ts) filter them back out themselves.
 */
export async function listDayEvents(
  ownerId: string,
  dayStartIso: string,
  dayEndIso: string,
): Promise<{ configured: boolean; events: DayEvent[] }> {
  const settings = await getSettings(ownerId);
  if (!settings.calendarIcsUrl) return { configured: false, events: [] };

  const events = await fetchCalendarFeed(settings.calendarIcsUrl);
  if (events === null) return { configured: true, events: [] };

  const dayStart = new Date(dayStartIso);
  const dayEnd = new Date(dayEndIso);
  const out: DayEvent[] = [];
  for (const event of events) {
    if (!event.title.trim()) continue;
    if (!occursOnDay(event, dayStart, dayEnd)) continue;
    if (event.allDay) {
      out.push({
        uid: event.uid,
        title: event.title,
        startIso: dayStart.toISOString(),
        endIso: null,
        allDay: true,
      });
      if (out.length >= 20) break;
      continue;
    }
    const times = event.recurring
      ? occurrenceTimesOnDay(event, dayStart)
      : { start: event.start, end: event.end };
    out.push({
      uid: event.uid,
      title: event.title,
      startIso: times.start.toISOString(),
      endIso: times.end ? times.end.toISOString() : null,
      allDay: false,
    });
    if (out.length >= 20) break;
  }
  out.sort((a, b) => a.startIso.localeCompare(b.startIso));
  return { configured: true, events: out };
}

export interface RangeCalendarEvent {
  uid: string;
  /** Local YYYY-MM-DD this occurrence falls on — a multi-day all-day event
   * appears once per covered day, each with its own entry. */
  date: string;
  title: string;
  /** Null for all-day events; a real instant for timed ones. */
  startIso: string | null;
  endIso: string | null;
  allDay: boolean;
}

/**
 * ICS events across an inclusive local-date range (`startStr`..`endStr`,
 * YYYY-MM-DD) — what the merged calendar view (/app/calendar) overlays
 * alongside quick-add events (server/events.ts) and tasks. Unlike
 * listDayEvents this is date-range-shaped, not day-bounds-shaped, and keeps
 * all-day events as first-class entries (no filtering) since a month/week
 * grid has a natural place to render them. Range is capped at
 * MAX_RANGE_DAYS days so a multi-day (or open-ended) all-day event can't
 * expand unboundedly; the same cap bounds the query range itself.
 */
export async function listEventsForRange(
  ownerId: string,
  startStr: string,
  endStr: string,
): Promise<{ configured: boolean; events: RangeCalendarEvent[] }> {
  if (!DATE_STR_RE.test(startStr) || !DATE_STR_RE.test(endStr)) {
    throw new Error("Invalid date");
  }
  const settings = await getSettings(ownerId);
  if (!settings.calendarIcsUrl) return { configured: false, events: [] };

  const events = await fetchCalendarFeed(settings.calendarIcsUrl);
  if (events === null) return { configured: true, events: [] };

  const rangeStart = parseLocalDate(startStr);
  const requestedEnd = parseLocalDate(endStr);
  const cappedEndStr = addDays(startStr, MAX_RANGE_DAYS - 1);
  const cappedEnd = parseLocalDate(cappedEndStr);
  const rangeEnd = requestedEnd < cappedEnd ? requestedEnd : cappedEnd;

  const out: RangeCalendarEvent[] = [];
  for (
    let day = new Date(rangeStart);
    day <= rangeEnd;
    day.setDate(day.getDate() + 1)
  ) {
    const dayStart = new Date(day);
    const dayEnd = new Date(day);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const dateStr = `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, "0")}-${String(dayStart.getDate()).padStart(2, "0")}`;

    for (const event of events) {
      if (!event.title.trim()) continue;
      if (!occursOnDay(event, dayStart, dayEnd)) continue;
      if (event.allDay) {
        out.push({
          uid: event.uid,
          date: dateStr,
          title: event.title,
          startIso: null,
          endIso: null,
          allDay: true,
        });
        continue;
      }
      const times = event.recurring
        ? occurrenceTimesOnDay(event, dayStart)
        : { start: event.start, end: event.end };
      out.push({
        uid: event.uid,
        date: dateStr,
        title: event.title,
        startIso: times.start.toISOString(),
        endIso: times.end ? times.end.toISOString() : null,
        allDay: false,
      });
    }
  }
  out.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return (a.startIso ?? "").localeCompare(b.startIso ?? "");
  });
  return { configured: true, events: out };
}

/**
 * The most recent past note mentioning this meeting's title — where last
 * time's open items live. Content match over the plain-text mirror.
 */
async function findLastMeetingNote(
  ownerId: string,
  title: string,
  excludeNoteId: string | null,
): Promise<{ id: string; day: string | null } | null> {
  const trimmed = title.trim();
  if (trimmed.length < 3) return null;
  const conditions = [
    eq(notes.ownerId, ownerId),
    isNull(notes.deletedAt),
    isNotNull(notes.textContent),
    ilike(notes.textContent, `%${escapeLikePattern(trimmed)}%`),
  ];
  if (excludeNoteId) conditions.push(ne(notes.id, excludeNoteId));
  const [row] = await db
    .select({
      id: notes.id,
      dailyDate: notes.dailyDate,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .where(and(...conditions))
    .orderBy(desc(notes.updatedAt))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    day: row.dailyDate ? row.dailyDate.toISOString().slice(0, 10) : null,
  };
}
