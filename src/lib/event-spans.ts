/**
 * Multi-day events as SPANS, for the two calendar grids (the month grid on
 * /app/calendar and the home's MiniCalendar).
 *
 * Both feeds hand the client per-day rows — quick-add events carry an
 * inclusive `endLocalDate`, ICS events repeat once per covered day carrying
 * the same `spanStart`/`spanEnd` (server/calendar.ts). A grid that draws those
 * rows literally puts an identical chip (or dot) on every covered day, which
 * reads as N unrelated events. So: collapse them to one span per event here,
 * then ask this module, per cell, which spans cross it and whether THIS cell
 * holds a true end of the run. A cell in the middle of a span gets square
 * edges so the bar reads as continuing; a week boundary is a clip, not an end,
 * and so is also square.
 *
 * Pure and grid-agnostic on purpose — no dates math beyond string compare
 * (YYYY-MM-DD sorts lexicographically, which is the whole reason the app
 * stores local days as strings).
 */

export interface EventSpan {
  /** Stable react key / identity for dedupe across per-day rows. */
  key: string;
  title: string;
  /** Inclusive first and last local day (YYYY-MM-DD). */
  start: string;
  end: string;
}

export interface DaySpanSegment extends EventSpan {
  /** This cell holds the span's real first day — round the left edge. */
  isStart: boolean;
  /** …its real last day — round the right edge. */
  isEnd: boolean;
  /** Label the bar here: at the true start, or again after a week wrap. */
  showLabel: boolean;
}

/** Only events that actually cover more than one day are spans. */
export function toSpan(
  key: string,
  title: string,
  start: string,
  end: string | null,
): EventSpan | null {
  if (!end || end <= start) return null;
  return { key, title, start, end };
}

/** Dedupe spans that arrived once per covered day, keeping input order. */
export function dedupeSpans(spans: EventSpan[]): EventSpan[] {
  const seen = new Set<string>();
  const out: EventSpan[] = [];
  for (const s of spans) {
    if (seen.has(s.key)) continue;
    seen.add(s.key);
    out.push(s);
  }
  return out;
}

export function spanCoversDay(span: EventSpan, dateStr: string): boolean {
  return span.start <= dateStr && dateStr <= span.end;
}

/** Every day any span covers — the days whose event dot the bar replaces. */
export function daysCoveredBySpans(spans: EventSpan[]): (d: string) => boolean {
  return (d) => spans.some((s) => spanCoversDay(s, d));
}

/**
 * The bars to draw in one cell. `isRowStart` is the caller's week geometry
 * (the leftmost column of the week row), which only affects labelling — a
 * wrapped bar needs its title again, but it must NOT get a rounded edge there.
 */
export function spanSegmentsForDay(
  spans: EventSpan[],
  dateStr: string,
  isRowStart: boolean,
): DaySpanSegment[] {
  return spans
    .filter((s) => spanCoversDay(s, dateStr))
    .map((s) => ({
      ...s,
      isStart: s.start === dateStr,
      isEnd: s.end === dateStr,
      showLabel: s.start === dateStr || isRowStart,
    }));
}
