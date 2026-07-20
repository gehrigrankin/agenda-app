/**
 * Quick-event natural-language parsing for the agenda quick-add input. Pure
 * string → structured parse: no Date.now, no timezones — `today` is the user's
 * LOCAL calendar day (YYYY-MM-DD) and times are minutes from local midnight.
 * Recognized date/time phrases are stripped from the title; everything else
 * stays verbatim.
 *
 * Understood: "today" / "tonight" / "tomorrow" / "tmrw", weekday names
 * ("fri", "on fri", "next fri" — nearest occurrence on or after tomorrow,
 * "next" adds a week), explicit dates ("july 21st", "7/21", "7/21/2026" —
 * yearless dates in the past roll to next year), times ("3pm", "3:30pm",
 * "15:00", "noon", "midnight", and "at 4" with an am/pm heuristic), ranges
 * ("3-4pm", "3:30 to 5pm", en dash), and durations ("for 45 min", "for 1.5h").
 */

import { addDays, localDateString, parseLocalDate } from "./dates";

export interface QuickEventParse {
  /** Input minus the recognized date/time phrases, whitespace-collapsed. */
  title: string;
  /** YYYY-MM-DD, or null when the text contains no date phrase. */
  date: string | null;
  /** Minutes from local midnight, or null when no time phrase. */
  startMin: number | null;
  /** When startMin is set: explicit range/duration end, else startMin + 60. Null when startMin is null. */
  endMin: number | null;
}

const WEEKDAY_PREFIXES = ["sun", "mon", "tu", "wed", "th", "fri", "sat"];
const WEEKDAY_RE =
  /\b(?:on\s+)?(next\s+)?(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)\b,?/i;

const DATE_WORD_RE = /\b(?:on\s+)?(today|tonight|tomorrow|tmrw|tmr)\b,?/i;

const MONTH_PREFIXES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_DATE_RE =
  /\b(?:on\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b,?/i;

const NUMERIC_DATE_RE = /\b(?:on\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b,?/i;

// A range only counts when a meridiem appears somewhere or both sides are
// colon (24h) times — otherwise "review 3-4 items" would lose its numbers.
const RANGE_RE =
  /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b,?/i;

const TIME_MERIDIEM_RE = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b,?/i;
const TIME_24H_RE = /\b(?:at\s+)?(\d{1,2}):(\d{2})\b,?/i;
const NOON_MIDNIGHT_RE = /\b(?:at\s+)?(noon|midnight)\b,?/i;
// Bare hour needs the "at" so numbers inside titles are never eaten.
const BARE_HOUR_RE = /\bat\s+(\d{1,2})\b(?![:./])(?!\s*(?:am|pm)\b),?/i;

const DURATION_RE = /\bfor\s+(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?|m|h)\b,?/i;

/** Wall-clock pieces → minutes from local midnight, or null when out of range. */
function toMinutes(hourStr: string, minuteStr: string | undefined, meridiem: string | null): number | null {
  const h = Number(hourStr);
  const min = minuteStr === undefined ? 0 : Number(minuteStr);
  if (min > 59) return null;
  if (meridiem) {
    if (h < 1 || h > 12) return null;
    return ((h % 12) + (meridiem === "pm" ? 12 : 0)) * 60 + min;
  }
  // 24h form: requires explicit minutes (bare hours go through the heuristic).
  if (minuteStr === undefined || h > 23) return null;
  return h * 60 + min;
}

/** Y/M/D → YYYY-MM-DD, or null when the pieces don't name a real day. */
function ymd(year: number, month: number, day: number): string | null {
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return localDateString(d);
}

/** Month/day (+ optional year) → date string; yearless dates in the past roll forward a year. */
function resolveDate(month: number, day: number, year: number | null, today: string): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year !== null) return ymd(year, month, day);
  const thisYear = Number(today.slice(0, 4));
  const candidate = ymd(thisYear, month, day);
  if (candidate === null) return ymd(thisYear + 1, month, day); // e.g. Feb 29 ahead of a leap year
  return candidate < today ? ymd(thisYear + 1, month, day) : candidate;
}

