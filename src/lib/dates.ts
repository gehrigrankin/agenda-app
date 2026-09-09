/**
 * Date helpers shared across the daily surfaces. All `dateStr` values are the
 * USER'S LOCAL calendar day as YYYY-MM-DD — the client computes them, because
 * the server can never know the user's timezone.
 */

export const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;

export function localDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parse YYYY-MM-DD as a LOCAL date (local midnight). */
export function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** dateStr ± n days, in local calendar space. */
export function addDays(dateStr: string, n: number): string {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() + n);
  return localDateString(d);
}

/** "Sunday, July 6" */
export function formatLongDate(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** "Sat, Jul 5" */
export function formatShortDate(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * "Today" for the local calendar day (compared against the caller-supplied
 * `todayStr`, since only the client knows its own local day), else a short
 * date — "Tue, Jul 8" with `weekday: true`, "Jul 8" without — with the year
 * appended when it isn't the current one. Shared by the People "last seen"
 * and Threads "mentioned" date labels, which are identical apart from the
 * weekday.
 */
export function formatTodayElseDate(
  iso: string,
  todayStr: string | null,
  opts: { weekday?: boolean } = {},
): string {
  const d = new Date(iso);
  if (todayStr && localDateString(d) === todayStr) return "Today";
  const options: Intl.DateTimeFormatOptions = opts.weekday
    ? { weekday: "short", month: "short", day: "numeric" }
    : { month: "short", day: "numeric" };
  if (d.getFullYear() !== new Date().getFullYear()) options.year = "numeric";
  return d.toLocaleDateString("en-US", options);
}

/**
 * Format a YYYY-MM-DD `dateStr` using the Date.UTC + `timeZone: "UTC"` trick:
 * build the Date at UTC midnight for those exact y/m/d parts, then format
 * with an explicit UTC timezone so the *server's* local TZ/locale never
 * shifts the calendar day. Used for the daily-note title and its palette
 * label, which need the same y/m/d the caller already has in hand (as
 * opposed to `formatShortDate`/`formatLongDate` above, which parse a
 * *local*-midnight Date via `parseLocalDate`).
 */
export function formatUtcDate(
  dateStr: string,
  opts: Intl.DateTimeFormatOptions,
): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    ...opts,
    timeZone: "UTC",
  });
}

/** The local day's absolute instant bounds [start, end). */
export function localDayBounds(dateStr: string): { start: Date; end: Date } {
  const start = parseLocalDate(dateStr);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/**
 * Monday of the week containing `dateStr` (local calendar). The agenda's week
 * runs Mon–Sun, so a Sunday belongs to the PRECEDING Monday's week — it closes
 * that week rather than opening the next one.
 */
export function startOfWeek(dateStr: string): string {
  // getDay() is 0=Sun..6=Sat; shift so Monday is 0 and Sunday is 6.
  const mondayOffset = (parseLocalDate(dateStr).getDay() + 6) % 7;
  return addDays(dateStr, -mondayOffset);
}

/** The 7 local days Mon..Sun of the week starting at the Monday `startStr`. */
export function weekDays(startStr: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(startStr, i));
}

/**
 * ISO-8601 week number (1..53): weeks run Mon–Sun and week 1 is the one
 * containing the year's first Thursday — so Jan 1 can sit in week 52/53 of the
 * previous year, and Dec 29-31 in week 1 of the next. Done in UTC space
 * (Date.UTC + getUTC*) so a DST jump inside the week can't skew the day
 * arithmetic by an hour and round to the neighbouring week.
 */
export function isoWeekNumber(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  // Step to this week's Thursday: it alone decides which ISO year the week
  // belongs to.
  const thursday = new Date(Date.UTC(y, m - 1, d));
  thursday.setUTCDate(thursday.getUTCDate() - ((thursday.getUTCDay() + 6) % 7) + 3);
  const isoYear = thursday.getUTCFullYear();
  // Jan 4 is always in week 1; back up to its Monday to get week 1's start.
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const week1Monday = Date.UTC(isoYear, 0, 4 - ((jan4.getUTCDay() + 6) % 7));
  return 1 + Math.round((thursday.getTime() - week1Monday) / (7 * 86400000));
}

/**
 * Range label for the week starting at `startStr`: "Sep 7 – 13" inside one
 * month, "Sep 28 – Oct 4" across two, "Dec 29, 2025 – Jan 4, 2026" across two
 * years. The year is printed on BOTH ends or neither — one bare end next to a
 * dated one reads as a typo.
 */
export function formatWeekRange(startStr: string): string {
  const endStr = addDays(startStr, 6);
  const start = parseLocalDate(startStr);
  const end = parseLocalDate(endStr);
  const monthDay: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

  if (start.getFullYear() !== end.getFullYear()) {
    const withYear: Intl.DateTimeFormatOptions = { ...monthDay, year: "numeric" };
    return `${start.toLocaleDateString("en-US", withYear)} – ${end.toLocaleDateString("en-US", withYear)}`;
  }
  const from = start.toLocaleDateString("en-US", monthDay);
  const to =
    start.getMonth() === end.getMonth()
      ? String(end.getDate())
      : end.toLocaleDateString("en-US", monthDay);
  return `${from} – ${to}`;
}
