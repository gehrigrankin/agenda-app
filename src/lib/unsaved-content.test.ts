import type { SerializedEditorState } from "lexical";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearUnsavedStash,
  readUnsavedStash,
  writeUnsavedStash,
} from "./unsaved-content";

const content = {
  root: { type: "root", version: 1, children: [] },
} as unknown as SerializedEditorState;

describe("unsaved content recovery", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("round-trips unacknowledged editor content across a reload", () => {
    writeUnsavedStash("note-1", content);

    expect(readUnsavedStash("note-1")).toMatchObject({ content });
    expect(readUnsavedStash("note-1")?.at).toEqual(expect.any(Number));
  });

  it("keeps independent editor recovery keys isolated", () => {
    writeUnsavedStash("note-1", content);
    writeUnsavedStash("card.note-1.anchor-1", content);
    clearUnsavedStash("note-1");

    expect(readUnsavedStash("note-1")).toBeNull();
    expect(readUnsavedStash("card.note-1.anchor-1")).not.toBeNull();
  });
});
