"use client";

import {
  $applyNodeReplacement,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type Spread,
} from "lexical";

import {
  CollapsibleHeadingNode,
  type SerializedCollapsibleHeadingNode,
} from "./CollapsibleHeadingNode";

/**
 * A printed subject line of the agenda page. The owner's pinned tags ("agenda
 * lines" — Work, Gym, Errands) are the subjects of every day; this node is one
 * of them printed INTO the daily note, so the day's page arrives ruled and you
 * write underneath the label instead of filing into a widget.
 *
 * Extends CollapsibleHeadingNode, like LogHeadingNode and for the same reason:
 * a section owns exactly the blocks that follow it up to the next same-or-
 * higher heading, and that is precisely what CollapsePlugin already folds. So
 * "what belongs to this subject" and "what the fold hides" are one definition
 * rather than two that can drift. The tag is always `h3` — a subject label is
 * a fixed rank on the page, not a level the user picks.
 *
 * Identity is `tagId`, never the heading's text: the text is ordinary editable
 * children (the plugin seeds it with the tag's name), so retitling the line on
 * the page never repoints it at a different tag. The server side reads that id
 * — reconcileNoteTasks (added concurrently) tags the tasks written under a
 * section with its tag — which only works because the id survives the rename.
 */

export type SerializedAgendaSectionNode = Spread<
  { tagId: string; name: string; color: string | null },
  SerializedCollapsibleHeadingNode
>;

export class AgendaSectionNode extends CollapsibleHeadingNode {
  __tagId: string;
  __name: string;
  __color: string | null;

  static getType(): string {
    return "agenda-section";
  }

  static clone(node: AgendaSectionNode): AgendaSectionNode {
    return new AgendaSectionNode(
      node.__tagId,
      node.__name,
      node.__color,
      node.__collapsed,
      node.__key,
    );
  }

  constructor(
    tagId: string,
    name: string,
    color: string | null,
    collapsed = false,
    key?: NodeKey,
  ) {
    super("h3", collapsed, key);
    this.__tagId = tagId;
    this.__name = name;
    this.__color = color;
  }

  /** Tolerates missing/malformed fields so hand-edited JSON never throws. */
  static importJSON(
    serialized: SerializedAgendaSectionNode,
  ): AgendaSectionNode {
    return $createAgendaSectionNode(
      typeof serialized.tagId === "string" ? serialized.tagId : "",
      typeof serialized.name === "string" ? serialized.name : "",
      typeof serialized.color === "string" ? serialized.color : null,
      serialized.collapsed === true,
      // updateFromJSON restores every element field (incl. textFormat /
      // textStyle) that a hand-copied list of setters would drop. The tag is
      // forced: this node is always an h3, whatever the JSON claims.
    ).updateFromJSON({ ...serialized, tag: "h3" });
  }

  exportJSON(): SerializedAgendaSectionNode {
    return {
      ...super.exportJSON(),
      type: "agenda-section",
      version: 1,
      tagId: this.__tagId,
      name: this.__name,
      color: this.__color,
    };
  }

  private decorate(dom: HTMLElement): void {
    dom.dataset.sectionTag = this.__tagId;
    if (typeof this.__color === "string" && this.__color !== "") {
      dom.style.setProperty("--section-color", this.__color);
    } else {
      dom.style.removeProperty("--section-color");
    }
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    dom.classList.add("agenda-section");
    this.decorate(dom);
    return dom;
  }

  updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean {
    const recreate = super.updateDOM(prevNode, dom, config);
    if (!recreate) {
      dom.classList.add("agenda-section");
      this.decorate(dom);
    }
    return recreate;
  }

  getTagId(): string {
    return this.getLatest().__tagId;
  }

  getName(): string {
    return this.getLatest().__name;
  }

  getColor(): string | null {
    return this.getLatest().__color;
  }

  /**
   * Kept in sync with the pinned tag by AgendaSectionsPlugin when the line is
   * renamed/recolored in settings. These touch the node's own fields (and the
   * DOM through them) only — the heading's editable text is the user's.
   */
  setName(name: string): void {
    this.getWritable().__name = name;
  }

  setColor(color: string | null): void {
    this.getWritable().__color = color;
  }
}

export function $createAgendaSectionNode(
  tagId: string,
  name: string,
  color: string | null,
  collapsed = false,
): AgendaSectionNode {
  return $applyNodeReplacement(
    new AgendaSectionNode(tagId, name, color, collapsed),
  );
}

export function $isAgendaSectionNode(
  node: LexicalNode | null | undefined,
): node is AgendaSectionNode {
  return node instanceof AgendaSectionNode;
}
