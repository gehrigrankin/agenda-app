import { describe, expect, it } from "vitest";

import {
  hhmmToMin,
  hourLabel,
  layoutOverlaps,
  layoutStripBars,
  minToHHMM,
  monthCells,
  rangeTitle,
  snapMinutes,
  stepAnchor,
  visibleDays,
  workWeekMonday,
} from "./calendar-grid";

describe("visibleDays", () => {
  it("runs the desktop week Sun–Sat", () => {
    expect(visibleDays("2026-10-09", "week", false)).toEqual([
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
    ]);
  });

  it("runs the tablet work week Mon–Fri, weekends closing the prior week", () => {
    expect(visibleDays("2026-10-09", "week", true)).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
    ]);
    expect(workWeekMonday("2026-10-11")).toBe("2026-10-05");
    expect(workWeekMonday("2026-10-10")).toBe("2026-10-05");
  });

  it("covers a whole month", () => {
    const days = visibleDays("2026-02-14", "month", false);
    expect(days[0]).toBe("2026-02-01");
    expect(days.at(-1)).toBe("2026-02-28");
  });
});

describe("monthCells", () => {
  it("pads to whole Sun–Sat weeks", () => {
    const cells = monthCells("2026-10-09");
    // Oct 1 2026 is a Thursday.
    expect(cells.slice(0, 5)).toEqual([null, null, null, null, "2026-10-01"]);
    expect(cells.length % 7).toBe(0);
    expect(cells.filter(Boolean)).toHaveLength(31);
  });
});

describe("stepAnchor", () => {
  it("pages by day, week and month (clamping the day of month)", () => {
    expect(stepAnchor("2026-10-09", "day", 1)).toBe("2026-10-10");
    expect(stepAnchor("2026-10-09", "week", -1)).toBe("2026-10-02");
    expect(stepAnchor("2026-01-31", "month", 1)).toBe("2026-02-28");
    expect(stepAnchor("2026-12-15", "month", 1)).toBe("2027-01-15");
  });
});

describe("rangeTitle", () => {
  it("names a week like the design", () => {
    const days = visibleDays("2026-10-09", "week", false);
    expect(rangeTitle(days, "week", false)).toEqual({
      title: "October 4 – 10",
      subline: "Week 41",
    });
  });

  it("names the work week and cross-month weeks", () => {
    expect(
      rangeTitle(visibleDays("2026-10-09", "week", true), "week", true),
    ).toEqual({ title: "October 5 – 9", subline: "Work week" });
    expect(
      rangeTitle(visibleDays("2026-09-30", "week", false), "week", false).title,
    ).toBe("September 27 – October 3");
  });

  it("names a day and a month", () => {
    expect(rangeTitle(["2026-10-09"], "day", false).title).toBe(
      "Friday, October 9",
    );
    expect(
      rangeTitle(visibleDays("2026-10-09", "month", false), "month", false)
        .title,
    ).toBe("October 2026");
  });
});

describe("time helpers", () => {
  it("round-trips HH:MM", () => {
    expect(minToHHMM(570)).toBe("09:30");
    expect(hhmmToMin("09:30")).toBe(570);
    expect(hhmmToMin("25:00")).toBeNull();
    expect(hhmmToMin(null)).toBeNull();
  });

  it("labels the gutter and snaps", () => {
    expect(hourLabel(0)).toBe("12a");
    expect(hourLabel(8)).toBe("8a");
    expect(hourLabel(12)).toBe("12p");
    expect(hourLabel(21)).toBe("9p");
    expect(snapMinutes(551)).toBe(540);
    expect(snapMinutes(1439)).toBe(1425);
    expect(snapMinutes(-5)).toBe(0);
  });
});

describe("layoutOverlaps", () => {
  it("leaves lone items full width", () => {
    const out = layoutOverlaps([
      { key: "a", start: 540, end: 600 },
      { key: "b", start: 600, end: 660 },
    ]);
    expect(out.get("a")).toEqual({ key: "a", col: 0, cols: 1 });
    expect(out.get("b")).toEqual({ key: "b", col: 0, cols: 1 });
  });

  it("splits a cluster and reuses a freed lane", () => {
    const out = layoutOverlaps([
      { key: "a", start: 540, end: 660 },
      { key: "b", start: 570, end: 600 },
      { key: "c", start: 600, end: 630 },
    ]);
    expect(out.get("a")).toMatchObject({ col: 0, cols: 2 });
    expect(out.get("b")).toMatchObject({ col: 1, cols: 2 });
    expect(out.get("c")).toMatchObject({ col: 1, cols: 2 });
  });

  it("gives zero-length items a minimum length", () => {
    const out = layoutOverlaps([
      { key: "a", start: 540, end: 540 },
      { key: "b", start: 555, end: 600 },
    ]);
    expect(out.get("a")?.cols).toBe(2);
  });
});

describe("layoutStripBars", () => {
  const week = visibleDays("2026-10-09", "week", false);

  it("clips spans to the view and stacks lanes", () => {
    const bars = layoutStripBars(
      [
        { key: "trip", start: "2026-10-01", end: "2026-10-06" },
        { key: "day", start: "2026-10-05", end: "2026-10-05" },
        { key: "late", start: "2026-10-08", end: "2026-10-20" },
      ],
      week,
    );
    expect(bars.find((b) => b.key === "trip")).toMatchObject({
      startCol: 0,
      endCol: 2,
      isStart: false,
      isEnd: true,
      lane: 0,
    });
    expect(bars.find((b) => b.key === "day")?.lane).toBe(1);
    expect(bars.find((b) => b.key === "late")).toMatchObject({
      startCol: 4,
      endCol: 6,
      lane: 0,
      isEnd: false,
    });
  });

  it("clamps weekend ends in the work week", () => {
    const workWeek = visibleDays("2026-10-09", "week", true);
    const [bar] = layoutStripBars(
      [{ key: "w", start: "2026-10-09", end: "2026-10-11" }],
      workWeek,
    );
    expect(bar).toMatchObject({ startCol: 4, endCol: 4, isEnd: false });
  });
});
