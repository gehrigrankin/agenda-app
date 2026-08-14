import { describe, expect, it } from "vitest";

import {
  clampToParentDepth,
  planTaskReparent,
  taskChildRange,
  taskDescendants,
  taskFoldState,
  taskParentCandidates,
  taskParentIndex,
  type TaskBlock,
  type TaskReparentPlan,
} from "./task-tree";

const task = (indent: number, collapsed = false): TaskBlock => ({
  isTask: true,
  indent,
  collapsed,
});
/** A non-task block (paragraph, bullet list, …) at `indent`. */
const other = (indent = 0): TaskBlock => ({
  isTask: false,
  indent,
  collapsed: false,
});

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

  // Prose at the task's OWN depth belongs to the note, not to the task above
  // it — it is the terminator, even though a task follows it.
  it("stops at a non-task block at the same indent", () => {
    const blocks = [task(0), other(0), task(1)];
    expect(taskChildRange(blocks, 0)).toEqual({ start: 1, end: 1 });
  });

  it("takes non-task blocks indented under the task", () => {
    const blocks = [task(0), other(1), other(1), other(0)];
    expect(taskChildRange(blocks, 0)).toEqual({ start: 1, end: 3 });
  });

  it("mixes tasks and non-tasks in one run", () => {
    const blocks = [task(0), other(1), task(1), other(1), task(0)];
    expect(taskChildRange(blocks, 0)).toEqual({ start: 1, end: 4 });
  });

  // A bullet under a subtask is the subtask's, and the parent's by descent.
  it("nests non-tasks at their own depth", () => {
    const blocks = [task(0), task(1), other(2), task(0)];
    expect(taskChildRange(blocks, 0)).toEqual({ start: 1, end: 3 });
    expect(taskChildRange(blocks, 1)).toEqual({ start: 2, end: 3 });
  });

  it("stops at a shallower non-task even inside a deeper run", () => {
    const blocks = [task(0), other(1), other(0), other(1)];
    expect(taskChildRange(blocks, 0)).toEqual({ start: 1, end: 2 });
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

  // The whole point of the bullet-children rule: a task whose only children
  // are prose still folds, so it still gets a chevron.
  it("marks a task whose only children are non-tasks", () => {
    const { hidden, hasChildren } = taskFoldState([
      task(0, true),
      other(1),
      other(1),
      task(0),
    ]);
    expect([...hasChildren]).toEqual([0]);
    expect([...hidden].sort()).toEqual([1, 2]);
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

  // Bullets fold with the parent but have no completion to propagate to.
  it("skips non-task children", () => {
    const blocks = [task(0), other(1), task(1), other(2)];
    expect(taskDescendants(blocks, 0)).toEqual([2]);
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

// ---------------------------------------------------------------------------
// Reparenting (the parent dropdown). Structure is still derived, so a "choose
// a parent" gesture is only ever an indent plus, when needed, a move of the
// block run — these tests assert the DOCUMENT the plan produces.
// ---------------------------------------------------------------------------

const MAX = 6;

/** A block with a name, so the resulting document can be read back. */
type Named = TaskBlock & { name: string };
const t = (name: string, indent = 0): Named => ({
  name,
  isTask: true,
  indent,
  collapsed: false,
});
const p = (name: string, indent = 0): Named => ({
  name,
  isTask: false,
  indent,
  collapsed: false,
});

/** "A0 B1" — every block as name + depth, in document order. */
const shape = (blocks: Named[]) =>
  blocks.map((b) => `${b.name}${b.indent}`).join(" ");

/** What the editor does with a plan (`$applyTaskReparent`), in the model. */
function applyPlan(blocks: Named[], plan: TaskReparentPlan): Named[] {
  const run = blocks
    .slice(plan.moved.start, plan.moved.end)
    .map((b, i) => ({ ...b, indent: plan.indents[i] }));
  if (!plan.moves) {
    return [
      ...blocks.slice(0, plan.moved.start),
      ...run,
      ...blocks.slice(plan.moved.end),
    ];
  }
  const rest = blocks.filter(
    (_, i) => i < plan.moved.start || i >= plan.moved.end,
  );
  const at =
    plan.insertAfter === null
      ? 0
      : rest.indexOf(blocks[plan.insertAfter]) + 1;
  return [...rest.slice(0, at), ...run, ...rest.slice(at)];
}

/** Plan + apply, the way the picker does it. Throws on a rejected pick. */
function reparent(
  blocks: Named[],
  index: number,
  parentIndex: number | null,
): string {
  const plan = planTaskReparent(blocks, index, parentIndex, MAX);
  if (!plan) throw new Error("plan rejected");
  return shape(applyPlan(blocks, plan));
}

describe("taskParentIndex", () => {
  it("finds the nearest shallower task above", () => {
    const blocks = [t("A"), t("B", 1), t("C", 2)];
    expect(taskParentIndex(blocks, 2)).toBe(1);
    expect(taskParentIndex(blocks, 1)).toBe(0);
    expect(taskParentIndex(blocks, 0)).toBeNull();
  });

  it("skips siblings and their subtrees", () => {
    const blocks = [t("A"), t("B", 1), t("B1", 2), t("C", 1)];
    expect(taskParentIndex(blocks, 3)).toBe(0);
  });

  // Same rule as taskChildRange: a shallower non-task ends the run, so the
  // task below it is nobody's child.
  it("returns null when prose at a shallower depth breaks the run", () => {
    const blocks = [t("A"), p("prose"), t("B", 1)];
    expect(taskChildRange(blocks, 0)).toEqual({ start: 1, end: 1 });
    expect(taskParentIndex(blocks, 2)).toBeNull();
  });

  it("is null for a non-task and a bad index", () => {
    expect(taskParentIndex([p("x")], 0)).toBeNull();
    expect(taskParentIndex([t("A")], 9)).toBeNull();
  });
});

describe("planTaskReparent", () => {
  it("nests a task under a shallower one above it", () => {
    // C is A's sibling; picking A makes it A's last child, after B's subtree.
    const blocks = [t("A"), t("B", 1), t("C")];
    expect(reparent(blocks, 2, 0)).toBe("A0 B1 C1");
  });

  it("nests under a deeper task, one level below it", () => {
    const blocks = [t("A"), t("B", 1), t("C")];
    expect(reparent(blocks, 2, 1)).toBe("A0 B1 C2");
  });

  it("lands after the chosen parent's existing children", () => {
    const blocks = [t("A"), t("A1", 1), t("A2", 1), t("C")];
    expect(reparent(blocks, 3, 0)).toBe("A0 A11 A21 C1");
  });

  it("leaves a task that already hangs off the pick exactly where it is", () => {
    const blocks = [t("A"), t("B", 1), t("C", 1)];
    // B is already A's first child — re-picking A must not shuffle it to last.
    const plan = planTaskReparent(blocks, 1, 0, MAX);
    expect(plan?.moves).toBe(false);
    expect(reparent(blocks, 1, 0)).toBe("A0 B1 C1");
  });

  it("unnests to top level, parking the task after its old root's subtree", () => {
    const blocks = [t("A"), t("B", 1), t("C", 1)];
    // B must not stay in the middle, or C would silently become B's child.
    expect(reparent(blocks, 1, null)).toBe("A0 C1 B0");
  });

  it("no-ops on 'top level' for a task that is already a root", () => {
    const blocks = [t("A"), t("B")];
    const plan = planTaskReparent(blocks, 1, null, MAX);
    expect(plan?.moves).toBe(false);
    expect(plan?.indent).toBe(0);
  });

  it("moves the task UP when the chosen parent is below it", () => {
    const blocks = [t("A"), t("B")];
    expect(reparent(blocks, 0, 1)).toBe("B0 A1");
  });

  it("moves the task down to a parent further along the document", () => {
    const blocks = [t("A"), t("B"), t("B1", 1), t("C")];
    expect(reparent(blocks, 0, 1)).toBe("B0 B11 A1 C0");
  });

  it("brings the whole subtree along, keeping its relative depths", () => {
    const blocks = [t("A"), t("A1", 1), t("A1a", 2), t("B")];
    expect(reparent(blocks, 0, 3)).toBe("B0 A1 A12 A1a3");
  });

  // The extended rule: bullets and prose indented under a task are its
  // children too, and a reparent has to carry them.
  it("carries indented non-task children", () => {
    const blocks = [t("A"), p("bullet", 1), t("B")];
    expect(reparent(blocks, 0, 2)).toBe("B0 A1 bullet2");
  });

  it("leaves prose at the task's own depth behind", () => {
    const blocks = [t("A"), p("note"), t("B")];
    expect(reparent(blocks, 0, 2)).toBe("note0 B0 A1");
  });

  // Nesting a task under its own child would ask the run to be inside itself;
  // the subtree can only end up orphaned, so the pick is refused outright and
  // taskParentCandidates never offers it.
  it("rejects the task's own descendants as a parent", () => {
    const blocks = [t("A"), t("A1", 1), t("A1a", 2), t("B")];
    expect(planTaskReparent(blocks, 0, 1, MAX)).toBeNull();
    expect(planTaskReparent(blocks, 0, 2, MAX)).toBeNull();
    expect(planTaskReparent(blocks, 0, 0, MAX)).toBeNull();
    expect(planTaskReparent(blocks, 0, 3, MAX)).not.toBeNull();
  });

  it("rejects a parent already at the maximum depth", () => {
    const blocks = [t("A", MAX), t("B")];
    expect(planTaskReparent(blocks, 1, 0, MAX)).toBeNull();
  });

  // Clamping instead would flatten the grandchild up onto its parent's depth,
  // quietly re-parenting it. Refusing keeps the subtree honest.
  it("rejects a move whose subtree would not fit under the maximum", () => {
    const blocks = [t("A", MAX - 1), t("B"), t("B1", 1)];
    expect(planTaskReparent(blocks, 1, 0, MAX)).toBeNull();
    expect(planTaskReparent(blocks, 2, 0, MAX)).not.toBeNull();
  });

  it("rejects a non-task on either end, and a bad index", () => {
    const blocks = [t("A"), p("x")];
    expect(planTaskReparent(blocks, 1, 0, MAX)).toBeNull();
    expect(planTaskReparent(blocks, 0, 1, MAX)).toBeNull();
    expect(planTaskReparent(blocks, 5, null, MAX)).toBeNull();
    expect(planTaskReparent(null as unknown as Named[], 0, null, MAX)).toBeNull();
  });

  it("keeps the derived fold structure in step with the pick", () => {
    const blocks = [t("A"), t("B"), t("B1", 1)];
    const plan = planTaskReparent(blocks, 0, 1, MAX)!;
    const after = applyPlan(blocks, plan);
    // A is now B's child: B folds over both, A over nothing.
    expect(taskDescendants(after, 0)).toEqual([1, 2]);
    expect(taskChildRange(after, 2)).toEqual({ start: 3, end: 3 });
  });
});

describe("taskParentCandidates", () => {
  it("offers every task but the subtree being moved", () => {
    const blocks = [t("A"), t("A1", 1), t("B"), t("C", 1)];
    expect(taskParentCandidates(blocks, 0, MAX)).toEqual([2, 3]);
  });

  it("includes tasks below the one being nested", () => {
    const blocks = [t("A"), t("B")];
    expect(taskParentCandidates(blocks, 0, MAX)).toEqual([1]);
    expect(taskParentCandidates(blocks, 1, MAX)).toEqual([0]);
  });

  it("skips non-tasks and parents that are too deep", () => {
    const blocks = [t("A", MAX), p("x"), t("B")];
    expect(taskParentCandidates(blocks, 2, MAX)).toEqual([]);
  });

  it("is empty for the only task in a note", () => {
    expect(taskParentCandidates([t("A")], 0, MAX)).toEqual([]);
  });
});
