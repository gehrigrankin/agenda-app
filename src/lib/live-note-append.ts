import type { SerializedEditorState } from "lexical";

import { docFromBlocks } from "./lexical-build";

/**
 * Live-editor registry + serialized-document splice for selection-toolbar
 * moves. A move writes the target note on the server, then (if that note has
 * a mounted editor) appends the same blocks into it so a later autosave of
 * the pre-move document cannot overwrite the landing. Daily-window caches
 * listen for `NOTE_CONTENT_EXTERNALLY_CHANGED` and drop the stale day.
 */

export const NOTE_CONTENT_EXTERNALLY_CHANGED = "agenda:note-content-externally-changed";

type AppendHandler = (blocks: unknown[]) => void;

const appenders = new Map<string, AppendHandler>();

/** Register the writable editor currently mounted for `noteId`. */
export function registerLiveNoteAppender(
  noteId: string,
  append: AppendHandler,
): () => void {
  appenders.set(noteId, append);
  return () => {
    if (appenders.get(noteId) === append) appenders.delete(noteId);
  };
}

/** Append into a live editor if one is mounted. Returns whether it did. */
export function appendToLiveNote(noteId: string, blocks: unknown[]): boolean {
  const append = appenders.get(noteId);
  if (!append) return false;
  append(blocks);
  return true;
}

export function notifyNoteContentChanged(noteId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(NOTE_CONTENT_EXTERNALLY_CHANGED, { detail: { noteId } }),
  );
}

/**
 * Splice already-serialized top-level blocks onto a Lexical document.
 * Does not mutate `content` — callers that hold a cached copy stay clean.
 */
export function appendBlocksToSerializedState(
  content: SerializedEditorState | null | undefined,
  blocks: unknown[],
): SerializedEditorState {
  const base = (content ?? docFromBlocks([])) as SerializedEditorState;
  const root = base.root as unknown as { children?: unknown[] };
  const children = Array.isArray(root.children) ? root.children : [];
  return {
    ...base,
    root: {
      ...base.root,
      children: [...children, ...blocks],
    },
  } as SerializedEditorState;
}
