import { describe, expect, it } from "vitest";

import { buildFolderTree, type FolderTreeInputRow } from "./folderTree";

const row = (
  id: string,
  parentId: string | null,
  overrides: Partial<FolderTreeInputRow> = {},
): FolderTreeInputRow => ({
  id,
  title: id,
  emoji: null,
  color: null,
  parentId,
  sortOrder: 0,
  ...overrides,
});

describe("buildFolderTree", () => {
  it("treats folders whose parent is not a folder as top-level sections", () => {
    // "root" is the root bubble id — not in the folder set.
    const tree = buildFolderTree(
      [row("work", "root"), row("personal", "root")],
      new Map(),
    );
    expect(tree.map((n) => n.id)).toEqual(["personal", "work"]);
    expect(tree.every((n) => n.depth === 0)).toBe(true);
  });

  it("nests folders under folder parents and rolls counts up", () => {
    const tree = buildFolderTree(
      [
        row("work", "root"),
        row("launch", "work"),
        row("meetings", "work"),
        row("hiring", "work"),
      ],
      new Map([
        ["launch", 7],
        ["meetings", 8],
        ["hiring", 3],
      ]),
    );
    expect(tree).toHaveLength(1);
    const work = tree[0];
    expect(work.children.map((c) => c.id)).toEqual([
      "hiring",
      "launch",
      "meetings",
    ]);
    expect(work.directCount).toBe(0);
    expect(work.totalCount).toBe(18);
    expect(work.children.every((c) => c.depth === 1)).toBe(true);
  });

  it("counts direct notes on a section alongside descendant totals", () => {
    const tree = buildFolderTree(
      [row("work", "root"), row("launch", "work")],
      new Map([
        ["work", 2],
        ["launch", 7],
      ]),
    );
    expect(tree[0].directCount).toBe(2);
    expect(tree[0].totalCount).toBe(9);
  });

  it("orders by sortOrder before title", () => {
    const tree = buildFolderTree(
      [
        row("b", "root", { sortOrder: 0 }),
        row("a", "root", { sortOrder: 1 }),
      ],
      new Map(),
    );
    expect(tree.map((n) => n.id)).toEqual(["b", "a"]);
  });

  it("survives a corrupt parent cycle without looping", () => {
    // a → b → a should never happen (moveBubble guards it) but must not hang.
    const tree = buildFolderTree([row("a", "b"), row("b", "a")], new Map());
    expect(tree.length).toBeGreaterThan(0);
  });
});
