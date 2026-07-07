import { describe, expect, it } from "vitest";
import {
  DATE_STR_RE,
  addDays,
  formatLongDate,
  formatShortDate,
  localDateString,
  localDayBounds,
  parseLocalDate,
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
