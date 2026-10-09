import { describe, expect, it } from "vitest";

import {
  buildExplorerTree,
  filterExplorer,
  folderPath,
  highlightSegments,
  hoistTree,
  indexTree,
  isInvalidFolderMove,
  treeKey,
  visibleRows,
  type ExplorerFolderInput,
  type ExplorerNode,
  type ExplorerNoteInput,
} from "./explorer-tree";

const folder = (
  id: string,
  parentId: string | null,
  extra: Partial<ExplorerFolderInput> = {},
): ExplorerFolderInput => ({
  id,
  title: id,
  parentId,
  icon: null,
  emoji: null,
  color: null,
  sortOrder: 0,
  sortMode: null,
  createdAt: "2026-01-01T00:00:00Z",
  ...extra,
});

const note = (
  id: string,
  folderId: string | null,
  extra: Partial<ExplorerNoteInput> = {},
): ExplorerNoteInput => ({
  id,
  title: id,
  folderId,
  sortOrder: 0,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  preview: "",
  ...extra,
});

const ids = (nodes: ExplorerNode[]) => nodes.map((n) => n.id);

const FOLDERS = [
  folder("Resources", "ROOT-BUBBLE"),
  folder("Interests", "Resources"),
  folder("Music", "Interests"),
  folder("Jazz", "Music"),
  folder("Projects", null),
];
const NOTES = [
  note("learning jazz", "Jazz", { updatedAt: "2026-09-21T00:00:00Z" }),
  note("Jazz songs", "Jazz", { updatedAt: "2026-09-18T00:00:00Z" }),
  note("Song ideas", "Music", { updatedAt: "2026-09-22T00:00:00Z" }),
  note("Untitled", null),
];

describe("buildExplorerTree", () => {
  it("nests folders under folder parents and roots the rest", () => {
    const tree = buildExplorerTree(FOLDERS, NOTES, {
      sort: "alpha",
      group: "folders-first",
    });
    expect(ids(tree)).toEqual(["Projects", "Resources", "Untitled"]);
    const idx = indexTree(tree);
    const music = idx.get("Music");
    expect(music?.kind).toBe("folder");
    if (music?.kind !== "folder") return;
    expect(ids(music.children)).toEqual(["Jazz", "Song ideas"]);
    expect(music.depth).toBe(2);
    expect(music.ancestors).toEqual(["Resources", "Interests"]);
    expect(music.noteCount).toBe(3);
    expect(music.lastEdited).toBe("2026-09-22T00:00:00Z");
  });

  it("mixes folders and notes when grouping is mixed", () => {
    const tree = buildExplorerTree(FOLDERS, NOTES, {
      sort: "alpha",
      group: "mixed",
    });
    const music = indexTree(tree).get("Music");
    if (music?.kind !== "folder") throw new Error("no music");
    expect(ids(music.children)).toEqual(["Jazz", "Song ideas"]);
    // Recently edited, mixed: Song ideas (9/22) beats Jazz (latest 9/21).
    const edited = buildExplorerTree(FOLDERS, NOTES, {
      sort: "edited",
      group: "mixed",
    });
    const m2 = indexTree(edited).get("Music");
    if (m2?.kind !== "folder") throw new Error("no music");
    expect(ids(m2.children)).toEqual(["Song ideas", "Jazz"]);
  });

  it("lets a folder's own sort mode override the global sort", () => {
    const folders = FOLDERS.map((f) =>
      f.id === "Jazz" ? { ...f, sortMode: "edited" as const } : f,
    );
    const tree = buildExplorerTree(folders, NOTES, {
      sort: "alpha",
      group: "folders-first",
    });
    const jazz = indexTree(tree).get("Jazz");
    if (jazz?.kind !== "folder") throw new Error("no jazz");
    expect(ids(jazz.children)).toEqual(["learning jazz", "Jazz songs"]);
  });

  it("orders manually by sortOrder, then creation", () => {
    const notes = [
      note("b", null, { sortOrder: 2 }),
      note("a", null, { sortOrder: 1 }),
      note("c", null, { sortOrder: 1, createdAt: "2026-02-01T00:00:00Z" }),
    ];
    const tree = buildExplorerTree([], notes, {
      sort: "manual",
      group: "folders-first",
    });
    expect(ids(tree)).toEqual(["a", "c", "b"]);
  });

  it("survives a parent cycle without dropping folders", () => {
    const tree = buildExplorerTree(
      [folder("x", "y"), folder("y", "x")],
      [],
      { sort: "alpha", group: "folders-first" },
    );
    expect(indexTree(tree).size).toBe(2);
  });
});

