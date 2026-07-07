import "server-only";

import { and, desc, eq, ilike, isNotNull, isNull, ne } from "drizzle-orm";

import { db } from "@/db";
import { notes } from "@/db/schema";
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

export async function listTodayMeetings(
  ownerId: string,
  dayStartIso: string,
  dayEndIso: string,
  todayNoteId: string | null,
): Promise<TodayMeetingsResult> {
  const settings = await getSettings(ownerId);
  if (!settings.calendarIcsUrl) return { configured: false, meetings: [] };

  let events: IcsEvent[];
  try {
    const res = await fetch(settings.calendarIcsUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      // The feed changes rarely; let Next cache it briefly across requests.
      next: { revalidate: 300 },
    });
    if (!res.ok) return { configured: true, meetings: [] };
    events = parseIcs(await res.text());
  } catch (err) {
    console.warn("[calendar] ICS fetch failed:", err);
    return { configured: true, meetings: [] };
  }

  const dayStart = new Date(dayStartIso);
  const dayEnd = new Date(dayEndIso);
  const declined = new Set(await listDeclinedEventUids(ownerId));

  const meetings: TodayMeeting[] = [];
  for (const event of events) {
    if (meetings.length >= MAX_MEETINGS) break;
    if (event.allDay) continue; // scaffolds are for timed meetings
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
