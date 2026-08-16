import { describe, expect, it } from "vitest";

import { habitStateForDay, type HabitScheduleForDay } from "./habit-day";

const mondayFriday: HabitScheduleForDay = {
  paused: false,
  anchorDate: "2026-08-03",
  endDate: null,
  spec: {
    freq: "weekly",
    weekday: 1,
    weekdays: [1, 5],
    intervalDays: null,
    monthDay: null,
    remindAt: "08:00",
  },
};

describe("habitStateForDay", () => {
  it("reports completed and missed scheduled past days", () => {
    expect(
      habitStateForDay(mondayFriday, "2026-08-14", "2026-08-16", true),
    ).toBe("completed");
    expect(
      habitStateForDay(mondayFriday, "2026-08-10", "2026-08-16", false),
    ).toBe("missed");
  });

  it("reports future scheduled days without materializing an occurrence", () => {
    expect(
      habitStateForDay(mondayFriday, "2026-08-17", "2026-08-16", false),
    ).toBe("scheduled");
  });

  it("omits off-schedule, paused, pre-anchor, and post-end days", () => {
    expect(
      habitStateForDay(mondayFriday, "2026-08-12", "2026-08-16", false),
    ).toBeNull();
    expect(
      habitStateForDay(
        { ...mondayFriday, paused: true },
        "2026-08-14",
        "2026-08-16",
        true,
      ),
    ).toBeNull();
    expect(
      habitStateForDay(mondayFriday, "2026-07-31", "2026-08-16", false),
    ).toBeNull();
    expect(
      habitStateForDay(
        { ...mondayFriday, endDate: "2026-08-14" },
        "2026-08-17",
        "2026-08-16",
        false,
      ),
    ).toBeNull();
  });
});
