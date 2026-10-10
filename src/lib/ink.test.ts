import { describe, expect, it } from "vitest";

import {
  inkBottom,
  lassoSelect,
  parseStrokes,
  pointInPolygon,
  strokeHit,
  strokePath,
  translateStrokes,
  type InkStroke,
} from "./ink";

const stroke = (pts: [number, number][]): InkStroke => ({
  tool: "pen",
  color: "ink",
  width: 3,
  points: pts.map(([x, y]) => [x, y, 0.5]),
});

describe("ink", () => {
  it("parses defensively", () => {
    expect(parseStrokes("nope")).toEqual([]);
    expect(
      parseStrokes([
        {
          tool: "x",
          color: "purple",
          width: 999,
          points: [[1, 2], [Infinity, 3], "bad"],
        },
        { points: [] },
        null,
      ]),
    ).toEqual([
      { tool: "pen", color: "ink", width: 60, points: [[1, 2, 0.5]] },
    ]);
  });

  it("builds smoothed paths", () => {
    expect(strokePath([[0, 0, 0.5]])).toBe("M0 0L0.1 0");
    expect(
      strokePath([
        [0, 0, 0.5],
        [10, 0, 0.5],
        [20, 10, 0.5],
      ]),
    ).toBe("M0 0Q10 0 15 5L20 10");
  });

  it("hit-tests the eraser against segments", () => {
    const s = stroke([
      [0, 0],
      [100, 0],
    ]);
    expect(strokeHit(s, 50, 4, 3)).toBe(true);
    expect(strokeHit(s, 50, 20, 3)).toBe(false);
  });

  it("lasso-selects strokes mostly inside the loop and moves them", () => {
    const strokes = [
      stroke([
        [10, 10],
        [20, 20],
      ]),
      stroke([
        [200, 200],
        [210, 210],
      ]),
    ];
    const poly: [number, number][] = [
      [0, 0],
      [50, 0],
      [50, 50],
      [0, 50],
    ];
    expect(pointInPolygon(25, 25, poly)).toBe(true);
    expect(lassoSelect(strokes, poly)).toEqual([0]);
    const moved = translateStrokes(strokes, new Set([0]), 5, 5);
    expect(moved[0].points[0]).toEqual([15, 15, 0.5]);
    expect(moved[1]).toBe(strokes[1]);
    expect(inkBottom(moved)).toBe(210);
  });
});
