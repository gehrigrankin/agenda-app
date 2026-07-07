/**
 * Minimal ICS (RFC 5545) parser — just enough for read-only Google/Apple
 * calendar subscription feeds to power meeting mode. Dependency-free and
 * defensive: malformed lines/blocks are skipped, never thrown.
 *
 * Pragmatic simplifications (documented, deliberate):
 * - `TZID=...` datetimes are treated as the SERVER'S local time (constructed
 *   via `new Date(y, m, d, h, mi, s)` with the timezone id ignored). Full
 *   VTIMEZONE handling isn't worth it for a personal agenda view.
 * - RRULE is not expanded. `occursOnDay` understands only FREQ=DAILY and
 *   FREQ=WEEKLY;BYDAY= (plus UNTIL); anything fancier only matches on the
 *   event's literal first occurrence.
 */

export interface IcsEvent {
  uid: string;
  title: string;
  start: Date;
  end: Date | null;
  allDay: boolean;
  attendees: { name: string | null; email: string | null }[];
  recurring: boolean;
  /** The raw RRULE value when present (e.g. "FREQ=WEEKLY;BYDAY=MO,WE"). */
  rrule: string | null;
}

/** Unfold RFC 5545 folded lines: a line starting with space/tab continues the
 * previous line (the leading whitespace char is dropped). */
function unfoldLines(text: string): string[] {
  const raw = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

interface IcsProperty {
  name: string;
  /** Raw param strings like "TZID=America/New_York" or 'CN="Jane Doe"'. */
  params: string[];
  value: string;
}

/** Split "NAME;PARAM=X;PARAM=Y:value" into its parts. Returns null for lines
 * that aren't property-shaped. Quoted param values may contain ; and :. */
function parseProperty(line: string): IcsProperty | null {
  let inQuotes = false;
  let colonIdx = -1;
  const semiIdxs: number[] = [];
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === ";") semiIdxs.push(i);
    else if (!inQuotes && ch === ":") {
      colonIdx = i;
      break;
    }
  }
  if (colonIdx <= 0) return null;
  const head = line.slice(0, colonIdx);
  const boundaries = [...semiIdxs, colonIdx];
  const name = line.slice(0, boundaries[0]).toUpperCase();
  if (!name) return null;
  const params: string[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    params.push(head.slice(boundaries[i] + 1, boundaries[i + 1]));
  }
  return { name, params, value: line.slice(colonIdx + 1) };
}

/** Unescape TEXT values per RFC 5545 (\\ \; \, \n). */
function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, ch: string) =>
    ch === "n" || ch === "N" ? "\n" : ch,
  );
}

/** Parse a DTSTART/DTEND value. Date-only values mean all-day (local
 * midnight); trailing Z means UTC; naked/TZID datetimes are local time. */
function parseIcsDate(
  params: string[],
  value: string,
): { date: Date; allDay: boolean } | null {
  const v = value.trim();
  const isDateOnly =
    params.some((p) => p.toUpperCase() === "VALUE=DATE") || /^\d{8}$/.test(v);
  if (isDateOnly) {
    const m = v.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) return null;
    const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(date.getTime()) ? null : { date, allDay: true };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
  const date = m[7]
    ? new Date(Date.UTC(y, mo - 1, d, h, mi, s))
    : new Date(y, mo - 1, d, h, mi, s);
  return isNaN(date.getTime()) ? null : { date, allDay: false };
}

function parseAttendee(prop: IcsProperty): {
  name: string | null;
  email: string | null;
} {
  let name: string | null = null;
  for (const param of prop.params) {
    const eq = param.indexOf("=");
    if (eq < 0) continue;
    if (param.slice(0, eq).trim().toUpperCase() !== "CN") continue;
    name = param.slice(eq + 1).replace(/^"|"$/g, "") || null;
  }
  const mailMatch = prop.value.match(/^mailto:(.+)$/i);
  return { name, email: mailMatch ? mailMatch[1].trim() || null : null };
}

