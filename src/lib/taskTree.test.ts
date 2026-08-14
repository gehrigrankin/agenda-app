import { describe, expect, it } from "vitest";

import {
  buildTaskTree,
  flattenTaskTree,
  wouldCreateCycle,
  type TaskTreeInputRow,
} from "./taskTree";

const row = (id: string, parentId: string | null): TaskTreeInputRow => ({
  id,
  parentId,
});

describe("buildTaskTree", () => {
  it("puts parentless tasks at the root", () => {
    const tree = buildTaskTree([row("a", null), row("b", null)]);
    expect(tree.map((n) => n.task.id)).toEqual(["a", "b"]);
    expect(tree.every((n) => n.depth === 0 && n.children.length === 0)).toBe(
      true,
    );
  });

  it("nests a child under its parent within the same list", () => {
    const tree = buildTaskTree([row("parent", null), row("child", "parent")]);
    expect(tree).toHaveLength(1);
    expect(tree[0].task.id).toBe("parent");
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].task.id).toBe("child");
    expect(tree[0].children[0].depth).toBe(1);
  });

  it("nests multiple levels deep", () => {
    const tree = buildTaskTree([
      row("grandparent", null),
      row("parent", "grandparent"),
      row("child", "parent"),
    ]);
    expect(tree[0].children[0].children[0].task.id).toBe("child");
    expect(tree[0].children[0].children[0].depth).toBe(2);
  });

  it("surfaces a task as a root when its parent isn't in the list", () => {
    // e.g. the parent is due today and the child is unscheduled — each
    // bucket only sees its own rows.
    const tree = buildTaskTree([row("child", "missing-parent")]);
    expect(tree.map((n) => n.task.id)).toEqual(["child"]);
    expect(tree[0].depth).toBe(0);
  });

  it("breaks a corrupt cycle instead of looping forever", () => {
    const tree = buildTaskTree([row("a", "b"), row("b", "a")]);
    // Neither can build as the other's descendant once the first is seen,
    // so both come back as top-level roots.
    expect(tree.map((n) => n.task.id).sort()).toEqual(["a", "b"]);
  });
});

describe("flattenTaskTree", () => {
  it("flattens depth-first, honoring collapsed parents", () => {
    const tree = buildTaskTree([
      row("parent", null),
      row("child1", "parent"),
      row("child2", "parent"),
      row("grandchild", "child1"),
    ]);
    const expanded = flattenTaskTree(tree, new Set());
    expect(expanded.map((n) => n.task.id)).toEqual([
      "parent",
      "child1",
      "grandchild",
      "child2",
    ]);

    const collapsedParent = flattenTaskTree(tree, new Set(["parent"]));
    expect(collapsedParent.map((n) => n.task.id)).toEqual(["parent"]);

    const collapsedChild = flattenTaskTree(tree, new Set(["child1"]));
    expect(collapsedChild.map((n) => n.task.id)).toEqual([
      "parent",
      "child1",
      "child2",
    ]);
  });
});

describe("wouldCreateCycle", () => {
  const chain: Record<string, string | null> = {
    b: "a",
    c: "b",
    d: "c",
  };
  const parentOf = (id: string) => chain[id] ?? null;

  it("rejects self-parenting", () => {
    expect(wouldCreateCycle("a", "a", parentOf)).toBe(true);
  });

  it("rejects making a task a child of its own descendant", () => {
    // "a" is an ancestor of "d" (a -> b -> c -> d); parenting a under d
    // would create a -> d -> c -> b -> a.
    expect(wouldCreateCycle("a", "d", parentOf)).toBe(true);
  });

  it("allows parenting under an unrelated task", () => {
    expect(wouldCreateCycle("a", "c", parentOf)).toBe(false);
  });

  it("allows a fresh top-of-chain parent with no ancestors", () => {
    expect(wouldCreateCycle("z", "a", parentOf)).toBe(false);
  });

  it("does not spin forever on a pre-existing corrupt cycle", () => {
    const cyclic = (id: string) => (id === "x" ? "y" : "x");
    expect(wouldCreateCycle("q", "x", cyclic, 10)).toBe(false);
  });
});
