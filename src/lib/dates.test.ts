import { describe, expect, it } from "vitest";
import {
  DATE_STR_RE,
  addDays,
  formatLongDate,
  formatShortDate,
  formatTodayElseDate,
  formatUtcDate,
  formatWeekRange,
  isoWeekNumber,
  localDateString,
  localDayBounds,
  parseLocalDate,
  startOfWeek,
  weekDays,
} from "./dates";

// All expectations for local-time functions are built with the same local
// Date constructors (new Date(y, m-1, d)) so the tests pass in any timezone.

describe("DATE_STR_RE", () => {
  it("matches zero-padded YYYY-MM-DD only", () => {
    expect(DATE_STR_RE.test("2026-07-07")).toBe(true);
    expect(DATE_STR_RE.test("2026-7-7")).toBe(false);
    expect(DATE_STR_RE.test("2026-07-07T00:00:00Z")).toBe(false);
    expect(DATE_STR_RE.test("07-07-2026")).toBe(false);
    expect(DATE_STR_RE.test("")).toBe(false);
  });
});

describe("localDateString", () => {
  it("formats a local Date as YYYY-MM-DD", () => {
    expect(localDateString(new Date(2026, 6, 7))).toBe("2026-07-07");
  });

  it("zero-pads month and day", () => {
    expect(localDateString(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("uses the local calendar day, not UTC", () => {
    // 23:59 local on Dec 31 is still Dec 31 locally regardless of what UTC
    // day that instant falls on.
    expect(localDateString(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
    expect(localDateString(new Date(2026, 0, 1, 0, 0, 1))).toBe("2026-01-01");
  });
});

describe("parseLocalDate", () => {
  it("parses as LOCAL midnight, not UTC", () => {
    const parsed = parseLocalDate("2026-03-09");
    expect(parsed.getTime()).toBe(new Date(2026, 2, 9).getTime());
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(2);
    expect(parsed.getDate()).toBe(9);
    expect(parsed.getHours()).toBe(0);
    expect(parsed.getMinutes()).toBe(0);
    expect(parsed.getSeconds()).toBe(0);
    expect(parsed.getMilliseconds()).toBe(0);
  });

  it("round-trips with localDateString", () => {
    for (const s of ["2026-01-01", "2026-02-28", "2024-02-29", "2026-07-07", "2026-12-31"]) {
      expect(localDateString(parseLocalDate(s))).toBe(s);
    }
  });

  it("round-trips a local Date at midnight", () => {
    const d = new Date(2026, 6, 7);
    expect(parseLocalDate(localDateString(d)).getTime()).toBe(d.getTime());
  });
});

describe("addDays", () => {
  it("adds within a month", () => {
    expect(addDays("2026-07-07", 3)).toBe("2026-07-10");
  });

  it("adds zero days", () => {
    expect(addDays("2026-07-07", 0)).toBe("2026-07-07");
  });

  it("crosses month boundaries forward", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-04-30", 1)).toBe("2026-05-01");
  });

  it("crosses month boundaries backward", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-07-01", -1)).toBe("2026-06-30");
  });

  it("handles leap-year February", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("crosses year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("handles multi-week jumps", () => {
    expect(addDays("2026-07-07", 45)).toBe("2026-08-21");
    expect(addDays("2026-07-07", -45)).toBe("2026-05-23");
  });
});

describe("formatLongDate", () => {
  it('formats as "Weekday, Month D"', () => {
    // 2026-07-05 is a Sunday.
    expect(formatLongDate("2026-07-05")).toBe("Sunday, July 5");
    expect(formatLongDate("2026-01-01")).toBe("Thursday, January 1");
  });
});

describe("formatShortDate", () => {
  it('formats as "Wkd, Mon D"', () => {
    expect(formatShortDate("2026-07-05")).toBe("Sun, Jul 5");
    expect(formatShortDate("2026-12-31")).toBe("Thu, Dec 31");
  });
});

describe("formatTodayElseDate", () => {
  // People's "last seen" (weekday: true) and Threads' "mentioned" (default)
  // labels — identical apart from the weekday.
  it('returns "Today" when the date matches todayStr', () => {
    const iso = new Date(2026, 6, 7, 9, 30).toISOString();
    expect(formatTodayElseDate(iso, "2026-07-07")).toBe("Today");
    expect(formatTodayElseDate(iso, "2026-07-07", { weekday: true })).toBe(
      "Today",
    );
  });

  it("returns null-safe: no todayStr never matches", () => {
    const iso = new Date(2026, 6, 7).toISOString();
    expect(formatTodayElseDate(iso, null)).not.toBe("Today");
  });

  it('formats without weekday as "Mon D" when not today', () => {
    // 2026-07-08 is a Wednesday, current year.
    const iso = new Date(2026, 6, 8).toISOString();
    expect(formatTodayElseDate(iso, "2026-07-07")).toBe("Jul 8");
  });

  it('formats with weekday as "Wkd, Mon D" when not today', () => {
    const iso = new Date(2026, 6, 8).toISOString();
    expect(formatTodayElseDate(iso, "2026-07-07", { weekday: true })).toBe(
      "Wed, Jul 8",
    );
  });

  it("appends the year only when it differs from the current year", () => {
    const iso = new Date(2020, 4, 12).toISOString(); // May 12, 2020
    expect(formatTodayElseDate(iso, "2026-07-07")).toBe("May 12, 2020");
    expect(formatTodayElseDate(iso, "2026-07-07", { weekday: true })).toBe(
      "Tue, May 12, 2020",
    );
  });
});

describe("formatUtcDate", () => {
  // The Date.UTC + timeZone: "UTC" trick used by the daily-note title and
  // the command palette's daily label — must never shift with server TZ.
  it('formats "Sun, Jul 5" (short style)', () => {
    // 2026-07-05 is a Sunday (same reference fact formatShortDate uses).
    expect(
      formatUtcDate("2026-07-05", {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    ).toBe("Sun, Jul 5");
  });

  it('formats "Wednesday, June 24" (long style)', () => {
    expect(
      formatUtcDate("2026-06-24", {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
    ).toBe("Wednesday, June 24");
  });

  it("never shifts the calendar day regardless of caller-passed opts", () => {
    // Same y/m/d parts, different opts — the day-of-week must stay fixed at
    // the UTC-anchored value, not drift with local TZ.
    expect(
      formatUtcDate("2026-01-01", { weekday: "long", month: "short", day: "numeric" }),
    ).toBe("Thursday, Jan 1");
  });
});

describe("localDayBounds", () => {
  it("returns local midnight start and next local midnight end", () => {
    const { start, end } = localDayBounds("2026-07-07");
    expect(start.getTime()).toBe(new Date(2026, 6, 7).getTime());
    expect(end.getTime()).toBe(new Date(2026, 6, 8).getTime());
  });

  it("spans month and year boundaries", () => {
    const feb = localDayBounds("2026-02-28");
    expect(feb.end.getTime()).toBe(new Date(2026, 2, 1).getTime());

    const nye = localDayBounds("2026-12-31");
    expect(nye.end.getTime()).toBe(new Date(2027, 0, 1).getTime());
  });

  it("start round-trips through localDateString", () => {
    const { start, end } = localDayBounds("2026-07-07");
    expect(localDateString(start)).toBe("2026-07-07");
    expect(localDateString(end)).toBe("2026-07-08");
  });
});

describe("startOfWeek", () => {
  // Reference facts: 2026-09-07 is a Monday, 2026-07-05 a Sunday (see above).
  it("returns the Monday itself for a Monday", () => {
    expect(startOfWeek("2026-09-07")).toBe("2026-09-07");
  });

  it("walks back to Monday from mid-week", () => {
    expect(startOfWeek("2026-09-08")).toBe("2026-09-07"); // Tuesday
    expect(startOfWeek("2026-09-11")).toBe("2026-09-07"); // Friday
    expect(startOfWeek("2026-09-12")).toBe("2026-09-07"); // Saturday
  });

  it("puts Sunday in the PRECEDING Monday's week", () => {
    expect(startOfWeek("2026-09-13")).toBe("2026-09-07");
    expect(startOfWeek("2026-07-05")).toBe("2026-06-29");
  });

  it("crosses month and year boundaries", () => {
    expect(startOfWeek("2026-10-01")).toBe("2026-09-28"); // Thursday
    expect(startOfWeek("2026-01-01")).toBe("2025-12-29"); // Thursday
  });

  it("lands on a Monday for every day of a week", () => {
    for (let i = 0; i < 7; i += 1) {
      const day = addDays("2026-09-07", i);
      expect(parseLocalDate(startOfWeek(day)).getDay()).toBe(1);
    }
  });
});

describe("weekDays", () => {
  it("returns the 7 days Mon..Sun from a Monday", () => {
    expect(weekDays("2026-09-07")).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
    ]);
  });

  it("spans a month boundary", () => {
    expect(weekDays("2026-09-28")).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
  });

  it("spans a year boundary", () => {
    const days = weekDays("2025-12-29");
    expect(days[0]).toBe("2025-12-29");
    expect(days[6]).toBe("2026-01-04");
    expect(days).toHaveLength(7);
  });
});

describe("isoWeekNumber", () => {
  // ISO-8601: week 1 is the week holding the year's first Thursday, so the
  // turn of the year is where the interesting cases live.
  it("numbers an ordinary mid-year week", () => {
    expect(isoWeekNumber("2026-09-08")).toBe(37);
    expect(isoWeekNumber("2026-09-07")).toBe(37);
    expect(isoWeekNumber("2026-09-13")).toBe(37); // Sunday closes the week
  });

  it("gives every day of a week the same number", () => {
    for (let i = 0; i < 7; i += 1) {
      expect(isoWeekNumber(addDays("2026-09-07", i))).toBe(37);
    }
  });

  it("puts Jan 1 in week 1 when the week holds the first Thursday", () => {
    // 2026-01-01 is a Thursday, so its week (Dec 29 – Jan 4) is week 1.
    expect(isoWeekNumber("2026-01-01")).toBe(1);
    expect(isoWeekNumber("2025-12-29")).toBe(1);
    expect(isoWeekNumber("2026-01-04")).toBe(1);
    expect(isoWeekNumber("2026-01-05")).toBe(2);
  });

  it("puts Jan 1 in the previous year's last week otherwise", () => {
    // 2027-01-01 is a Friday: its week belongs to 2026, which has 53 weeks.
    expect(isoWeekNumber("2027-01-01")).toBe(53);
    expect(isoWeekNumber("2027-01-03")).toBe(53); // Sunday, same week
    expect(isoWeekNumber("2027-01-04")).toBe(1); // Monday starts week 1
  });

  it("puts a late-December Monday in week 1 of the next year", () => {
    expect(isoWeekNumber("2024-12-30")).toBe(1);
    expect(isoWeekNumber("2024-12-29")).toBe(52); // Sunday, still 2024
  });
});

describe("formatWeekRange", () => {
  it("shows the month once inside one month", () => {
    expect(formatWeekRange("2026-09-07")).toBe("Sep 7 – 13");
  });

  it("shows both months across a month boundary", () => {
    expect(formatWeekRange("2026-09-28")).toBe("Sep 28 – Oct 4");
  });

  it("shows the year on both ends across a year boundary", () => {
    expect(formatWeekRange("2025-12-29")).toBe("Dec 29, 2025 – Jan 4, 2026");
  });

  it("omits the year inside one year even when it isn't the current one", () => {
    expect(formatWeekRange("2024-03-04")).toBe("Mar 4 – 10");
  });
});
