import { describe, expect, it } from "vitest";
import { pickTabFallback } from "./tab-fallback";

const tabs = (...ids: string[]) => ids.map((id) => ({ id }));

describe("pickTabFallback", () => {
  it("focuses the tab that took the closed one's place", () => {
    expect(pickTabFallback(tabs("a", "b", "c"), "b")).toBe("c");
  });

  it("falls back to the previous tab when the closed one was last", () => {
    expect(pickTabFallback(tabs("a", "b", "c"), "c")).toBe("b");
  });

  it("focuses the tab that slid into the first slot when the first tab closes", () => {
    expect(pickTabFallback(tabs("a", "b", "c"), "a")).toBe("b");
  });

  it("returns null when the last remaining tab is closed", () => {
    expect(pickTabFallback(tabs("solo"), "solo")).toBe(null);
  });

  it("returns null when the id isn't in the tab list", () => {
    expect(pickTabFallback(tabs("a", "b"), "missing")).toBe(null);
  });

  it("wraps to the new last tab when closing the first of two", () => {
    expect(pickTabFallback(tabs("a", "b"), "a")).toBe("b");
  });
});
