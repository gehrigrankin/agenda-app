import { describe, expect, it } from "vitest";

import {
  isEventRepeat,
  occurrenceId,
  occurrenceStarts,
  parseOccurrenceId,
  repeatLabel,
  repeatsOn,
} from "./event-repeat";

// 2026-10-20 is a Tuesday.
const TUE = "2026-10-20";

describe("repeatsOn", () => {
  it("never before the first day", () => {
    expect(repeatsOn(TUE, "daily", "2026-10-19")).toBe(false);
  });

  it("weekly and every other week land on the same weekday", () => {
    expect(repeatsOn(TUE, "weekly", "2026-10-27")).toBe(true);
    expect(repeatsOn(TUE, "weekly", "2026-10-28")).toBe(false);
    expect(repeatsOn(TUE, "biweekly", "2026-10-27")).toBe(false);
    expect(repeatsOn(TUE, "biweekly", "2026-11-03")).toBe(true);
  });

  it("weekdays skip Saturday and Sunday", () => {
    expect(repeatsOn(TUE, "weekdays", "2026-10-24")).toBe(false);
    expect(repeatsOn(TUE, "weekdays", "2026-10-25")).toBe(false);
    expect(repeatsOn(TUE, "weekdays", "2026-10-26")).toBe(true);
  });

  it("monthly keeps the day of month and skips months without it", () => {
    expect(repeatsOn("2026-01-31", "monthly", "2026-03-31")).toBe(true);
    expect(repeatsOn("2026-01-31", "monthly", "2026-02-28")).toBe(false);
    expect(repeatsOn("2026-01-31", "monthly", "2026-04-30")).toBe(false);
  });

  it("yearly keeps month and day", () => {
    expect(repeatsOn(TUE, "yearly", "2027-10-20")).toBe(true);
    expect(repeatsOn(TUE, "yearly", "2027-10-21")).toBe(false);
  });
});

describe("occurrenceStarts", () => {
  it("lists the starts inside the range", () => {
    expect(occurrenceStarts(TUE, "weekly", "2026-10-01", "2026-11-10")).toEqual([
      "2026-10-20",
      "2026-10-27",
      "2026-11-03",
      "2026-11-10",
    ]);
  });

  it("stops at the last day and leaves out skipped days", () => {
    expect(
      occurrenceStarts(TUE, "daily", "2026-10-20", "2026-10-31", {
        until: "2026-10-23",
        skip: ["2026-10-21"],
      }),
    ).toEqual(["2026-10-20", "2026-10-22", "2026-10-23"]);
  });

  it("includes an occurrence that started before the range but runs into it", () => {
    // A 2-day event every Tuesday covers Tue–Wed; Wed 28 is in range.
    expect(
      occurrenceStarts(TUE, "weekly", "2026-10-28", "2026-10-30", { spanDays: 1 }),
    ).toEqual(["2026-10-27"]);
  });

  it("returns nothing for a range ending before the series starts", () => {
    expect(occurrenceStarts(TUE, "daily", "2026-10-01", "2026-10-19")).toEqual([]);
  });
});

describe("occurrence ids", () => {
  it("round-trip", () => {
    const id = occurrenceId("abc", TUE);
    expect(parseOccurrenceId(id)).toEqual({ seriesId: "abc", date: TUE });
    expect(parseOccurrenceId("abc")).toEqual({ seriesId: "abc", date: null });
  });
});

describe("repeatLabel", () => {
  it("says the rule against the first day", () => {
    expect(repeatLabel("weekly", TUE)).toBe("Every Tuesday");
    expect(repeatLabel("biweekly", TUE)).toBe("Every other Tuesday");
    expect(repeatLabel("monthly", TUE)).toBe("Monthly on the 20th");
    expect(repeatLabel("monthly", "2026-10-01")).toBe("Monthly on the 1st");
    expect(repeatLabel("monthly", "2026-10-12")).toBe("Monthly on the 12th");
    expect(repeatLabel("yearly", TUE)).toBe("Every Oct 20");
  });
});

describe("isEventRepeat", () => {
  it("accepts only known rules", () => {
    expect(isEventRepeat("weekly")).toBe(true);
    expect(isEventRepeat("hourly")).toBe(false);
    expect(isEventRepeat(null)).toBe(false);
  });
});
