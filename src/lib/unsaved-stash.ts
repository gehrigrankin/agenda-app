import type { SerializedEditorState } from "lexical";

/**
 * Content the server refused, parked in localStorage.
 *
 * A save can fail for reasons the app can't fix from here — the tab is running
 * a bundle older than the current deployment and its server actions 404, the
 * network is gone, the session expired. Whatever the cause, the words are in
 * the browser and nowhere else, and the user's next move (reload) destroys
 * them. So a failed save writes the document here, and the editor offers it
 * back on the next load. localStorage, not session: surviving the reload is
 * the entire point.
 *
 * Pure and framework-free (no "use client", no server-action imports) so it
 * can be unit tested directly — see unsaved-stash.test.ts.
 */
export interface UnsavedStash {
  /** Epoch ms of the failed attempt. */
  at: number;
  content: SerializedEditorState;
}

const STASH_PREFIX = "agenda.unsaved.";

export function readUnsavedStash(noteId: string): UnsavedStash | null {
  try {
    const raw = localStorage.getItem(STASH_PREFIX + noteId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UnsavedStash;
    return typeof parsed?.at === "number" && parsed.content
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function clearUnsavedStash(noteId: string): void {
  try {
    localStorage.removeItem(STASH_PREFIX + noteId);
  } catch {
    // Nothing to do — a stash we can't clear is only ever offered, never applied.
  }
}

export function writeUnsavedStash(noteId: string, content: SerializedEditorState): void {
  try {
    localStorage.setItem(
      STASH_PREFIX + noteId,
      JSON.stringify({ at: Date.now(), content } satisfies UnsavedStash),
    );
  } catch {
    // Quota or private mode. The in-memory editor still holds the content;
    // this is insurance, not the mechanism.
  }
}
