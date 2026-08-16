import { deepEqual } from "./deep-equal";

/**
 * Whether Lexical's first change notification is only its mount-time
 * normalization of the loaded document. A structurally different first event
 * is a real edit and must be saved.
 */
export function isLoadedEditorContent(
  current: unknown,
  loaded: unknown | null,
): boolean {
  return loaded === null || deepEqual(current, loaded);
}

/** Local-recovery namespace for one scoped section, isolated from its note. */
export function cardSectionStashId(noteId: string, anchorId: string): string {
  return `card.${noteId}.${anchorId}`;
}