/** `today` is the reference local date, YYYY-MM-DD. Returns null when no title remains. */
export function parseQuickEvent(raw: string, today: string): QuickEventParse | null {
  let rest = raw.trim();
  if (!rest) return null;

  let date: string | null = null;
  let startMin: number | null = null;
  let endMin: number | null = null;

  const strip = (m: RegExpMatchArray) => {
    rest = rest.replace(m[0], " ");
  };

  // --- times (range first so "3-4pm" isn't read as a lone "4pm") -------------

  let m = rest.match(RANGE_RE);
  if (m) {
    const merLeft = m[3]?.toLowerCase() ?? null;
    const merRight = m[6]?.toLowerCase() ?? null;
    if (merLeft || merRight || (m[2] !== undefined && m[5] !== undefined)) {
      // A meridiem on one side applies to the other side too.
      const start = toMinutes(m[1], m[2], merLeft ?? merRight);
      const end = toMinutes(m[4], m[5], merRight ?? merLeft);
      if (start !== null && end !== null) {
        startMin = start;
        endMin = end > start ? end : start + 60;
        strip(m);
      }
    }
  }

  if (startMin === null && (m = rest.match(TIME_MERIDIEM_RE))) {
    const t = toMinutes(m[1], m[2], m[3].toLowerCase());
    if (t !== null) {
      startMin = t;
      strip(m);
    }
  }
  if (startMin === null && (m = rest.match(TIME_24H_RE))) {
    const t = toMinutes(m[1], m[2], null);
    if (t !== null) {
      startMin = t;
      strip(m);
    }
  }
  if (startMin === null && (m = rest.match(NOON_MIDNIGHT_RE))) {
    startMin = m[1].toLowerCase() === "noon" ? 720 : 0;
    strip(m);
  }
  if (startMin === null && (m = rest.match(BARE_HOUR_RE))) {
    const h = Number(m[1]);
    if (h >= 1 && h <= 12) {
      // "at 3" heuristic: 1–7 → PM, 8–11 → AM, 12 → noon.
      startMin = h === 12 ? 720 : h <= 7 ? (h + 12) * 60 : h * 60;
      strip(m);
    }
  }

  // Durations always strip; they only produce an end when a start exists and
  // an explicit range didn't already set one.
  if ((m = rest.match(DURATION_RE))) {
    const qty = Number(m[1]);
    const mins = Math.round(m[2].toLowerCase().startsWith("h") ? qty * 60 : qty);
    if (mins > 0) {
      if (startMin !== null && endMin === null) endMin = startMin + mins;
      strip(m);
    }
  }

  // --- dates -----------------------------------------------------------------

  if ((m = rest.match(NUMERIC_DATE_RE))) {
    const yearStr = m[3];
    const year = yearStr === undefined ? null : yearStr.length === 2 ? 2000 + Number(yearStr) : Number(yearStr);
    const resolved = resolveDate(Number(m[1]), Number(m[2]), year, today);
    if (resolved !== null) {
      date = resolved;
      strip(m);
    }
  }
  if (date === null && (m = rest.match(MONTH_DATE_RE))) {
    const month = MONTH_PREFIXES.indexOf(m[1].toLowerCase().slice(0, 3)) + 1;
    const resolved = resolveDate(month, Number(m[2]), m[3] === undefined ? null : Number(m[3]), today);
    if (resolved !== null) {
      date = resolved;
      strip(m);
    }
  }
  if (date === null && (m = rest.match(DATE_WORD_RE))) {
    const word = m[1].toLowerCase();
    date = word === "today" || word === "tonight" ? today : addDays(today, 1);
    strip(m);
  }
  if (date === null && (m = rest.match(WEEKDAY_RE))) {
    const word = m[2].toLowerCase();
    const weekday = WEEKDAY_PREFIXES.findIndex((p) => word.startsWith(p));
    // Nearest occurrence on or after tomorrow; "next" pushes one week further.
    const base = addDays(today, 1);
    const shift = (weekday - parseLocalDate(base).getDay() + 7) % 7;
    date = addDays(base, shift + (m[1] ? 7 : 0));
    strip(m);
  }

  // --- title cleanup ---------------------------------------------------------

  const title = rest
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:at|on)\s+/i, "")
    .replace(/\s+(?:at|on)$/i, "")
    .replace(/^[\s,;:–—-]+/, "")
    .replace(/[\s,;:–—-]+$/, "")
    .trim();
  if (!title) return null;

  if (startMin !== null && endMin === null) endMin = startMin + 60;
  return { title, date, startMin, endMin };
}
