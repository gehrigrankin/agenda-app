import { addDays } from "./dates";

export const DAY_WINDOW = 7;

/** Center, −1, +1, −2, +2 … so the likely next page is first in memory. */
export function windowDates(center: string): string[] {
  const out = [center];
  for (let i = 1; i <= DAY_WINDOW; i++) {
    out.push(addDays(center, -i), addDays(center, i));
  }
  return out;
}

/** Fill every requested date, representing absent rows as explicit nulls. */
export function dailyWindowValues<T>(
  dates: string[],
  rows: Array<{ date: string; note: T }>,
): Map<string, T | null> {
  const byDate = new Map(rows.map((row) => [row.date, row.note]));
  return new Map(dates.map((date) => [date, byDate.get(date) ?? null]));
}

/**
 * Day-flip cache write: keep the live document AND the revision the autosave
 * last persisted. Copying only `content` leaves `contentRevision` at whatever
 * was loaded, so the remounted editor CAS-saves with a stale token and 409s.
 */
export function applyDaySnapshot(
  existing: { content: unknown; contentRevision: number },
  content: unknown,
  contentRevision: number,
): void {
  existing.content = content;
  existing.contentRevision = contentRevision;
}
