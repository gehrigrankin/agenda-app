import { describe, expect, it } from "vitest";
import { daySpanSegments } from "./calendar-grid";

describe("daySpanSegments", () => {
  it("keeps a span within one week as a single segment", () => {
    // 1st of the month falls on a Wednesday (col 3): day 6 -> row 1 col 1,
    // day 7 -> row 1 col 2, day 8 -> row 1 col 3 — no week wrap.
    const segments = daySpanSegments(
      {
        uid: "e1",
        title: "Trip",
        startDate: "2026-07-06",
        endDate: "2026-07-08",
      },
      3,
    );
    expect(segments).toEqual([
      {
        uid: "e1",
        title: "Trip",
        row: 1,
        startCol: 1,
        endCol: 3,
        roundStart: true,
        roundEnd: true,
      },
    ]);
  });

  it("splits into one segment per row when the span wraps a week boundary", () => {
    // 1st of the month falls on a Friday (col 5): day 1 -> row 0 col 5,
    // day 2 -> row 0 col 6, day 3 wraps to row 1 col 0.
    const segments = daySpanSegments(
      {
        uid: "e2",
        title: "Long weekend",
        startDate: "2026-07-01",
        endDate: "2026-07-03",
      },
      5,
    );
    expect(segments).toEqual([
      {
        uid: "e2",
        title: "Long weekend",
        row: 0,
        startCol: 5,
        endCol: 6,
        roundStart: true,
        roundEnd: false,
      },
      {
        uid: "e2",
        title: "Long weekend",
        row: 1,
        startCol: 0,
        endCol: 0,
        roundStart: false,
        roundEnd: true,
      },
    ]);
  });

  it("rounds both ends of a single-day span", () => {
    const segments = daySpanSegments(
      {
        uid: "e3",
        title: "One day",
        startDate: "2026-07-15",
        endDate: "2026-07-15",
      },
      3,
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      startCol: segments[0].endCol,
      roundStart: true,
      roundEnd: true,
    });
  });
});
