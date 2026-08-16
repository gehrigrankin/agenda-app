import { describe, expect, it } from "vitest";

import {
  beginSaveVersion,
  isCurrentSaveVersion,
} from "./use-save-retry";

describe("save retry versions", () => {
  it("marks an in-flight save stale as soon as a newer save is queued", () => {
    const versions = new Map<"content" | "title", number>();
    const first = beginSaveVersion(versions, "content");
    const second = beginSaveVersion(versions, "content");

    expect(isCurrentSaveVersion(versions, "content", first)).toBe(false);
    expect(isCurrentSaveVersion(versions, "content", second)).toBe(true);
  });

  it("tracks title and content save streams independently", () => {
    const versions = new Map<"content" | "title", number>();
    const content = beginSaveVersion(versions, "content");
    const title = beginSaveVersion(versions, "title");

    expect(isCurrentSaveVersion(versions, "content", content)).toBe(true);
    expect(isCurrentSaveVersion(versions, "title", title)).toBe(true);
  });
});
