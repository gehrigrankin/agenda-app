import type { EventSpan } from "./ics";

/**
 * One row-segment of a multi-day event bar in a month grid: a span can wrap
 * across weeks, so it's split into one contiguous run of columns per grid
 * row (0-indexed week row, 0-indexed weekday column).
 */
export interface SpanSegment {
  uid: string;
  title: string;
  row: number;
  startCol: number;
  endCol: number;
  /** True on the segment covering the span's true first/last day, so only
   * the real ends of a multi-row bar get rounded caps. */
  roundStart: boolean;
  roundEnd: boolean;
}

/**
 * Lay an `EventSpan` out over a month grid of `firstWeekday` (the 0=Sun
 * weekday the 1st of the month falls on, i.e. `cells[firstWeekday]` is day
 * 1) into per-row column runs, for rendering as a continuous bar. `span`'s
 * dates are assumed to fall within the displayed month (callers query one
 * month at a time, so server-clipped spans always do).
 */
export function daySpanSegments(
  span: EventSpan,
  firstWeekday: number,
): SpanSegment[] {
  const startDay = Number(span.startDate.slice(8, 10));
  const endDay = Number(span.endDate.slice(8, 10));
  const segments: SpanSegment[] = [];
  for (let day = startDay; day <= endDay; day++) {
    const idx = firstWeekday + day - 1;
    const row = Math.floor(idx / 7);
    const col = idx % 7;
    const last = segments[segments.length - 1];
    if (last && last.row === row && last.endCol === col - 1) {
      last.endCol = col;
    } else {
      segments.push({
        uid: span.uid,
        title: span.title,
        row,
        startCol: col,
        endCol: col,
        roundStart: false,
        roundEnd: false,
      });
    }
  }
  if (segments.length > 0) {
    segments[0].roundStart = true;
    segments[segments.length - 1].roundEnd = true;
  }
  return segments;
}
