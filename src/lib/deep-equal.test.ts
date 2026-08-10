import { describe, expect, it } from "vitest";

import { deepEqual } from "./deep-equal";

describe("deepEqual", () => {
  it("compares primitives", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual("a", "a")).toBe(true);
    expect(deepEqual(true, false)).toBe(false);
    expect(deepEqual(1, "1")).toBe(false);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(undefined, undefined)).toBe(true);
    expect(deepEqual(null, undefined)).toBe(false);
  });

  // The whole reason this exists: jsonb reorders keys on the round trip.
  it("ignores object key order", () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(
      deepEqual(
        { root: { type: "root", children: [] } },
        { root: { children: [], type: "root" } },
      ),
    ).toBe(true);
  });

  // ...but block order IS the document.
  it("respects array order", () => {
    expect(deepEqual([1, 2], [1, 2])).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual([1], [1, 2])).toBe(false);
  });

  it("distinguishes an array from an object", () => {
    expect(deepEqual([], {})).toBe(false);
    expect(deepEqual({ 0: "a" }, ["a"])).toBe(false);
  });

  it("compares nested structures", () => {
    const doc = () => ({
      root: {
        children: [
          { type: "task", title: "x", indent: 1, collapsed: false },
          { type: "paragraph", children: [{ type: "text", text: "hi" }] },
        ],
      },
    });
    expect(deepEqual(doc(), doc())).toBe(true);
    const changed = doc();
    changed.root.children[0].collapsed = true;
    expect(deepEqual(doc(), changed)).toBe(false);
  });

  it("catches a missing key rather than treating it as undefined", () => {
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it("treats NaN as equal to itself", () => {
    expect(deepEqual(NaN, NaN)).toBe(true);
    expect(deepEqual({ v: NaN }, { v: NaN })).toBe(true);
    expect(deepEqual(NaN, 1)).toBe(false);
  });
});
