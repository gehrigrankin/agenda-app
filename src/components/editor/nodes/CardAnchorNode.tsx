"use client";

import type { JSX } from "react";
import { useContext } from "react";
import { useRouter } from "next/navigation";
import {
  $applyNodeReplacement,
  DecoratorNode,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import { CornerDownRight } from "lucide-react";

import { QuickViewContext } from "@/components/notes/NotePreviewProvider";
import { CARD_ANCHOR_TYPE } from "@/lib/card-anchors";

/**
 * The marker a linked-note card leaves on the note it embeds.
 *
 * Inserting a card into note A appends one of these to note B, and the card's
 * body then edits only the blocks that FOLLOW it. So this node is a boundary,
 * not decoration — `src/lib/card-anchors.ts` is the reader that turns it into
 * a range, and its header explains why a heading does not close a section.
 *
 * On note B itself the anchor renders as a labelled rule: without it you would
 * open a note and find paragraphs you have no memory of writing there, with
 * nothing saying they were typed from somewhere else. `sourceTitle` is a
 * snapshot from insert time (same convention as the card's own `title`) —
 * cheap to render, and stale only in the label.
 *
 * Deliberately NOT a `HorizontalRuleNode` subclass: the rule is a thing users
 * insert and delete freely, and an anchor that vanished on a stray Backspace
 * would silently unscope a card.
 */

export type SerializedCardAnchorNode = Spread<
  {
    anchorId: string;
    sourceNoteId: string;
    sourceTitle: string;
  },
  SerializedLexicalNode
>;

export class CardAnchorNode extends DecoratorNode<JSX.Element> {
  __anchorId: string;
  __sourceNoteId: string;
  __sourceTitle: string;

  static getType(): string {
    return CARD_ANCHOR_TYPE;
  }

  static clone(node: CardAnchorNode): CardAnchorNode {
    return new CardAnchorNode(
      node.__anchorId,
      node.__sourceNoteId,
      node.__sourceTitle,
      node.__key,
    );
  }

  constructor(
    anchorId = "",
    sourceNoteId = "",
    sourceTitle = "",
    key?: NodeKey,
  ) {
    super(key);
    this.__anchorId = anchorId;
    this.__sourceNoteId = sourceNoteId;
    this.__sourceTitle = sourceTitle;
  }

  /** Tolerates missing/malformed fields so hand-edited JSON never throws. */
  static importJSON(serialized: SerializedCardAnchorNode): CardAnchorNode {
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    return $createCardAnchorNode({
      anchorId: str(serialized.anchorId),
      sourceNoteId: str(serialized.sourceNoteId),
      sourceTitle: str(serialized.sourceTitle),
    });
  }

  exportJSON(): SerializedCardAnchorNode {
    return {
      ...super.exportJSON(),
      type: CARD_ANCHOR_TYPE,
      version: 1,
      anchorId: this.__anchorId,
      sourceNoteId: this.__sourceNoteId,
      sourceTitle: this.__sourceTitle,
    };
  }

  createDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "my-3";
    return el;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): false {
    return false;
  }

  /**
   * Empty on purpose. The anchor contributes no words, so plain-text readers
   * (`lexicalToPlainText`, the Logs panel, search excerpts) skip it — while
   * `isBlankBlocks` still counts it as structure worth keeping.
   */
  getTextContent(): string {
    return "";
  }

  getAnchorId(): string {
    return this.__anchorId;
  }

  decorate(): JSX.Element {
    return (
      <CardAnchorRule
        sourceNoteId={this.__sourceNoteId}
        sourceTitle={this.__sourceTitle}
      />
    );
  }
}

export function $createCardAnchorNode(fields: {
  anchorId: string;
  sourceNoteId: string;
  sourceTitle: string;
}): CardAnchorNode {
  return $applyNodeReplacement(
    new CardAnchorNode(
      fields.anchorId,
      fields.sourceNoteId,
      fields.sourceTitle,
    ),
  );
}

export function $isCardAnchorNode(
  node: LexicalNode | null | undefined,
): node is CardAnchorNode {
  return node instanceof CardAnchorNode;
}

/** A rule with a label saying which note the blocks below were written from. */
function CardAnchorRule({
  sourceNoteId,
  sourceTitle,
}: {
  sourceNoteId: string;
  sourceTitle: string;
}) {
  const router = useRouter();
  const quickView = useContext(QuickViewContext);
  const label = sourceTitle || "another note";

  const open = () => {
    if (!sourceNoteId) return;
    if (quickView) quickView.open(sourceNoteId);
    else router.push(`/app/notes/${sourceNoteId}`);
  };

  return (
    <div
      contentEditable={false}
      onMouseDown={(e) => e.stopPropagation()}
      className="flex select-none items-center gap-2"
    >
      <CornerDownRight className="h-3 w-3 flex-none text-ink-600" />
      <span className="flex-none text-[0.65625rem] leading-none text-ink-600">
        from
      </span>
      {sourceNoteId ? (
        <button
          type="button"
          onClick={open}
          title={`Open ${label} in a window`}
          className="max-w-[14rem] flex-none truncate text-[0.65625rem] leading-none text-ink-500 underline-offset-2 hover:text-steel hover:underline"
        >
          {label}
        </button>
      ) : (
        <span className="max-w-[14rem] flex-none truncate text-[0.65625rem] leading-none text-ink-500">
          {label}
        </span>
      )}
      <span className="h-px min-w-0 flex-1 bg-white/7" />
    </div>
  );
}