export function parseIcs(text: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  if (typeof text !== "string" || text.length === 0) return events;

  let current: Partial<IcsEvent> & {
    attendees: IcsEvent["attendees"];
  } | null = null;

  for (const line of unfoldLines(text)) {
    const prop = parseProperty(line);
    if (!prop) continue;

    if (prop.name === "BEGIN" && prop.value.trim().toUpperCase() === "VEVENT") {
      current = { attendees: [] };
      continue;
    }
    if (prop.name === "END" && prop.value.trim().toUpperCase() === "VEVENT") {
      if (current?.start) {
        events.push({
          uid: current.uid ?? "",
          title: current.title ?? "",
          start: current.start,
          end: current.end ?? null,
          allDay: current.allDay ?? false,
          attendees: current.attendees,
          recurring: current.rrule != null,
          rrule: current.rrule ?? null,
        });
      }
      current = null;
      continue;
    }
    if (!current) continue;

    switch (prop.name) {
      case "UID":
        current.uid = prop.value.trim();
        break;
      case "SUMMARY":
        current.title = unescapeText(prop.value).trim();
        break;
      case "DTSTART": {
        const parsed = parseIcsDate(prop.params, prop.value);
        if (parsed) {
          current.start = parsed.date;
          current.allDay = parsed.allDay;
        }
        break;
      }
      case "DTEND": {
        const parsed = parseIcsDate(prop.params, prop.value);
        if (parsed) current.end = parsed.date;
        break;
      }
      case "ATTENDEE":
        current.attendees.push(parseAttendee(prop));
        break;
      case "RRULE":
        current.rrule = prop.value.trim() || null;
        break;
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Day matching
// ---------------------------------------------------------------------------

const BYDAY_TO_WEEKDAY: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Does a recurring event's RRULE put an occurrence on the local day
 * containing `dayStart`? Only FREQ=DAILY and FREQ=WEEKLY;BYDAY= (+ UNTIL)
 * are understood; unknown FREQs never match here. */
function rruleMatchesDay(event: IcsEvent, dayStart: Date): boolean {
  if (!event.rrule) return false;
  const parts = new Map<string, string>();
  for (const piece of event.rrule.split(";")) {
    const eq = piece.indexOf("=");
    if (eq > 0) parts.set(piece.slice(0, eq).toUpperCase(), piece.slice(eq + 1));
  }

  const day = startOfLocalDay(dayStart);
  if (day < startOfLocalDay(event.start)) return false;

  const until = parts.get("UNTIL");
  if (until) {
    const m = until.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/);
    if (m) {
      const untilDate = m[4]
        ? until.endsWith("Z")
          ? new Date(
              Date.UTC(
                Number(m[1]),
                Number(m[2]) - 1,
                Number(m[3]),
                Number(m[4]),
                Number(m[5]),
                Number(m[6]),
              ),
            )
          : new Date(
              Number(m[1]),
              Number(m[2]) - 1,
              Number(m[3]),
              Number(m[4]),
              Number(m[5]),
              Number(m[6]),
            )
        : new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (day > startOfLocalDay(untilDate)) return false;
    }
  }

  const freq = (parts.get("FREQ") ?? "").toUpperCase();
  if (freq === "DAILY") return true;
  if (freq === "WEEKLY") {
    const byday = parts.get("BYDAY");
    if (byday) {
      const weekdays = byday
        .split(",")
        // Strip ordinal prefixes like "2MO" defensively.
        .map((code) => BYDAY_TO_WEEKDAY[code.trim().toUpperCase().slice(-2)])
        .filter((n): n is number => n !== undefined);
      return weekdays.includes(day.getDay());
    }
    // No BYDAY: weekly on the start's weekday.
    return event.start.getDay() === day.getDay();
  }
  return false;
}

/**
 * True when the event has an occurrence within [dayStart, dayEnd). One-off
 * events overlap-test their literal [start, end) span (a null end is treated
 * as an instant); recurring events additionally match via their RRULE
 * pattern (see `rruleMatchesDay` for the supported subset).
 */
export function occursOnDay(
  event: IcsEvent,
  dayStart: Date,
  dayEnd: Date,
): boolean {
  const literalOverlap = event.end
    ? event.start < dayEnd && event.end > dayStart
    : event.start >= dayStart && event.start < dayEnd;
  if (literalOverlap) return true;
  if (event.recurring) return rruleMatchesDay(event, dayStart);
  return false;
}

/**
 * Concrete times for a (recurring) event's occurrence on `day`: the event's
 * original wall-clock start projected onto that local day, with the original
 * duration preserved for the end.
 */
export function occurrenceTimesOnDay(
  event: IcsEvent,
  day: Date,
): { start: Date; end: Date | null } {
  const start = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    event.start.getHours(),
    event.start.getMinutes(),
    event.start.getSeconds(),
  );
  const end = event.end
    ? new Date(start.getTime() + (event.end.getTime() - event.start.getTime()))
    : null;
  return { start, end };
}
