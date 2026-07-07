import { describe, expect, it } from "vitest";
import {
  describeSchedule,
  dueOccurrence,
  formatTimeLong,
  formatTimeShort,
  nextOccurrence,
  parseRecurrenceInput,
  recurrenceChipLabel,
  toInputPhrase,
  weekdayOf,
  type RecurrenceSpec,
} from "./recurrence";

// Fixed reference facts used throughout (no Date.now anywhere):
// 2026-01-01 is a Thursday (weekday 4); 2026-07-05 is a Sunday (weekday 0);
// 2026-07-07 is a Tuesday (weekday 2).

function spec(overrides: Partial<RecurrenceSpec> & { freq: RecurrenceSpec["freq"] }): RecurrenceSpec {
  return {
    weekday: null,
    intervalDays: null,
    monthDay: null,
    remindAt: null,
    ...overrides,
  };
}

describe("weekdayOf", () => {
  it("returns 0=Sunday … 6=Saturday for date strings", () => {
    expect(weekdayOf("2026-01-01")).toBe(4); // Thursday
    expect(weekdayOf("2026-07-05")).toBe(0); // Sunday
    expect(weekdayOf("2026-07-07")).toBe(2); // Tuesday
    expect(weekdayOf("2026-07-11")).toBe(6); // Saturday
  });
});

