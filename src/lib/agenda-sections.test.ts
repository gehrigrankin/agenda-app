import { describe, expect, it } from "vitest";

import { collectTaskSectionTags } from "./agenda-sections";

const section = (tagId: string, name = tagId) => ({
  type: "agenda-section",
  tag: "h3",
  tagId,
  name,
  color: null,
  children: [{ type: "text", text: name }],
});

const task = (taskId: string) => ({ type: "task", taskId, children: [] });

const para = (text = "note to self") => ({
  type: "paragraph",
  children: [{ type: "text", text }],
});

const list = (...children: unknown[]) => ({
  type: "list",
  children: [{ type: "listitem", children }],
});

const root = (...children: unknown[]) => ({ type: "root", children });

describe("collectTaskSectionTags", () => {
  it("maps root-level tasks to the section they sit under", () => {
    const map = collectTaskSectionTags(
      root(
        section("math"),
        task("t1"),
        para(),
        task("t2"),
        section("history"),
        task("t3"),
      ),
    );
    expect([...map]).toEqual([
      ["t1", "math"],
      ["t2", "math"],
      ["t3", "history"],
    ]);
  });

  it("finds a task nested inside a list under a section", () => {
    const map = collectTaskSectionTags(
      root(section("gym"), list(para(), task("t1"))),
    );
    expect(map.get("t1")).toBe("gym");
  });

  it("closes the section at a plain heading", () => {
    const map = collectTaskSectionTags(
      root(
        section("math"),
        task("t1"),
        { type: "heading", tag: "h2", children: [{ type: "text", text: "Misc" }] },
        task("t2"),
      ),
    );
    expect(map.get("t1")).toBe("math");
    expect(map.has("t2")).toBe(false);
  });

  it("closes the section at a collapsible or log heading too", () => {
    const map = collectTaskSectionTags(
      root(
        section("math"),
        { type: "collapsible-heading", tag: "h3", children: [] },
        task("t1"),
        section("gym"),
        { type: "log-heading", tag: "h2", logId: "l1", noteId: "n1", children: [] },
        task("t2"),
      ),
    );
    expect(map.size).toBe(0);
  });

  it("leaves a task written before any section unmapped", () => {
    const map = collectTaskSectionTags(
      root(para(), task("t1"), section("math"), task("t2")),
    );
    expect(map.has("t1")).toBe(false);
    expect(map.get("t2")).toBe("math");
  });

  it("ignores an agenda-section with no usable tagId", () => {
    const map = collectTaskSectionTags(
      root(
        section("math"),
        { type: "agenda-section", tag: "h3", tagId: "", children: [] },
        task("t1"),
      ),
    );
    expect(map.size).toBe(0);
  });

  it("keeps the first section a repeated task id appears under", () => {
    const map = collectTaskSectionTags(
      root(section("math"), task("t1"), section("gym"), task("t1")),
    );
    expect(map.get("t1")).toBe("math");
  });

  it("only lets TOP-LEVEL headings open a section", () => {
    const map = collectTaskSectionTags(
      root(list(section("math"), task("t1")), task("t2")),
    );
    expect(map.size).toBe(0);
  });

  it("returns an empty map for malformed input", () => {
    for (const bad of [
      null,
      undefined,
      "root",
      42,
      {},
      { children: null },
      { children: [null, 7, "x"] },
      root(section("math"), { type: "paragraph" }, { type: "task" }),
      root(section("math"), { type: "task", taskId: 5 }),
    ]) {
      expect(collectTaskSectionTags(bad).size).toBe(0);
    }
  });
});
