import { describe, expect, it } from "vitest";

import {
  EMPTY_PANES,
  activateTab,
  closeTab,
  focusedNote,
  fromLegacyTabs,
  openNote,
  paneOf,
  parsePanes,
  retainNotes,
  split,
  unsplit,
  type PanesState,
} from "./editor-panes";

const ids = (s: PanesState) => s.panes.map((p) => p.tabs.map((t) => t.id));

describe("editor panes", () => {
  it("opens tabs in the focused pane and refocuses existing ones", () => {
    let s = openNote(EMPTY_PANES, "a", "A");
    s = openNote(s, "b", "B");
    s = openNote(s, "a");
    expect(ids(s)).toEqual([["a", "b"]]);
    expect(focusedNote(s)).toBe("a");
  });

  it("⌥-click opens in the other pane, splitting if needed, and moves the tab", () => {
    let s = openNote(EMPTY_PANES, "a", "A");
    s = openNote(s, "b", "B");
    s = openNote(s, "a", undefined, "other");
    expect(ids(s)).toEqual([["b"], ["a"]]);
    expect(s.focused).toBe(1);
    expect(s.panes[1].tabs[0].title).toBe("A");
    // A note never lives in two panes: moving the only tab of a pane over
    // collapses the split.
    s = openNote(s, "a", undefined, "other");
    expect(ids(s)).toEqual([["b", "a"]]);
    expect(paneOf(s, "a")).toBe(0);
  });

  it("split moves another tab into the new pane; unsplit merges", () => {
    let s = openNote(EMPTY_PANES, "a");
    s = openNote(s, "b");
    s = openNote(s, "c");
    s = split(s);
    expect(ids(s)).toEqual([["a", "c"], ["b"]]);
    expect(focusedNote(s)).toBe("b");
    s = unsplit(s);
    expect(ids(s)).toEqual([["a", "c", "b"]]);
    expect(focusedNote(s)).toBe("b");
  });

  it("closing the last tab of a split pane collapses the split", () => {
    let s = openNote(EMPTY_PANES, "a");
    s = openNote(s, "b", undefined, "other");
    s = closeTab(s, 1, "b");
    expect(ids(s)).toEqual([["a"]]);
    expect(s.focused).toBe(0);
  });

  it("closing focuses the neighbour", () => {
    let s = openNote(EMPTY_PANES, "a");
    s = openNote(s, "b");
    s = openNote(s, "c");
    s = activateTab(s, 0, "b");
    s = closeTab(s, 0, "b");
    expect(focusedNote(s)).toBe("c");
  });

  it("drops dead notes and parses defensively", () => {
    let s = openNote(EMPTY_PANES, "a");
    s = openNote(s, "b", undefined, "other");
    s = retainNotes(s, new Set(["a"]));
    expect(ids(s)).toEqual([["a"]]);
    expect(parsePanes("junk")).toEqual(EMPTY_PANES);
    const restored = parsePanes({
      panes: [
        { tabs: [{ id: "a" }, { id: "b", title: "B" }], active: "b" },
        { tabs: [{ id: "a" }], active: "a" },
      ],
      ratio: 9,
    });
    expect(ids(restored)).toEqual([["a", "b"]]);
    expect(restored.ratio).toBe(0.8);
    expect(ids(fromLegacyTabs({ tabs: [{ id: "x", title: "X" }] }))).toEqual([
      ["x"],
    ]);
  });
});
