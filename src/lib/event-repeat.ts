/**
 * Repeating events. A repeating event is ONE `calendar_events` row (the
 * series) with a `repeat` rule; its occurrences are computed when a range is
 * read, never stored — unlike recurring tasks, an event has no per-day state
 * (nothing to tick off) worth a row each.
 *
 * Each occurrence reaches the client as its own UserEvent whose id is
 * `${seriesId}@${YYYY-MM-DD}` (`occurrenceId`), so lists keyed by id stay
 * unique and a write can tell which day was touched. Edits apply to the whole
 * series; deleting can drop just one day (`skip_dates`) or the series.
 *
 * Pure date math over local day strings (UTC arithmetic, like
 * recurrence.ts), so it is shared by server and client and unit-tested.
 */

export type EventRepeat =
  | "daily"
  | "weekdays"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "yearly";

export const EVENT_REPEATS: readonly EventRepeat[] = [
  "daily",
  "weekdays",
  "weekly",
  "biweekly",
  "monthly",
  "yearly",
];

export function isEventRepeat(v: unknown): v is EventRepeat {
  return typeof v === "string" && (EVENT_REPEATS as readonly string[]).includes(v);
}

function toUtc(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

function addDays(dateStr: string, n: number): string {
  const d = toUtc(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function diffDays(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

/** Does a series anchored on `anchor` have an occurrence starting `date`? */
export function repeatsOn(anchor: string, repeat: EventRepeat, date: string): boolean {
  if (date < anchor) return false;
  const d = toUtc(date);
  const a = toUtc(anchor);
  switch (repeat) {
    case "daily":
      return true;
    case "weekdays": {
      const dow = d.getUTCDay();
      return dow !== 0 && dow !== 6;
    }
    case "weekly":
      return diffDays(anchor, date) % 7 === 0;
    case "biweekly":
      return diffDays(anchor, date) % 14 === 0;
    case "monthly":
      // The 31st skips the months without one (no clamping to the 30th).
      return d.getUTCDate() === a.getUTCDate();
    case "yearly":
      return d.getUTCMonth() === a.getUTCMonth() && d.getUTCDate() === a.getUTCDate();
  }
}

/** The longest stretch expanded in one read — a guard, not a product limit. */
const MAX_RANGE_DAYS = 400;

/**
 * Start days of a series' occurrences whose span overlaps [rangeStart,
 * rangeEnd] (inclusive). `spanDays` is how many days past its start each
 * occurrence covers (0 for a single-day event). `until` is the last day an
 * occurrence may START on; `skip` lists start days deleted one at a time.
 */
export function occurrenceStarts(
  anchor: string,
  repeat: EventRepeat,
  rangeStart: string,
  rangeEnd: string,
  opts: { spanDays?: number; until?: string | null; skip?: readonly string[] | null } = {},
): string[] {
  const span = Math.max(0, opts.spanDays ?? 0);
  let from = addDays(rangeStart, -span);
  if (from < anchor) from = anchor;
  let to = rangeEnd;
  if (opts.until && opts.until < to) to = opts.until;
  if (to < from || diffDays(from, to) > MAX_RANGE_DAYS) return [];
  const skip = new Set(opts.skip ?? []);
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!skip.has(d) && repeatsOn(anchor, repeat, d)) out.push(d);
  }
  return out;
}

const SEP = "@";

export function occurrenceId(seriesId: string, date: string): string {
  return `${seriesId}${SEP}${date}`;
}

/** Split an event id into its series and, for an occurrence, its day. */
export function parseOccurrenceId(id: string): { seriesId: string; date: string | null } {
  const i = id.indexOf(SEP);
  if (i < 0) return { seriesId: id, date: null };
  return { seriesId: id.slice(0, i), date: id.slice(i + 1) };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}

/** "Every Tuesday", "Monthly on the 20th" — said against the series' first day. */
export function repeatLabel(repeat: EventRepeat, anchor: string): string {
  const d = toUtc(anchor);
  switch (repeat) {
    case "daily":
      return "Every day";
    case "weekdays":
      return "Every weekday";
    case "weekly":
      return `Every ${WEEKDAYS[d.getUTCDay()]}`;
    case "biweekly":
      return `Every other ${WEEKDAYS[d.getUTCDay()]}`;
    case "monthly":
      return `Monthly on the ${ordinal(d.getUTCDate())}`;
    case "yearly":
      return `Every ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  }
}

/** The repeat picker's short chip text. */
export const REPEAT_CHIP: Record<EventRepeat, string> = {
  daily: "Daily",
  weekdays: "Weekdays",
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  yearly: "Yearly",
};