describe("nextOccurrence", () => {
  describe("daily", () => {
    const daily = spec({ freq: "daily" });

    it("returns fromDate when it is after the anchor", () => {
      expect(nextOccurrence(daily, "2026-01-01", "2026-03-05")).toBe("2026-03-05");
    });

    it("returns the anchor when fromDate is before it", () => {
      expect(nextOccurrence(daily, "2026-03-05", "2026-01-01")).toBe("2026-03-05");
    });

    it("returns the same day when fromDate equals the anchor", () => {
      expect(nextOccurrence(daily, "2026-01-01", "2026-01-01")).toBe("2026-01-01");
    });
  });

  describe("weekly", () => {
    const friday = spec({ freq: "weekly", weekday: 5 });

    it("advances to the next matching weekday", () => {
      // 2026-01-01 is Thursday; next Friday is 2026-01-02.
      expect(nextOccurrence(friday, "2026-01-01", "2026-01-01")).toBe("2026-01-02");
    });

    it("returns fromDate itself when it already falls on the weekday", () => {
      expect(nextOccurrence(friday, "2026-01-01", "2026-01-02")).toBe("2026-01-02");
    });

    it("wraps across the week boundary", () => {
      // From Saturday 2026-01-03, the next Friday is 2026-01-09.
      expect(nextOccurrence(friday, "2026-01-01", "2026-01-03")).toBe("2026-01-09");
    });

    it("starts from the anchor when fromDate is earlier", () => {
      expect(nextOccurrence(friday, "2026-07-06", "2026-01-01")).toBe("2026-07-10");
    });

    it("returns null for a malformed weekday", () => {
      expect(nextOccurrence(spec({ freq: "weekly", weekday: null }), "2026-01-01", "2026-01-01")).toBeNull();
      expect(nextOccurrence(spec({ freq: "weekly", weekday: 7 }), "2026-01-01", "2026-01-01")).toBeNull();
      expect(nextOccurrence(spec({ freq: "weekly", weekday: -1 }), "2026-01-01", "2026-01-01")).toBeNull();
    });
  });

  describe("interval", () => {
    const every3 = spec({ freq: "interval", intervalDays: 3 });

    it("phase-locks occurrences to the anchor", () => {
      // Anchor 2026-01-01 → occurrences 01, 04, 07, 10 …
      expect(nextOccurrence(every3, "2026-01-01", "2026-01-05")).toBe("2026-01-07");
      expect(nextOccurrence(every3, "2026-01-01", "2026-01-02")).toBe("2026-01-04");
    });

    it("returns fromDate when it lands exactly on an occurrence", () => {
      expect(nextOccurrence(every3, "2026-01-01", "2026-01-04")).toBe("2026-01-04");
    });

    it("returns the anchor when fromDate is on or before it", () => {
      expect(nextOccurrence(every3, "2026-01-10", "2026-01-01")).toBe("2026-01-10");
      expect(nextOccurrence(every3, "2026-01-10", "2026-01-10")).toBe("2026-01-10");
    });

    it("stays phase-locked across month boundaries", () => {
      // 2026-01-01 + 31 days = 2026-02-01 is not an occurrence of every-3;
      // occurrences near it are Jan 31 (+30) and Feb 3 (+33).
      expect(nextOccurrence(every3, "2026-01-01", "2026-02-01")).toBe("2026-02-03");
    });

    it("returns null for a malformed interval", () => {
      expect(nextOccurrence(spec({ freq: "interval", intervalDays: null }), "2026-01-01", "2026-01-01")).toBeNull();
      expect(nextOccurrence(spec({ freq: "interval", intervalDays: 0 }), "2026-01-01", "2026-01-01")).toBeNull();
    });
  });

  describe("monthly", () => {
    const day31 = spec({ freq: "monthly", monthDay: 31 });
    const day15 = spec({ freq: "monthly", monthDay: 15 });

    it("returns the day in the current month when still ahead", () => {
      expect(nextOccurrence(day15, "2026-01-01", "2026-01-10")).toBe("2026-01-15");
      expect(nextOccurrence(day15, "2026-01-01", "2026-01-15")).toBe("2026-01-15");
    });

    it("rolls to the next month when the day has passed", () => {
      expect(nextOccurrence(day15, "2026-01-01", "2026-01-20")).toBe("2026-02-15");
    });

    it("clamps day 31 to the end of February", () => {
      expect(nextOccurrence(day31, "2026-01-01", "2026-02-01")).toBe("2026-02-28");
    });

    it("clamps day 31 to the end of February in a leap year", () => {
      expect(nextOccurrence(day31, "2028-01-01", "2028-02-01")).toBe("2028-02-29");
    });

    it("clamps day 31 to April 30", () => {
      expect(nextOccurrence(day31, "2026-01-01", "2026-04-01")).toBe("2026-04-30");
    });

    it("does not clamp in 31-day months", () => {
      expect(nextOccurrence(day31, "2026-01-01", "2026-03-01")).toBe("2026-03-31");
      expect(nextOccurrence(day31, "2026-01-01", "2026-01-31")).toBe("2026-01-31");
    });

    it("rolls from a clamped occurrence into the next month", () => {
      // After Feb 28 the next occurrence is Mar 31.
      expect(nextOccurrence(day31, "2026-01-01", "2026-03-01")).toBe("2026-03-31");
    });

    it("returns null for a malformed month day", () => {
      expect(nextOccurrence(spec({ freq: "monthly", monthDay: null }), "2026-01-01", "2026-01-01")).toBeNull();
      expect(nextOccurrence(spec({ freq: "monthly", monthDay: 0 }), "2026-01-01", "2026-01-01")).toBeNull();
      expect(nextOccurrence(spec({ freq: "monthly", monthDay: 32 }), "2026-01-01", "2026-01-01")).toBeNull();
    });
  });
});

