"use client";

import Link from "next/link";

import { NOTES_TOOLS_HOST_ID } from "@/components/home/DailyNoteWidget";
import { minutesToHHMM } from "@/lib/agenda-lines";
import { addDays, parseLocalDate } from "@/lib/dates";
import { formatTimeShort } from "@/lib/recurrence";
import type { RangeCalendarEvent } from "@/server/calendar";
import type { UserEvent } from "@/server/events";

/**
 * The open page of the paper agenda: one day, printed rather than listed.
 *
 * The page is deliberately two things and no more — what is scheduled at the
 * top, and the day's note filling everything under it. Tasks used to be ruled
 * down the middle of this page; they now live in the rail's tasks widget,
 * grouped by the agenda's pinned lines, because the owner wanted the writing
 * surface unobstructed. The note is the point of the page again, so it takes
 * all the height the schedule doesn't.
 *
 * Today's page is a place to write; a past page is a RECORD — its notes label
 * reads "Notes · as written" and the whole page is set in quieter ink.
 *
 * The component is presentational: the parent owns week state and mounts the
 * daily editor into the notes slot.
 */

/** Section label — the one used across the home surfaces. */
const SECTION_LABEL =
  "text-[0.625rem] font-medium uppercase tracking-[0.0875rem] text-ink-600";

/** Horizontal rhythm of every band. The phone loses 4px because the ruled
 * grid's label column already eats a third of a narrow screen. */
const BAND_X = "px-4 md:px-5";

/** The right-hand "Calendar →" link on a section label row. */
const LABEL_LINK =
  "flex items-center gap-1 text-[0.65625rem] text-ink-400 hover:text-ink-300";

/* ------------------------------------------------------------------ header */

/** "Today" / "Yesterday" / "Tomorrow" / "Record" — where the page sits in
 * time, in one word. Future days past tomorrow get nothing: they are just
 * days, and a pill on each of them would say only "not now". */
function DayStatusPill({ dateStr, today }: { dateStr: string; today: string }) {
  if (dateStr === today) {
    return (
      <span className="flex-none rounded-full bg-sage/16 px-2 py-0.5 text-[0.625rem] font-medium text-sage">
        Today
      </span>
    );
  }
  if (dateStr === addDays(today, -1) || dateStr === addDays(today, 1)) {
    return (
      <span className="flex-none rounded-full bg-white/6 px-2 py-0.5 text-[0.625rem] font-medium text-ink-400">
        {dateStr < today ? "Yesterday" : "Tomorrow"}
      </span>
    );
  }
  if (dateStr < today) {
    return (
      <span className="flex-none text-[0.625rem] font-medium uppercase tracking-[0.0875rem] text-ink-600">
        Record
      </span>
    );
  }
  return null;
}

/* ---------------------------------------------------------------- schedule */

/** A schedule row, after user events and ICS occurrences are made one shape. */
type ScheduleRow = {
  key: string;
  title: string;
  allDay: boolean;
  /** Minutes since local midnight; null when all-day (sorts first). */
  startMin: number | null;
  /** "9 AM – 10 AM", or null when all-day. */
  time: string | null;
};

/** Local "HH:MM" of an instant — ICS carries instants, the band shows clock
 * time, and the clock that matters is the reader's. */
function isoHHMM(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

function timeRange(startHHMM: string, endHHMM: string | null): string {
  const start = formatTimeShort(startHHMM);
  return endHHMM ? `${start} – ${formatTimeShort(endHHMM)}` : start;
}

function scheduleRows(
  dateStr: string,
  events: UserEvent[],
  icsEvents: RangeCalendarEvent[],
): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  for (const event of events) {
    // A multi-day event's start time belongs to its first day only — printing
    // "9 AM" on day three of a trip is a lie the eye believes.
    const continuation =
      event.endLocalDate !== null && event.localDate !== dateStr;
    const start = continuation ? null : event.startMin;
    rows.push({
      key: `user:${event.id}`,
      title: event.title,
      allDay: start === null,
      startMin: start,
      time:
        start === null
          ? null
          : timeRange(
              minutesToHHMM(start),
              event.endMin === null || continuation
                ? null
                : minutesToHHMM(event.endMin),
            ),
    });
  }
  for (const event of icsEvents) {
    const startIso = event.startIso;
    const timed = !event.allDay && startIso !== null;
    const startHHMM = timed && startIso ? isoHHMM(startIso) : null;
    rows.push({
      key: `ics:${event.uid}:${event.date}`,
      title: event.title,
      allDay: !timed,
      startMin: startHHMM
        ? Number(startHHMM.slice(0, 2)) * 60 + Number(startHHMM.slice(3, 5))
        : null,
      time: startHHMM
        ? timeRange(startHHMM, event.endIso ? isoHHMM(event.endIso) : null)
        : null,
    });
  }
  // All-day first (they frame the whole page), then the clock.
  return rows.sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return (a.startMin ?? 0) - (b.startMin ?? 0);
  });
}

