"use client";

import {
  ListItemNode,
  type SerializedListItemNode,
} from "@lexical/list";
import {
  $applyNodeReplacement,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type Spread,
} from "lexical";

/**
 * ListItemNode + a persisted `collapsed` flag, for folding a bullet's nested
 * sublist. Registered as a node REPLACEMENT for ListItemNode in Editor.tsx,
 * so ListPlugin/markdown/indent operations (which create items through
 * $createListItemNode) produce this class and old docs upgrade on load.
 * Passes $isListItemNode, so all @lexical/list internals keep working.
 *
 * Lexical always wraps a nested sublist in its own <li> that immediately
 * FOLLOWS the row it belongs to, so hiding is pure CSS off this node's
 * `data-collapsed` attribute (see globals.css); the chevron affordance lives
 * in CollapsePlugin. A stale flag on a row whose sublist was removed is
 * harmless — nothing matches the CSS and no chevron renders.
 */

export type SerializedCollapsibleListItemNode = Spread<
  { collapsed: boolean },
  SerializedListItemNode
>;

export class CollapsibleListItemNode extends ListItemNode {
  __collapsed: boolean;

  static getType(): string {
    return "collapsible-listitem";
  }

  static clone(node: CollapsibleListItemNode): CollapsibleListItemNode {
    return new CollapsibleListItemNode(
      node.__value,
      node.__checked,
      node.__collapsed,
      node.__key,
    );
  }

  constructor(
    value?: number,
    checked?: boolean,
    collapsed = false,
    key?: NodeKey,
  ) {
    super(value, checked, key);
    this.__collapsed = collapsed;
  }

  /** Tolerates missing/malformed fields so hand-edited JSON never throws. */
  static importJSON(
    serializedNode: SerializedCollapsibleListItemNode,
  ): CollapsibleListItemNode {
    const node = $createCollapsibleListItemNode(
      typeof serializedNode.value === "number" ? serializedNode.value : undefined,
      typeof serializedNode.checked === "boolean"
        ? serializedNode.checked
        : undefined,
      serializedNode.collapsed === true,
    );
    node.setFormat(serializedNode.format);
    node.setIndent(serializedNode.indent);
    node.setDirection(serializedNode.direction);
    return node;
  }

  exportJSON(): SerializedCollapsibleListItemNode {
    return {
      ...super.exportJSON(),
      type: "collapsible-listitem",
      version: 1,
      collapsed: this.__collapsed,
    };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    if (this.__collapsed) dom.dataset.collapsed = "true";
    return dom;
  }

  updateDOM(
    prevNode: ListItemNode,
    dom: HTMLElement,
    config: EditorConfig,
  ): boolean {
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

export function $createCollapsibleListItemNode(
  value?: number,
  checked?: boolean,
  collapsed = false,
): CollapsibleListItemNode {
  return $applyNodeReplacement(
    new CollapsibleListItemNode(value, checked, collapsed),
  );
}

export function $isCollapsibleListItemNode(
  node: LexicalNode | null | undefined,
): node is CollapsibleListItemNode {
  return node instanceof CollapsibleListItemNode;
}
