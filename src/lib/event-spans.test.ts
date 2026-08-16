import { describe, expect, it } from "vitest";

import {
  daysCoveredBySpans,
  dedupeSpans,
  spanSegmentsForDay,
  toSpan,
} from "./event-spans";

describe("toSpan", () => {
  it("ignores single-day and backwards ends", () => {
    expect(toSpan("a", "t", "2026-08-10", null)).toBeNull();
    expect(toSpan("a", "t", "2026-08-10", "2026-08-10")).toBeNull();
    expect(toSpan("a", "t", "2026-08-10", "2026-08-09")).toBeNull();
  });

  it("keeps a real span", () => {
    expect(toSpan("a", "Trip", "2026-08-10", "2026-08-12")).toEqual({
      key: "a",
      title: "Trip",
      start: "2026-08-10",
      end: "2026-08-12",
    });
  });
});

describe("dedupeSpans", () => {
  it("collapses the per-day repeats of one event", () => {
    const s = { key: "u1", title: "Trip", start: "2026-08-10", end: "2026-08-12" };
    expect(dedupeSpans([s, { ...s }, { ...s }])).toHaveLength(1);
  });
});

describe("spanSegmentsForDay", () => {
  const spans = [
    { key: "u1", title: "Trip", start: "2026-08-10", end: "2026-08-12" },
  ];

  it("rounds only the true ends", () => {
    const [start] = spanSegmentsForDay(spans, "2026-08-10", false);
    expect([start.isStart, start.isEnd]).toEqual([true, false]);
    const [mid] = spanSegmentsForDay(spans, "2026-08-11", false);
    expect([mid.isStart, mid.isEnd]).toEqual([false, false]);
    const [end] = spanSegmentsForDay(spans, "2026-08-12", false);
    expect([end.isStart, end.isEnd]).toEqual([false, true]);
  });

  it("relabels after a week wrap without rounding there", () => {
    const [seg] = spanSegmentsForDay(spans, "2026-08-11", true);
    expect(seg.showLabel).toBe(true);
    expect(seg.isStart).toBe(false);
  });

  it("skips days outside the span", () => {
    expect(spanSegmentsForDay(spans, "2026-08-13", false)).toEqual([]);
  });
});

describe("daysCoveredBySpans", () => {
  it("reports covered days", () => {
    const covers = daysCoveredBySpans([
      { key: "u1", title: "Trip", start: "2026-08-10", end: "2026-08-12" },
    ]);
    expect(covers("2026-08-11")).toBe(true);
    expect(covers("2026-08-09")).toBe(false);
  });
});
