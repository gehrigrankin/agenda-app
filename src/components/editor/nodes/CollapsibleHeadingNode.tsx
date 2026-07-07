"use client";

import {
  HeadingNode,
  type HeadingTagType,
  type SerializedHeadingNode,
} from "@lexical/rich-text";
import {
  $applyNodeReplacement,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type Spread,
} from "lexical";

/**
 * HeadingNode + a persisted `collapsed` flag. Registered as a node
 * REPLACEMENT for HeadingNode in Editor.tsx (the TimedParagraphNode pattern),
 * so every creation path — `#` markdown shortcut, slash menu, toolbar's
 * $setBlocksType — produces this class, and old docs upgrade transparently on
 * load (HeadingNode.importJSON goes through $createHeadingNode, which the
 * replacement intercepts). Passes $isHeadingNode, so heading-shaped logic
 * everywhere keeps working.
 *
 * The node only carries state + a `data-collapsed` DOM attribute; hiding the
 * section (following blocks until the next same-or-higher heading) and the
 * gutter chevron live in CollapsePlugin/globals.css.
 */

export type SerializedCollapsibleHeadingNode = Spread<
  { collapsed: boolean },
  SerializedHeadingNode
>;

const HEADING_TAGS: readonly HeadingTagType[] = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
];

export class CollapsibleHeadingNode extends HeadingNode {
  __collapsed: boolean;

  static getType(): string {
    return "collapsible-heading";
  }

  static clone(node: CollapsibleHeadingNode): CollapsibleHeadingNode {
    return new CollapsibleHeadingNode(
      node.__tag,
      node.__collapsed,
      node.__key,
    );
  }

  constructor(tag: HeadingTagType, collapsed = false, key?: NodeKey) {
    super(tag, key);
    this.__collapsed = collapsed;
  }

  /** Tolerates missing/malformed fields so hand-edited JSON never throws. */
  static importJSON(
    serializedNode: SerializedCollapsibleHeadingNode,
  ): CollapsibleHeadingNode {
    const node = $createCollapsibleHeadingNode(
      HEADING_TAGS.includes(serializedNode.tag) ? serializedNode.tag : "h1",
      serializedNode.collapsed === true,
    );
    node.setFormat(serializedNode.format);
    node.setIndent(serializedNode.indent);
    node.setDirection(serializedNode.direction);
    return node;
  }

  exportJSON(): SerializedCollapsibleHeadingNode {
    return {
      ...super.exportJSON(),
      type: "collapsible-heading",
      version: 1,
      collapsed: this.__collapsed,
    };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    if (this.__collapsed) dom.dataset.collapsed = "true";
    return dom;
  }

  updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean {
    const recreate = super.updateDOM(prevNode, dom, config);
    if (!recreate) {
      if (this.__collapsed) dom.dataset.collapsed = "true";
      else delete dom.dataset.collapsed;
    }
    return recreate;
  }

  getCollapsed(): boolean {
    return this.getLatest().__collapsed;
  }

  setCollapsed(collapsed: boolean): void {
    this.getWritable().__collapsed = collapsed;
  }
}

export function $createCollapsibleHeadingNode(
  tag: HeadingTagType,
  collapsed = false,
): CollapsibleHeadingNode {
  return $applyNodeReplacement(new CollapsibleHeadingNode(tag, collapsed));
}

export function $isCollapsibleHeadingNode(
  node: LexicalNode | null | undefined,
): node is CollapsibleHeadingNode {
  return node instanceof CollapsibleHeadingNode;
}