function ScheduleBand({
  dateStr,
  events,
  icsEvents,
}: {
  dateStr: string;
  events: UserEvent[];
  icsEvents: RangeCalendarEvent[];
}) {
  const rows = scheduleRows(dateStr, events, icsEvents);
  if (rows.length === 0) return null;
  return (
    <section className={`${BAND_X} flex-none pb-1 pt-3.5`}>
      <div className="flex items-center pb-1.5">
        <span className={SECTION_LABEL}>Schedule</span>
        <Link href="/app/calendar" className={`ml-auto ${LABEL_LINK}`}>
          Calendar →
        </Link>
      </div>
      <div className="flex flex-col">
        {rows.map((row) => (
          <div
            key={row.key}
            className="flex min-h-[1.75rem] max-md:min-h-11 items-center gap-2.5"
          >
            <span className="h-1.5 w-1.5 flex-none rounded-full bg-event" />
            {row.allDay ? (
              <span className="w-[6.5rem] flex-none text-[0.65625rem] text-ink-600">
                all day
              </span>
            ) : (
              <span className="w-[6.5rem] flex-none tabular-nums text-[0.6875rem] text-ink-400">
                {row.time}
              </span>
            )}
            <span className="min-w-0 flex-1 break-words text-[0.8125rem] text-ink-200 md:text-[0.78125rem]">
              {row.title}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- the page */

export function AgendaDay({
  dateStr,
  today,
  events,
  icsEvents,
  loading,
  notesSlot,
  hideHeader,
}: {
  dateStr: string;
  today: string;
  /** Quick-add events covering dateStr (parent already filtered by span). */
  events: UserEvent[];
  /** ICS occurrences on dateStr (parent already filtered). */
  icsEvents: RangeCalendarEvent[];
  loading: boolean;
  /** The daily note editor, rendered by the parent, shown as the Notes margin. */
  notesSlot: React.ReactNode;
  /** Phone hides the big header (the phone page header owns the date). */
  hideHeader?: boolean;
}): React.JSX.Element {
  const isPast = dateStr < today;
  const day = parseLocalDate(dateStr);

  return (
    <div
      data-agenda-day={dateStr}
      data-record={isPast ? "1" : undefined}
      className="flex min-h-0 flex-1 flex-col"
    >
      {!hideHeader && (
        <div className="flex flex-none items-center gap-2.5 border-b border-white/7 px-5 py-3">
          <span className="text-lg font-semibold text-ink-100">
            {day.toLocaleDateString("en-US", { weekday: "long" })}
          </span>
          <span className="min-w-0 truncate text-ink-500">
            {day.toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </span>
          <span className="ml-auto flex-none">
            <DayStatusPill dateStr={dateStr} today={today} />
          </span>
        </div>
      )}

      <div
        className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${
          isPast ? "text-ink-300" : ""
        }`}
      >
        {loading ? (
          <div className={`${BAND_X} flex-none pb-1 pt-3.5`}>
            <div className="h-3 w-2/5 animate-pulse rounded bg-white/6" />
          </div>
        ) : (
          <ScheduleBand
            dateStr={dateStr}
            events={events}
            icsEvents={icsEvents}
          />
        )}

        {/* The margin stays mounted through a day's load: the parent's editor
            lives in it, and remounting a document to show a spinner loses
            what is being typed. */}
        <div className={`${BAND_X} flex-none pt-5`}>
          <div className="flex items-center pb-1.5">
            <span className={SECTION_LABEL}>
              {isPast ? "Notes · as written" : "Notes"}
            </span>
            {/* The embedded daily editor portals its tool cluster (save chip,
                view toggles, voice, timeline, add block) in here — the label
                row is its header now. Rendered before the slot so the host
                exists by the time the editor mounts. */}
            <div
              id={NOTES_TOOLS_HOST_ID}
              className="ml-auto flex items-center gap-2"
            />
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col border-t border-white/7">
          {notesSlot}
        </div>
      </div>
    </div>
  );
}
