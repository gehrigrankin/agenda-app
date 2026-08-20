import type { SerializedEditorState } from "lexical";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearUnsavedStash, readUnsavedStash, writeUnsavedStash } from "./unsaved-stash";

// The stash is the app's only recovery path when a save fails — network
// drop, a deploy that ages out the tab's server actions, or anything else
// that leaves the browser holding content the server never got. There's no
// jsdom/testing-library in this repo, so these exercise the stash functions
// directly (the actual recovery mechanism) rather than rendering the
// autosave hook.

function state(text: string): SerializedEditorState {
  return { root: { type: "root", text } } as unknown as SerializedEditorState;
}

class MemoryStorage implements Storage {
  [key: string]: unknown;
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("unsaved stash round trip", () => {
  it("returns null when nothing has been stashed for the note", () => {
    expect(readUnsavedStash("note-1")).toBeNull();
  });

  it("reads back exactly what was written, including the timestamp", () => {
    vi.setSystemTime(1_700_000_000_000);
    writeUnsavedStash("note-1", state("the words the server never got"));

    const stash = readUnsavedStash("note-1");
    expect(stash).not.toBeNull();
    expect(stash?.at).toBe(1_700_000_000_000);
    expect(stash?.content).toEqual(state("the words the server never got"));
  });

  it("keeps stashes for different notes isolated (network failure mid-session, multiple tabs open)", () => {
    writeUnsavedStash("note-a", state("note a content"));
    writeUnsavedStash("note-b", state("note b content"));

    expect(readUnsavedStash("note-a")?.content).toEqual(state("note a content"));
    expect(readUnsavedStash("note-b")?.content).toEqual(state("note b content"));

    clearUnsavedStash("note-a");
    expect(readUnsavedStash("note-a")).toBeNull();
    expect(readUnsavedStash("note-b")?.content).toEqual(state("note b content"));
  });

  it("overwrites a prior failed stash with the latest attempt (deploy interrupts save, user keeps typing, another save fails)", () => {
    writeUnsavedStash("note-1", state("first failed attempt"));
    writeUnsavedStash("note-1", state("second failed attempt, superset of the first"));

    expect(readUnsavedStash("note-1")?.content).toEqual(
      state("second failed attempt, superset of the first"),
    );
  });
});

describe("recovery from a corrupted or partial write", () => {
  it("treats unparseable JSON as no stash rather than throwing (save cut off mid-write by a deploy or crash)", () => {
    localStorage.setItem("agenda.unsaved.note-1", '{"at":1700000000000,"content":{"root":{');
    expect(readUnsavedStash("note-1")).toBeNull();
  });

  it("rejects a stash missing its content field", () => {
    localStorage.setItem("agenda.unsaved.note-1", JSON.stringify({ at: Date.now() }));
    expect(readUnsavedStash("note-1")).toBeNull();
  });

  it("rejects a stash whose timestamp isn't a number", () => {
    localStorage.setItem(
      "agenda.unsaved.note-1",
      JSON.stringify({ at: "not-a-number", content: state("hi") }),
    );
    expect(readUnsavedStash("note-1")).toBeNull();
  });
});

describe("storage failures during recovery", () => {
  it("swallows a quota error on write instead of throwing out of the save-failure path (writeUnsavedStash never throws)", () => {
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });

    expect(() => writeUnsavedStash("note-1", state("too big to stash"))).not.toThrow();
    // The failed write never landed — nothing to offer back on reload.
    expect(readUnsavedStash("note-1")).toBeNull();
  });

  it("swallows a read error (private-mode storage access denied) and reports no stash", () => {
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new DOMException("Access denied", "SecurityError");
    });
    expect(readUnsavedStash("note-1")).toBeNull();
  });

  it("swallows a clear error instead of throwing out of the save-success path", () => {
    writeUnsavedStash("note-1", state("content"));
    vi.spyOn(storage, "removeItem").mockImplementation(() => {
      throw new DOMException("Access denied", "SecurityError");
    });
    expect(() => clearUnsavedStash("note-1")).not.toThrow();
  });
});

describe("clear on successful save", () => {
  it("removes the stash so a later reload doesn't offer stale content back", () => {
    writeUnsavedStash("note-1", state("content that later saved fine"));
    expect(readUnsavedStash("note-1")).not.toBeNull();

    clearUnsavedStash("note-1");
    expect(readUnsavedStash("note-1")).toBeNull();
  });

  it("clearing a note with no stash is a no-op", () => {
    expect(() => clearUnsavedStash("never-stashed")).not.toThrow();
    expect(readUnsavedStash("never-stashed")).toBeNull();
  });
});