describe("hoist + path", () => {
  const tree = buildExplorerTree(FOLDERS, NOTES, {
    sort: "alpha",
    group: "folders-first",
  });
  it("re-roots at a folder with rebased depths", () => {
    const hoisted = hoistTree(tree, "Interests");
    expect(hoisted && ids(hoisted)).toEqual(["Music"]);
    expect(hoisted?.[0].depth).toBe(0);
    expect(hoistTree(tree, "learning jazz")).toBeNull();
  });
  it("builds a folder path", () => {
    expect(folderPath(indexTree(tree), "Jazz").map((p) => p.title)).toEqual([
      "Resources",
      "Interests",
      "Music",
      "Jazz",
    ]);
  });
});

describe("filterExplorer", () => {
  const tree = buildExplorerTree(FOLDERS, NOTES, {
    sort: "alpha",
    group: "folders-first",
  });
  it("keeps matching paths, dims context folders, flags body matches", () => {
    const res = filterExplorer(tree, "jazz", new Set(["Song ideas"]));
    expect(res.noteCount).toBe(3);
    expect(res.folderCount).toBe(1);
    expect(res.nodes.map((n) => n.node.id)).toEqual(["Resources"]);
    const resources = res.nodes[0];
    expect(resources.context).toBe(true);
    const music = resources.children[0].children[0];
    expect(music.node.id).toBe("Music");
    expect(music.children.map((c) => [c.node.id, c.matched, c.inText])).toEqual(
      [
        ["Jazz", true, false],
        ["Song ideas", false, true],
      ],
    );
  });
  it("ignores body matches for titles-only", () => {
    const res = filterExplorer(tree, "jazz", new Set(["Song ideas"]), {
      titlesOnly: true,
    });
    expect(res.noteCount).toBe(2);
  });
  it("returns nothing for an empty query", () => {
    expect(filterExplorer(tree, "  ").nodes).toEqual([]);
  });
});

describe("highlightSegments", () => {
  it("splits every occurrence case-insensitively", () => {
    expect(highlightSegments("Jazz and jazz", "JAZZ")).toEqual([
      { text: "Jazz", hit: true },
      { text: " and ", hit: false },
      { text: "jazz", hit: true },
    ]);
  });
});

describe("keyboard", () => {
  const tree = buildExplorerTree(FOLDERS, NOTES, {
    sort: "alpha",
    group: "folders-first",
  });
  const rows = visibleRows(tree, new Set(["Resources"]));
  it("walks visible rows", () => {
    expect(rows.map((r) => r.id)).toEqual([
      "Projects",
      "Resources",
      "Interests",
      "Untitled",
    ]);
    expect(treeKey(rows, "Resources", "ArrowDown")).toEqual({
      type: "focus",
      id: "Interests",
    });
    expect(treeKey(rows, "Interests", "ArrowRight")).toEqual({
      type: "expand",
      id: "Interests",
    });
    expect(treeKey(rows, "Interests", "ArrowLeft")).toEqual({
      type: "focus",
      id: "Resources",
    });
    expect(treeKey(rows, "Resources", "ArrowLeft")).toEqual({
      type: "collapse",
      id: "Resources",
    });
    expect(treeKey(rows, "Untitled", "Enter")).toEqual({
      type: "open",
      id: "Untitled",
    });
    expect(treeKey(rows, "Untitled", "F2")).toEqual({
      type: "rename",
      id: "Untitled",
    });
  });
});

describe("isInvalidFolderMove", () => {
  const idx = indexTree(
    buildExplorerTree(FOLDERS, NOTES, { sort: "alpha", group: "mixed" }),
  );
  it("blocks moving a folder into itself or a descendant", () => {
    expect(isInvalidFolderMove(idx, "Interests", "Jazz")).toBe(true);
    expect(isInvalidFolderMove(idx, "Interests", "Interests")).toBe(true);
    expect(isInvalidFolderMove(idx, "Jazz", "Projects")).toBe(false);
    expect(isInvalidFolderMove(idx, "Jazz", null)).toBe(false);
  });
});
