/**
 * Recurrence rules, shared by client and server. Everything here is pure
 * calendar math over the user's LOCAL day strings (YYYY-MM-DD) and wall-clock
 * times (HH:MM) — no Date-now, no timezones. Date arithmetic goes through UTC
 * so a date string means the same calendar day everywhere.
 */

export type RecurrenceFreq = "daily" | "weekly" | "interval" | "monthly";

export type RecurrenceSpec = {
  freq: RecurrenceFreq;
  /** 0=Sunday … 6=Saturday (freq "weekly"). */
  weekday: number | null;
  /** Every N days (freq "interval"). */
  intervalDays: number | null;
  /** 1–31, clamped to month length (freq "monthly"). */
  monthDay: number | null;
  /** Reminder wall-clock time "HH:MM", or null for none. */
  remindAt: string | null;
};

const WEEKDAYS_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// --- date-string helpers (UTC math on purpose; see header) ------------------

function toUtc(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDaysUtc(dateStr: string, n: number): string {
  const d = toUtc(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}

function diffDays(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

/** 0=Sunday … 6=Saturday for a local date string. */
export function weekdayOf(dateStr: string): number {
  return toUtc(dateStr).getUTCDay();
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** The rule's occurrence in the month containing `dateStr` (day clamped). */
function monthlyOccurrenceIn(dateStr: string, monthDay: number): string {
  const d = toUtc(dateStr);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = Math.min(monthDay, daysInMonth(y, m));
  return fromUtc(new Date(Date.UTC(y, m - 1, day)));
}

// --- occurrence math ---------------------------------------------------------

/**
 * First occurrence on or after `fromDate` for a rule anchored at `anchorDate`
 * (the local day the rule was created / rescheduled). Null only when the spec
 * is malformed.
 */
export function nextOccurrence(
  spec: RecurrenceSpec,
  anchorDate: string,
  fromDate: string,
): string | null {
  const start = fromDate > anchorDate ? fromDate : anchorDate;
  switch (spec.freq) {
    case "daily":
      return start;
    case "interval": {
      const n = spec.intervalDays;
      if (!n || n < 1) return null;
      const past = diffDays(anchorDate, start);
      const k = past <= 0 ? 0 : Math.ceil(past / n);
      return addDaysUtc(anchorDate, k * n);
    }
    case "weekly": {
      const wd = spec.weekday;
      if (wd === null || wd < 0 || wd > 6) return null;
      const shift = (wd - weekdayOf(start) + 7) % 7;
      return addDaysUtc(start, shift);
    }
    case "monthly": {
      const md = spec.monthDay;
      if (!md || md < 1 || md > 31) return null;
      const inMonth = monthlyOccurrenceIn(start, md);
      if (inMonth >= start) return inMonth;
      const nextMonth = addDaysUtc(monthlyOccurrenceIn(start, 28), 5);
      return monthlyOccurrenceIn(nextMonth, md);
    }
  }
}

/**
 * The most recent occurrence due on or before `todayStr` that is strictly
 * after `lastDate` (the last one already materialized) — or null when nothing
 * new is due. Skipping the backlog is deliberate: a rule that was unreachable
 * for two weeks yields ONE carried occurrence, not a flood.
 */
export function dueOccurrence(
  spec: RecurrenceSpec,
  anchorDate: string,
  lastDate: string | null,
  todayStr: string,
): string | null {
  const from = lastDate ? addDaysUtc(lastDate, 1) : anchorDate;
  let due: string | null = null;
  let cursor = from;
  // Bounded walk: at most ~31 steps for any freq before passing today.
  for (let i = 0; i < 400; i++) {
    const next = nextOccurrence(spec, anchorDate, cursor);
    if (!next || next > todayStr) break;
    due = next;
    cursor = addDaysUtc(next, 1);
  }
  return due;
}

// --- natural-language input --------------------------------------------------

const WEEKDAY_RE =
  /\bevery\s+(sun(?:day)?|mon(?:day)?|tues?(?:day)?|wed(?:nesday)?|thur?s?(?:day)?|fri(?:day)?|sat(?:urday)?)\b/i;
const WEEKDAY_PREFIXES = ["sun", "mon", "tu", "wed", "th", "fri", "sat"];

const TIME_RE = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(?:at\s+)?(\d{1,2}):(\d{2})\b/i;

/**
 * Parse a phrase like "review inbox every friday 4pm" into a title + spec.
 * Understood: "daily" / "every day", "every other day", "every N days",
 * "every N weeks", "every <weekday>", "weekly" / "every week" (weekday taken
 * from `todayStr`), "monthly" / "Nth of each month" / "every month on the
 * Nth". A time ("4pm", "9:30 am", "16:00") becomes the reminder. Returns null
 * when no recurrence phrase is found.
 */
export function parseRecurrenceInput(
  input: string,
  todayStr: string,
): { title: string; spec: RecurrenceSpec } | null {
  let rest = input.trim();
  if (!rest) return null;

  let remindAt: string | null = null;
  const time = rest.match(TIME_RE);
  if (time) {
    let h: number;
    let min: number;
    if (time[3]) {
      h = Number(time[1]);
      min = Number(time[2] ?? 0);
      if (time[3].toLowerCase() === "pm" && h !== 12) h += 12;
      if (time[3].toLowerCase() === "am" && h === 12) h = 0;
    } else {
      h = Number(time[4]);
      min = Number(time[5]);
    }
    if (h <= 23 && min <= 59) {
      remindAt = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
      rest = rest.replace(time[0], " ");
    }
  }

  let spec: RecurrenceSpec | null = null;
  const strip = (m: RegExpMatchArray) => {
    rest = rest.replace(m[0], " ");
  };

  let m: RegExpMatchArray | null;
  if ((m = rest.match(/\bevery\s+other\s+day\b/i))) {
    spec = { freq: "interval", weekday: null, intervalDays: 2, monthDay: null, remindAt };
    strip(m);
  } else if ((m = rest.match(/\bevery\s+(\d+)\s+days?\b/i))) {
    const n = Number(m[1]);
    if (n >= 1) {
      spec =
        n === 1
          ? { freq: "daily", weekday: null, intervalDays: null, monthDay: null, remindAt }
          : { freq: "interval", weekday: null, intervalDays: n, monthDay: null, remindAt };
      strip(m);
    }
  } else if ((m = rest.match(/\bevery\s+(\d+)\s+weeks?\b/i))) {
    const n = Number(m[1]);
    if (n >= 1) {
      spec =
        n === 1
          ? { freq: "weekly", weekday: weekdayOf(todayStr), intervalDays: null, monthDay: null, remindAt }
          : { freq: "interval", weekday: null, intervalDays: n * 7, monthDay: null, remindAt };
      strip(m);
    }
  } else if ((m = rest.match(WEEKDAY_RE))) {
    const word = m[1].toLowerCase();
    const weekday = WEEKDAY_PREFIXES.findIndex((p) => word.startsWith(p));
    spec = { freq: "weekly", weekday, intervalDays: null, monthDay: null, remindAt };
    strip(m);
  } else if ((m = rest.match(/\bevery\s+day\b|\bdaily\b/i))) {
    spec = { freq: "daily", weekday: null, intervalDays: null, monthDay: null, remindAt };
    strip(m);
  } else if ((m = rest.match(/\bevery\s+week\b|\bweekly\b/i))) {
    spec = { freq: "weekly", weekday: weekdayOf(todayStr), intervalDays: null, monthDay: null, remindAt };
    strip(m);
  } else if (
    (m = rest.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+of\s+(?:each|every|the)\s+month\b/i)) ||
    (m = rest.match(/\bevery\s+month\s+on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?\b/i))
  ) {
    const day = Number(m[1]);
    if (day >= 1 && day <= 31) {
      spec = { freq: "monthly", weekday: null, intervalDays: null, monthDay: day, remindAt };
      strip(m);
    }
  } else if ((m = rest.match(/\bmonthly\b/i))) {
    spec = { freq: "monthly", weekday: null, intervalDays: null, monthDay: Number(todayStr.slice(8, 10)), remindAt };
    strip(m);
  }

  if (!spec) return null;
  const title = rest
    .replace(/\s+/g, " ")
    .replace(/[\s,;:—–-]+$/g, "")
    .replace(/^[\s,;:—–-]+/g, "")
    .trim();
  if (!title) return null;
  return { title, spec };
}

// --- display -----------------------------------------------------------------

/** "3 PM" / "9:30 AM" from "HH:MM". */
export function formatTimeShort(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12} ${suffix}` : `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "9:00 AM" from "HH:MM" (always shows minutes — rule descriptions). */
export function formatTimeLong(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function ordinal(n: number): string {
  const rem10 = n % 10;
  const rem100 = n % 100;
  if (rem10 === 1 && rem100 !== 11) return `${n}st`;
  if (rem10 === 2 && rem100 !== 12) return `${n}nd`;
  if (rem10 === 3 && rem100 !== 13) return `${n}rd`;
  return `${n}th`;
}

/** The quiet chip next to a task: "Sun", "3d", "daily", "1st". */
export function recurrenceChipLabel(spec: RecurrenceSpec): string {
  switch (spec.freq) {
    case "daily":
      return "daily";
    case "weekly":
      return WEEKDAYS_SHORT[spec.weekday ?? 0];
    case "interval":
      return `${spec.intervalDays ?? 0}d`;
    case "monthly":
      return ordinal(spec.monthDay ?? 1);
  }
}

/** Rule-row schedule text: "Every Sunday", "Every 3 days", "1st of each month". */
export function describeSchedule(spec: RecurrenceSpec): string {
  switch (spec.freq) {
    case "daily":
      return "Every day";
    case "weekly":
      return `Every ${WEEKDAYS_LONG[spec.weekday ?? 0]}`;
    case "interval":
      return `Every ${spec.intervalDays} days`;
    case "monthly":
      return `${ordinal(spec.monthDay ?? 1)} of each month`;
  }
}

/** Round-trippable phrase for prefilling the edit input. */
export function toInputPhrase(title: string, spec: RecurrenceSpec): string {
  let phrase: string;
  switch (spec.freq) {
    case "daily":
      phrase = "every day";
      break;
    case "weekly":
      phrase = `every ${WEEKDAYS_LONG[spec.weekday ?? 0].toLowerCase()}`;
      break;
    case "interval":
      phrase = `every ${spec.intervalDays} days`;
      break;
    case "monthly":
      phrase = `${ordinal(spec.monthDay ?? 1)} of each month`;
      break;
  }
  const time = spec.remindAt ? ` ${formatTimeLong(spec.remindAt).toLowerCase().replace(" ", "")}` : "";
  return `${title} ${phrase}${time}`;
}