describe("dueOccurrence", () => {
  const daily = spec({ freq: "daily" });

  it("returns today for a fresh daily rule anchored today", () => {
    expect(dueOccurrence(daily, "2026-07-07", null, "2026-07-07")).toBe("2026-07-07");
  });

  it("returns today for a fresh daily rule anchored in the past", () => {
    expect(dueOccurrence(daily, "2026-07-01", null, "2026-07-07")).toBe("2026-07-07");
  });

  it("returns null when the anchor is in the future", () => {
    expect(dueOccurrence(daily, "2026-07-10", null, "2026-07-07")).toBeNull();
  });

  it("returns null when today's occurrence was already materialized", () => {
    expect(dueOccurrence(daily, "2026-07-01", "2026-07-07", "2026-07-07")).toBeNull();
  });

  it("returns todayStr for a daily rule dormant for 500+ days (regression)", () => {
    // 2025-02-01 → 2026-07-07 is 521 days; the fast-forward must not walk
    // day-by-day and return a stale date after hitting the iteration cap.
    expect(dueOccurrence(daily, "2025-01-01", "2025-02-01", "2026-07-07")).toBe("2026-07-07");
  });

  it("carries exactly one occurrence for a dormant weekly rule", () => {
    // Every Friday, anchored Fri 2026-01-02, last done 2026-02-06.
    // Most recent Friday on or before Tue 2026-07-07 is 2026-07-03.
    const friday = spec({ freq: "weekly", weekday: 5 });
    expect(dueOccurrence(friday, "2026-01-02", "2026-02-06", "2026-07-07")).toBe("2026-07-03");
  });

  it("handles a dormant interval rule with a period longer than 31 days", () => {
    // Every 45 days anchored 2025-01-01: occurrences at +45k. The largest
    // k*45 ≤ diff(2025-01-01, 2026-07-07)=552 is 540 → 2026-06-25.
    const every45 = spec({ freq: "interval", intervalDays: 45 });
    expect(dueOccurrence(every45, "2025-01-01", "2025-01-01", "2026-07-07")).toBe("2026-06-25");
  });

  it("handles a dormant monthly rule with clamping", () => {
    // 31st of each month, dormant since January: most recent occurrence on
    // or before 2026-07-07 is the clamped 2026-06-30.
    const day31 = spec({ freq: "monthly", monthDay: 31 });
    expect(dueOccurrence(day31, "2026-01-01", "2026-01-31", "2026-07-07")).toBe("2026-06-30");
  });

  it("returns null when lastDate is on or after the most recent occurrence", () => {
    const day15 = spec({ freq: "monthly", monthDay: 15 });
    // Most recent occurrence ≤ 2026-07-07 is 2026-06-15, already materialized.
    expect(dueOccurrence(day15, "2026-01-01", "2026-06-15", "2026-07-07")).toBeNull();
    // Weekly: last done on today's occurrence.
    const tuesday = spec({ freq: "weekly", weekday: 2 });
    expect(dueOccurrence(tuesday, "2026-01-06", "2026-07-07", "2026-07-07")).toBeNull();
  });

  it("returns the occurrence strictly after lastDate when one is due", () => {
    const day15 = spec({ freq: "monthly", monthDay: 15 });
    expect(dueOccurrence(day15, "2026-01-01", "2026-05-15", "2026-07-07")).toBe("2026-06-15");
  });
});

