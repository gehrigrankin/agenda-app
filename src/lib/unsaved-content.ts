import type { SerializedEditorState } from "lexical";

/** Reload-safe copy of editor content that has not been acknowledged yet. */
export interface UnsavedStash {
  at: number;
  content: SerializedEditorState;
}

const STASH_PREFIX = "agenda.unsaved.";

export function readUnsavedStash(stashId: string): UnsavedStash | null {
  try {
    const raw = localStorage.getItem(STASH_PREFIX + stashId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UnsavedStash;
    return typeof parsed?.at === "number" && parsed.content ? parsed : null;
  } catch {
    return null;
  }
}

export function clearUnsavedStash(stashId: string): void {
  try {
    localStorage.removeItem(STASH_PREFIX + stashId);
  } catch {
    // A stash we cannot clear is only ever offered, never applied silently.
  }
}

export function writeUnsavedStash(
  stashId: string,
  content: SerializedEditorState,
): void {
  try {
    localStorage.setItem(
      STASH_PREFIX + stashId,
      JSON.stringify({ at: Date.now(), content } satisfies UnsavedStash),
    );
  } catch {
    // Quota or private mode. The in-memory editor still holds the content;
    // this is recovery insurance, not the primary save mechanism.
  }
}
