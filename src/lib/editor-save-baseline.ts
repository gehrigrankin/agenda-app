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

/**
 * Printed agenda section headings are the day's ruling, not writing. An empty
 * editor after a failed Lexical hydrate, or that empty editor after the daily
 * plugin prints sections onto it, has no user content.
 */
const RULING_TYPES = new Set(["agenda-section"]);
const CONTENT_DECORATOR_TYPES = new Set([
  "task",
  "image",
  "ink",
  "linked-note-card",
  "card-anchor",
  "horizontalrule",
  "note-link",
]);

function nodeHasUserContent(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as {
    type?: unknown;
    text?: unknown;
    title?: unknown;
    children?: unknown;
  };
  if (typeof n.type === "string" && RULING_TYPES.has(n.type)) return false;
  if (typeof n.type === "string" && CONTENT_DECORATOR_TYPES.has(n.type)) {
    return true;
  }
  if (typeof n.text === "string" && n.text.trim().length > 0) return true;
  if (typeof n.title === "string" && n.title.trim().length > 0) return true;
  return Array.isArray(n.children) && n.children.some(nodeHasUserContent);
}

/**
 * True when `state` holds writing (text, tasks, images, cards) rather than an
 * empty document or printed-only agenda ruling. Accepts a full Lexical
 * document or a `root.children` array (card sections).
 */
export function editorDocumentHasUserContent(state: unknown): boolean {
  if (state == null) return false;
  if (Array.isArray(state)) return state.some(nodeHasUserContent);
  if (typeof state === "object" && "root" in state) {
    return nodeHasUserContent((state as { root?: unknown }).root);
  }
  return nodeHasUserContent(state);
}

/**
 * First OnChange after Lexical failed to hydrate stored content: the live
 * editor is empty (or ruling-only) while the loaded document still has
 * writing. Must not be persisted — that would wipe the note.
 */
export function isHydrateFallbackChange(
  current: unknown,
  loaded: unknown | null,
): boolean {
  if (loaded == null) return false;
  return (
    editorDocumentHasUserContent(loaded) &&
    !editorDocumentHasUserContent(current)
  );
}

export type FirstEditorChangeDecision = {
  /** Skip the save: mount normalization or a failed-hydrate empty editor. */
  absorb: boolean;
  /** Live editor is a failed-hydrate stand-in; ignore later plugin writes too. */
  hydrateFallback: boolean;
  /** Confirmed document to restore if a later save fails. */
  baseline: string;
};

/**
 * What to do with Lexical's first change event for a note. A failed hydrate
 * keeps the loaded document as the baseline and must not save.
 */
export function firstEditorChangeDecision(
  current: unknown,
  loaded: unknown | null,
): FirstEditorChangeDecision {
  if (isHydrateFallbackChange(current, loaded)) {
    return {
      absorb: true,
      hydrateFallback: true,
      baseline: JSON.stringify(loaded) ?? "null",
    };
  }
  return {
    absorb: isLoadedEditorContent(current, loaded),
    hydrateFallback: false,
    baseline: initialSaveBaseline(current, loaded),
  };
}

/**
 * Baseline to restore when the first real save fails. If the first Lexical
 * event is already an edit, the confirmed baseline is the loaded document,
 * not that edited event.
 */
export function initialSaveBaseline(
  current: unknown,
  loaded: unknown | null,
): string {
  return (
    JSON.stringify(
      isLoadedEditorContent(current, loaded) ? current : (loaded ?? current),
    ) ?? "null"
  );
}

/** Local-recovery namespace for one scoped section, isolated from its note. */
export function cardSectionStashId(noteId: string, anchorId: string): string {
  return `card.${noteId}.${anchorId}`;
}
