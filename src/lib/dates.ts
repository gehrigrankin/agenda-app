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