describe("parseRecurrenceInput", () => {
  const TODAY = "2026-07-07"; // Tuesday

  it('parses "every friday 4pm" with title and reminder', () => {
    const parsed = parseRecurrenceInput("review inbox every friday 4pm", TODAY);
    expect(parsed).toEqual({
      title: "review inbox",
      spec: { freq: "weekly", weekday: 5, intervalDays: null, monthDay: null, remindAt: "16:00" },
    });
  });

  it('parses "every day"', () => {
    const parsed = parseRecurrenceInput("water plants every day", TODAY);
    expect(parsed).toEqual({
      title: "water plants",
      spec: { freq: "daily", weekday: null, intervalDays: null, monthDay: null, remindAt: null },
    });
  });

  it('parses "daily" with a 24-hour time', () => {
    const parsed = parseRecurrenceInput("standup daily at 9:30", TODAY);
    expect(parsed).toEqual({
      title: "standup",
      spec: { freq: "daily", weekday: null, intervalDays: null, monthDay: null, remindAt: "09:30" },
    });
  });

  it('parses "every 3 days"', () => {
    const parsed = parseRecurrenceInput("every 3 days stretch", TODAY);
    expect(parsed).toEqual({
      title: "stretch",
      spec: { freq: "interval", weekday: null, intervalDays: 3, monthDay: null, remindAt: null },
    });
  });

  it('collapses "every 1 day" to daily', () => {
    const parsed = parseRecurrenceInput("floss every 1 day", TODAY);
    expect(parsed?.spec.freq).toBe("daily");
    expect(parsed?.spec.intervalDays).toBeNull();
  });

  it('parses "every other day"', () => {
    const parsed = parseRecurrenceInput("run every other day", TODAY);
    expect(parsed?.spec).toEqual({ freq: "interval", weekday: null, intervalDays: 2, monthDay: null, remindAt: null });
  });

  it('parses "every 2 weeks" as a 14-day interval', () => {
    const parsed = parseRecurrenceInput("review goals every 2 weeks", TODAY);
    expect(parsed?.spec).toEqual({ freq: "interval", weekday: null, intervalDays: 14, monthDay: null, remindAt: null });
  });

  it('parses "every week" with the weekday taken from today', () => {
    const parsed = parseRecurrenceInput("plan sprint every week", TODAY);
    expect(parsed?.spec).toEqual({ freq: "weekly", weekday: 2, intervalDays: null, monthDay: null, remindAt: null });
  });

  it("parses abbreviated weekday names", () => {
    expect(parseRecurrenceInput("gym every tues", TODAY)?.spec.weekday).toBe(2);
    expect(parseRecurrenceInput("gym every thu", TODAY)?.spec.weekday).toBe(4);
    expect(parseRecurrenceInput("gym every sat", TODAY)?.spec.weekday).toBe(6);
  });

  it('parses "every month on the 15th"', () => {
    const parsed = parseRecurrenceInput("pay rent every month on the 15th", TODAY);
    expect(parsed).toEqual({
      title: "pay rent",
      spec: { freq: "monthly", weekday: null, intervalDays: null, monthDay: 15, remindAt: null },
    });
  });

  it('parses "1st of each month"', () => {
    const parsed = parseRecurrenceInput("invoice clients 1st of each month", TODAY);
    expect(parsed?.spec).toEqual({ freq: "monthly", weekday: null, intervalDays: null, monthDay: 1, remindAt: null });
    expect(parsed?.title).toBe("invoice clients");
  });

  it('parses bare "monthly" with the day taken from today', () => {
    const parsed = parseRecurrenceInput("backup photos monthly", TODAY);
    expect(parsed?.spec).toEqual({ freq: "monthly", weekday: null, intervalDays: null, monthDay: 7, remindAt: null });
  });

  it("normalizes 12-hour edge times", () => {
    expect(parseRecurrenceInput("meds every day 12am", TODAY)?.spec.remindAt).toBe("00:00");
    expect(parseRecurrenceInput("lunch every day 12pm", TODAY)?.spec.remindAt).toBe("12:00");
  });

  it("returns null for plain text with no recurrence phrase", () => {
    expect(parseRecurrenceInput("buy milk", TODAY)).toBeNull();
    expect(parseRecurrenceInput("call mom at 4pm", TODAY)).toBeNull();
  });

  it("returns null for empty or whitespace-only input", () => {
    expect(parseRecurrenceInput("", TODAY)).toBeNull();
    expect(parseRecurrenceInput("   ", TODAY)).toBeNull();
  });

  it("returns null when a recurrence phrase leaves no title", () => {
    expect(parseRecurrenceInput("every day", TODAY)).toBeNull();
    expect(parseRecurrenceInput("every friday 4pm", TODAY)).toBeNull();
  });
});

describe("formatTimeShort", () => {
  it("drops :00 minutes", () => {
    expect(formatTimeShort("15:00")).toBe("3 PM");
    expect(formatTimeShort("09:00")).toBe("9 AM");
  });

  it("keeps non-zero minutes", () => {
    expect(formatTimeShort("09:30")).toBe("9:30 AM");
    expect(formatTimeShort("23:05")).toBe("11:05 PM");
  });

  it("handles midnight and noon", () => {
    expect(formatTimeShort("00:00")).toBe("12 AM");
    expect(formatTimeShort("12:00")).toBe("12 PM");
  });
});

