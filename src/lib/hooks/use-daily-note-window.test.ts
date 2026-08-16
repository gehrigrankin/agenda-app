import { describe, expect, it } from "vitest";

import { dailyWindowValues, windowDates } from "../daily-note-window";

describe("windowDates", () => {
  it("returns a centered fifteen-day window nearest-first across months", () => {
    const dates = windowDates("2026-03-01");
    expect(dates).toHaveLength(15);
    expect(dates.slice(0, 5)).toEqual([
      "2026-03-01",
      "2026-02-28",
      "2026-03-02",
      "2026-02-27",
      "2026-03-03",
    ]);
    expect(dates.at(-2)).toBe("2026-02-22");
    expect(dates.at(-1)).toBe("2026-03-08");
  });
});

describe("dailyWindowValues", () => {
  it("marks dates missing from the range result as fetched and empty", () => {
    const note = { id: "n1", title: "Day", content: null };
    expect(
      [...dailyWindowValues(["2026-08-15", "2026-08-16"], [
        { date: "2026-08-16", note },
      ])],
    ).toEqual([
      ["2026-08-15", null],
      ["2026-08-16", note],
    ]);
  });
});
