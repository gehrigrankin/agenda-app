import { describe, expect, it } from "vitest";

import {
  clampToParentDepth,
  taskChildRange,
  taskDescendants,
  taskFoldState,
  type TaskBlock,
} from "./task-tree";

const task = (indent: number, collapsed = false): TaskBlock => ({
  isTask: true,
  indent,
  collapsed,
});
const other = (): TaskBlock => ({ isTask: false, indent: 0, collapsed: false });

describe("taskChildRange", () => {
  it("takes the run of deeper tasks below", () => {
    const blocks = [task(0), task(1), task(1), task(0)];
    expect(taskChildRange(blocks, 0)).toEqual({ start: 1, end: 3 });
  });

  it("includes grandchildren — the subtree is consecutive", () => {
    const blocks = [task(0), task(1), task(2), task(1), task(0)];
    expect(taskChildRange(blocks, 0)).toEqual({ start: 1, end: 4 });
    expect(taskChildRange(blocks, 1)).toEqual({ start: 2, end: 3 });
  });

  it("stops at a task of the same or shallower depth", () => {
    expect(taskChildRange([task(1), task(1)], 0)).toEqual({ start: 1, end: 1 });
    expect(taskChildRange([task(1), task(0)], 0)).toEqual({ start: 1, end: 1 });
  });

  // Prose between two tasks belongs to the note, not to the task above it.
  it("stops at a non-task block", () => {
    const blocks = [task(0), other(), task(1)];
    expect(taskChildRange(blocks, 0)).toEqual({ start: 1, end: 1 });
  });

  it("reports a childless task as start === end", () => {
    expect(taskChildRange([task(0)], 0)).toEqual({ start: 1, end: 1 });
  });

  it("returns null for a non-task or a bad index", () => {
    expect(taskChildRange([other()], 0)).toBeNull();
    expect(taskChildRange([task(0)], 5)).toBeNull();
    expect(taskChildRange(null as unknown as TaskBlock[], 0)).toBeNull();
  });
});

describe("taskFoldState", () => {
  it("marks foldable tasks and hides nothing while expanded", () => {
    const { hidden, hasChildren } = taskFoldState([task(0), task(1), task(0)]);
    expect([...hasChildren]).toEqual([0]);
    expect(hidden.size).toBe(0);
  });

  it("hides the subtree of a collapsed task", () => {
    const blocks = [task(0, true), task(1), task(2), task(0)];
    const { hidden } = taskFoldState(blocks);
    expect([...hidden].sort()).toEqual([1, 2]);
  });

  // A collapsed grandparent wins: expanding an inner task must not punch a
  // hole through a fold that is closed above it.
  it("keeps a subtree hidden under a collapsed ancestor", () => {
    const blocks = [task(0, true), task(1, false), task(2), task(0)];
    const { hidden } = taskFoldState(blocks);
    expect([...hidden].sort()).toEqual([1, 2]);
  });

  it("unions independent folds", () => {
    const blocks = [task(0, true), task(1), task(0, true), task(1)];
    expect([...taskFoldState(blocks).hidden].sort()).toEqual([1, 3]);
  });

  it("gives a childless task no chevron", () => {
    expect([...taskFoldState([task(0), task(0)]).hasChildren]).toEqual([]);
  });

  it("ignores collapsed on a task with no children", () => {
    expect(taskFoldState([task(0, true), task(0)]).hidden.size).toBe(0);
  });

  it("tolerates a non-array", () => {
    const { hidden, hasChildren } = taskFoldState(null as unknown as TaskBlock[]);
    expect(hidden.size).toBe(0);
    expect(hasChildren.size).toBe(0);
  });
});

describe("taskDescendants", () => {
  it("lists the whole subtree", () => {
    const blocks = [task(0), task(1), task(2), task(0)];
    expect(taskDescendants(blocks, 0)).toEqual([1, 2]);
  });

  it("is empty for a childless task and for a non-task", () => {
    expect(taskDescendants([task(0)], 0)).toEqual([]);
    expect(taskDescendants([other()], 0)).toEqual([]);
  });
});

describe("clampToParentDepth", () => {
  // Tabbing twice would otherwise render a task as a child of nothing.
  it("allows at most one level deeper than the task above", () => {
    expect(clampToParentDepth(2, 0, 6)).toBe(1);
    expect(clampToParentDepth(1, 0, 6)).toBe(1);
    expect(clampToParentDepth(5, 2, 6)).toBe(3);
  });

  it("forces the first task in a run to be a root", () => {
    expect(clampToParentDepth(3, null, 6)).toBe(0);
  });

  it("respects the hard maximum", () => {
    expect(clampToParentDepth(9, 6, 6)).toBe(6);
  });

  it("never goes negative", () => {
    expect(clampToParentDepth(-3, 2, 6)).toBe(0);
  });

  it("leaves a shallower move alone", () => {
    expect(clampToParentDepth(0, 3, 6)).toBe(0);
  });
});
