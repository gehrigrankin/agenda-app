import { describe, expect, it } from "vitest";
import { reconcileDockTabs } from "./dock-tabs";

describe("reconcileDockTabs", () => {
  it("drops a checked id the live lookup doesn't know about", () => {
    const notes = [
      { id: "a", title: "Alpha" },
      { id: "b", title: "Beta" },
    ];
    const next = reconcileDockTabs(
      notes,
      new Set(["a", "b"]),
      new Map([["a", "Alpha"]]),
    );
    expect(next).toEqual([{ id: "a", title: "Alpha" }]);
  });

  it("keeps a live id and refreshes its title", () => {
    const notes = [{ id: "a", title: "Old title" }];
    const next = reconcileDockTabs(
      notes,
      new Set(["a"]),
      new Map([["a", "New title"]]),
    );
    expect(next).toEqual([{ id: "a", title: "New title" }]);
  });

  it("leaves ids outside the checked set untouched", () => {
    // A tab opened after the verification round-trip started (or any id the
    // caller didn't ask about) must survive: absence of an answer isn't
    // evidence the note is gone. A failed getNoteTitlesAction call goes
    // further and skips calling this function at all, for the same reason.
    const notes = [
      { id: "a", title: "Alpha" },
      { id: "b", title: "Beta" },
    ];
    const next = reconcileDockTabs(notes, new Set(), new Map());
    expect(next).toEqual(notes);
  });

  it("keeps a closed tab closed — an id already removed from `notes` cannot be resurrected by the live map", () => {
    // Simulates: tab "b" was closed (removed from `notes`) before the
    // verification round-trip resolved. Even though "b" comes back live, it's
    // simply absent from the input and has no way back in.
    const notes = [{ id: "a", title: "Alpha" }];
    const next = reconcileDockTabs(
      notes,
      new Set(["a", "b"]),
      new Map([
        ["a", "Alpha"],
        ["b", "Beta"],
      ]),
    );
    expect(next).toEqual([{ id: "a", title: "Alpha" }]);
    expect(next.some((n) => n.id === "b")).toBe(false);
  });

  it("returns an empty list when every checked tab is dead", () => {
    const notes = [
      { id: "a", title: "Alpha" },
      { id: "b", title: "Beta" },
    ];
    const next = reconcileDockTabs(notes, new Set(["a", "b"]), new Map());
    expect(next).toEqual([]);
  });
});
