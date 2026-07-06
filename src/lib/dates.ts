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

/** The local day's absolute instant bounds [start, end). */
export function localDayBounds(dateStr: string): { start: Date; end: Date } {
  const start = parseLocalDate(dateStr);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}