describe("formatTimeLong", () => {
  it("always shows minutes", () => {
    expect(formatTimeLong("15:00")).toBe("3:00 PM");
    expect(formatTimeLong("09:05")).toBe("9:05 AM");
    expect(formatTimeLong("00:00")).toBe("12:00 AM");
    expect(formatTimeLong("12:00")).toBe("12:00 PM");
  });
});

describe("recurrenceChipLabel", () => {
  it("labels each frequency", () => {
    expect(recurrenceChipLabel(spec({ freq: "daily" }))).toBe("daily");
    expect(recurrenceChipLabel(spec({ freq: "weekly", weekday: 0 }))).toBe("Sun");
    expect(recurrenceChipLabel(spec({ freq: "weekly", weekday: 5 }))).toBe("Fri");
    expect(recurrenceChipLabel(spec({ freq: "interval", intervalDays: 3 }))).toBe("3d");
    expect(recurrenceChipLabel(spec({ freq: "monthly", monthDay: 1 }))).toBe("1st");
  });

  it("uses correct ordinals", () => {
    expect(recurrenceChipLabel(spec({ freq: "monthly", monthDay: 2 }))).toBe("2nd");
    expect(recurrenceChipLabel(spec({ freq: "monthly", monthDay: 3 }))).toBe("3rd");
    expect(recurrenceChipLabel(spec({ freq: "monthly", monthDay: 11 }))).toBe("11th");
    expect(recurrenceChipLabel(spec({ freq: "monthly", monthDay: 12 }))).toBe("12th");
    expect(recurrenceChipLabel(spec({ freq: "monthly", monthDay: 13 }))).toBe("13th");
    expect(recurrenceChipLabel(spec({ freq: "monthly", monthDay: 21 }))).toBe("21st");
    expect(recurrenceChipLabel(spec({ freq: "monthly", monthDay: 22 }))).toBe("22nd");
    expect(recurrenceChipLabel(spec({ freq: "monthly", monthDay: 23 }))).toBe("23rd");
    expect(recurrenceChipLabel(spec({ freq: "monthly", monthDay: 31 }))).toBe("31st");
  });
});

describe("describeSchedule", () => {
  it("describes each frequency", () => {
    expect(describeSchedule(spec({ freq: "daily" }))).toBe("Every day");
    expect(describeSchedule(spec({ freq: "weekly", weekday: 0 }))).toBe("Every Sunday");
    expect(describeSchedule(spec({ freq: "interval", intervalDays: 3 }))).toBe("Every 3 days");
    expect(describeSchedule(spec({ freq: "monthly", monthDay: 1 }))).toBe("1st of each month");
  });
});

describe("toInputPhrase", () => {
  it("builds phrases for each frequency", () => {
    expect(toInputPhrase("Water plants", spec({ freq: "daily" }))).toBe("Water plants every day");
    expect(toInputPhrase("Gym", spec({ freq: "weekly", weekday: 5 }))).toBe("Gym every friday");
    expect(toInputPhrase("Stretch", spec({ freq: "interval", intervalDays: 3 }))).toBe("Stretch every 3 days");
    expect(toInputPhrase("Pay rent", spec({ freq: "monthly", monthDay: 15 }))).toBe(
      "Pay rent 15th of each month",
    );
  });

  it("appends the reminder time", () => {
    expect(toInputPhrase("Pay rent", spec({ freq: "monthly", monthDay: 15, remindAt: "16:00" }))).toBe(
      "Pay rent 15th of each month 4:00pm",
    );
  });

  it("round-trips through parseRecurrenceInput", () => {
    const original = spec({ freq: "monthly", monthDay: 15, remindAt: "16:00" });
    const phrase = toInputPhrase("Pay rent", original);
    const parsed = parseRecurrenceInput(phrase, "2026-07-07");
    expect(parsed).toEqual({ title: "Pay rent", spec: original });

    const weekly = spec({ freq: "weekly", weekday: 5, remindAt: "09:30" });
    const weeklyParsed = parseRecurrenceInput(toInputPhrase("Review inbox", weekly), "2026-07-07");
    expect(weeklyParsed).toEqual({ title: "Review inbox", spec: weekly });
  });
});
