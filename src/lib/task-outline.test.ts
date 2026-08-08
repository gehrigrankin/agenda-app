import { describe, expect, it } from "vitest";
import {
  clampTaskIndent,
  descendantTaskIndices,
  taskHasSection,
  taskSectionIndices,
  type OutlineRow,
} from "./task-outline";

const t = (indent: number): OutlineRow => ({ indent, isTask: true });
const p = (indent: number): OutlineRow => ({ indent, isTask: false });

describe("clampTaskIndent", () => {
  it("indents one level deeper than the previous row", () => {
    expect(clampTaskIndent(0, 0, 1)).toBe(1);
  });

  it("caps indenting at previousIndent + 1, even from further back", () => {
    expect(clampTaskIndent(0, 2, 1)).toBe(3);
  });

  it("cannot indent past a shallower previous row even from deep indent", () => {
    // previous row is at indent 0, so this row can go to at most 1 no matter
    // how deep it currently is (e.g. after the previous row itself outdented).
    expect(clampTaskIndent(3, 0, 1)).toBe(1);
  });

  it("cannot indent when there is no previous row", () => {
    expect(clampTaskIndent(0, null, 1)).toBe(0);
  });

  it("outdents by one, floored at zero", () => {
    expect(clampTaskIndent(2, 0, -1)).toBe(1);
    expect(clampTaskIndent(0, 0, -1)).toBe(0);
  });
});

describe("taskSectionIndices", () => {
  it("returns nothing for a row with no following rows", () => {
    expect(taskSectionIndices([t(0)], 0)).toEqual([]);
  });

  it("collects contiguous deeper rows until a same-or-shallower row", () => {
    // 0: parent
    // 1:   child
    // 2:     grandchild
    // 3:   child (indent 1) -> still nested under parent (indent 0)
    // 4: sibling (indent 0) -> boundary
    const rows = [t(0), t(1), t(2), t(1), t(0)];
    expect(taskSectionIndices(rows, 0)).toEqual([1, 2, 3]);
  });

  it("stops at a row with equal indent, not just shallower", () => {
    const rows = [t(1), t(1)];
    expect(taskSectionIndices(rows, 0)).toEqual([]);
  });

  it("sweeps up non-task rows inside the section, like a heading fold", () => {
    const rows = [t(0), p(1), t(1), t(0)];
    expect(taskSectionIndices(rows, 0)).toEqual([1, 2]);
  });

  it("returns [] for an out-of-range index", () => {
    expect(taskSectionIndices([t(0)], 5)).toEqual([]);
  });
});

describe("taskHasSection", () => {
  it("is false for a leaf row", () => {
    expect(taskHasSection([t(0), t(0)], 0)).toBe(false);
  });

  it("is true when a deeper row follows", () => {
    expect(taskHasSection([t(0), t(1)], 0)).toBe(true);
  });
});

describe("descendantTaskIndices", () => {
  it("filters the section down to task rows only", () => {
    const rows = [t(0), p(1), t(1), p(1), t(2), t(0)];
    expect(descendantTaskIndices(rows, 0)).toEqual([2, 4]);
  });

  it("returns [] when the section has no tasks", () => {
    const rows = [t(0), p(1), p(1)];
    expect(descendantTaskIndices(rows, 0)).toEqual([]);
  });
});
