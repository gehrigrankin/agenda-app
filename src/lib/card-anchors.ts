import type { SerializedEditorState, SerializedLexicalNode } from "lexical";

import { logSectionText } from "./note-logs";

/**
 * Card anchors: the marker a linked-note card drops on the note it embeds.
 *
 * Inserting a linked-note card appends a `card-anchor` block to the TARGET
 * note, and the card's body shows only the blocks that FOLLOW that marker.
 * So the anchor isn't decoration — it's the boundary that decides which part
 * of somebody else's note you are writing into.
 *
 * The subtlety is the same one `note-logs` deals with: a section is implied by
 * document order, not by nesting. Nothing in the saved JSON puts the section's
 * blocks inside the anchor. An anchor owns every following TOP-LEVEL block
 * until the next `card-anchor` or the end of the document — including
 * headings, which do NOT close it. Two cards on one note must never be able to
 * claim the same paragraph, so the only thing that ends a section is the next
 * anchor.
 *
 * Only top-level children are considered, and an anchor nested inside a list
 * or quote is invisible here: it has no well-defined "following siblings at
 * document level", so a card scoped to one would grow and shrink with the
 * nesting around it.
 *
 * Malformed input is tolerated rather than thrown on — this reads JSONB that
 * older notes wrote, and a missing `root.children` just means "no anchors".
 *
 * Pure: no DB, no Lexical runtime. The caller persists the result.
 */

/** Serialized type emitted by CardAnchorNode.exportJSON. */
export const CARD_ANCHOR_TYPE = "card-anchor";

interface MaybeAnchor {
  type?: unknown;
  anchorId?: unknown;
  children?: unknown;
}

/**
 * Block types that mean something even with no text in them. `logSectionText`
 * sees an image, a task chip with an empty title or a rule as empty output,
 * but a user who dropped a screenshot into a card's section has written in it.
 * A nested `card-anchor` or `linked-note-card` is structure somebody else
 * depends on, so it is never ours to sweep away either.
 */
const MEANINGFUL_WHEN_TEXTLESS = new Set([
  "image",
  "task",
  "horizontalrule",
  "linked-note-card",
  CARD_ANCHOR_TYPE,
]);

function isCardAnchor(node: MaybeAnchor): boolean {
  return node.type === CARD_ANCHOR_TYPE;
}

function rootChildren(
  state: SerializedEditorState | null | undefined,
): SerializedLexicalNode[] | null {
  const root = (state as { root?: MaybeAnchor } | null | undefined)?.root;
  const children = root?.children;
  return Array.isArray(children) ? (children as SerializedLexicalNode[]) : null;
}

/**
 * Index of the anchor block with this id in `root.children`, or -1.
 *
 * A blank id never matches: an anchor that failed to mint an id serializes as
 * `anchorId: ""`, and matching "" against "" would let one broken card scope
 * itself to another broken card's section.
 */
export function findCardAnchorIndex(
  state: SerializedEditorState | null | undefined,
  anchorId: string,
): number {
  if (typeof anchorId !== "string" || anchorId.trim().length === 0) return -1;
  const children = rootChildren(state);
  if (!children) return -1;

  return children.findIndex((raw) => {
    const block = raw as SerializedLexicalNode & MaybeAnchor;
    return isCardAnchor(block) && block.anchorId === anchorId;
  });
}

/**
 * Half-open range of the blocks an anchor owns: `[start, end)` into
 * `root.children`, where `start` is the block right after the anchor and `end`
 * is the next anchor (or the end of the document). `start === end` for an
 * anchor with nothing under it yet — a real, empty section, not a missing one.
 * null means the anchor isn't in this note at all.
 */
export function cardAnchorSectionRange(
  state: SerializedEditorState | null | undefined,
  anchorId: string,
): { start: number; end: number } | null {
  const index = findCardAnchorIndex(state, anchorId);
  if (index < 0) return null;

  // `findCardAnchorIndex` already proved children is an array.
  const children = rootChildren(state) as SerializedLexicalNode[];
  const start = index + 1;
  let end = children.length;
  for (let i = start; i < children.length; i += 1) {
    if (isCardAnchor(children[i] as SerializedLexicalNode & MaybeAnchor)) {
      end = i;
      break;
    }
  }
  // A malformed, id-less anchor still ends the section it meets: it renders as
  // a divider, so treating it as invisible would hand one card the blocks that
  // visibly belong to the next.
  return { start, end };
}

/**
 * True when these blocks carry nothing the user put there.
 *
 * Text is the main test — `logSectionText` is the same reader the Logs panel
 * uses, so "blank" here means blank the way the rest of the app measures it —
 * but text alone would call an image or a task chip empty, hence the
 * meaningful-when-textless set.
 */
export function isBlankBlocks(blocks: SerializedLexicalNode[]): boolean {
  if (!Array.isArray(blocks) || blocks.length === 0) return true;
  if (blocks.some((b) => hasMeaningfulType(b))) return false;
  return logSectionText(blocks).trim().length === 0;
}

/** Depth-first: an image inside a paragraph or list still counts. */
function hasMeaningfulType(raw: SerializedLexicalNode): boolean {
  const node = raw as SerializedLexicalNode & MaybeAnchor;
  if (MEANINGFUL_WHEN_TEXTLESS.has(node.type as string)) return true;
  const children = node.children;
  if (!Array.isArray(children)) return false;
  return (children as SerializedLexicalNode[]).some(hasMeaningfulType);
}

/** A fresh empty paragraph block, minted per call so callers can't alias it. */
const emptyParagraph = (): SerializedLexicalNode =>
  ({
    type: "paragraph",
    children: [],
    direction: null,
    format: "",
    indent: 0,
    version: 1,
  }) as unknown as SerializedLexicalNode;

/**
 * Drop an anchor and its section when the section was never written in.
 *
 * Returns a NEW state (the input is never mutated) or `null` meaning "nothing
 * to do" — the anchor is gone, or its section holds real content and stays.
 * Deleting a card must not strand an empty divider on the target note, but it
 * must never take words with it either, so "blank" is the whole condition.
 */
export function pruneEmptyCardAnchor(
  state: SerializedEditorState | null | undefined,
  anchorId: string,
): SerializedEditorState | null {
  const range = cardAnchorSectionRange(state, anchorId);
  if (!range) return null;

  const children = rootChildren(state) as SerializedLexicalNode[];
  const section = children.slice(range.start, range.end);
  if (!isBlankBlocks(section)) return null;

  const anchorIndex = range.start - 1;
  const next = [
    ...children.slice(0, anchorIndex),
    ...children.slice(range.end),
  ];
  // A childless root is not a document Lexical will reopen, and pruning the
  // only thing in a note is exactly how you'd get one. Leave the empty
  // paragraph every fresh note starts with.
  if (next.length === 0) next.push(emptyParagraph());

  const root = (state as unknown as { root: object }).root;
  return {
    ...(state as SerializedEditorState),
    root: { ...root, children: next },
  } as unknown as SerializedEditorState;
}
