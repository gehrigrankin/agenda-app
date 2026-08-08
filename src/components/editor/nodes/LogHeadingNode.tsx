"use client";

import type { HeadingTagType } from "@lexical/rich-text";
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
 * A heading that logs. Inserted by `[[+Target` in the note-link typeahead:
 * it reads as an ordinary heading, and everything written under it — up to
 * the next heading of the same or higher level — is logged onto the target
 * note and appears in that note's Logs panel.
 *
 * Extends CollapsibleHeadingNode rather than HeadingNode so the section it
 * owns is exactly the section CollapsePlugin already collapses. That's not a
 * convenience: "what collapses" and "what gets logged" have to be the same
 * blocks, or the fold would hide content that is still being sent.
 *
 * The heading's TEXT is ordinary editable text (seeded with the target's
 * title). The link lives in `noteId`, so renaming the heading retitles the
 * log without repointing it. `logId` is minted once at insert and is the
 * identity of the row in `note_logs` — it has to travel in the document,
 * because that's the only thing that survives an edit and tells
 * reconciliation "this is the same log, changed" rather than "a new one".
 *
 * Rendering is CSS-only (a `↳` marker fed by `data-log-target`, see
 * globals.css) because this is an ElementNode holding real editable
 * children — a decorator would take the text away from the editor.
 */

export type SerializedLogHeadingNode = Spread<
  { logId: string; noteId: string; title: string },
  SerializedCollapsibleHeadingNode
>;

export class LogHeadingNode extends CollapsibleHeadingNode {
  __logId: string;
  __noteId: string;
  __title: string;

  static getType(): string {
    return "log-heading";
  }

  static clone(node: LogHeadingNode): LogHeadingNode {
    return new LogHeadingNode(
      node.__tag,
      node.__logId,
      node.__noteId,
      node.__title,
      node.__collapsed,
      node.__key,
    );
  }

  constructor(
    tag: HeadingTagType,
    logId: string,
    noteId: string,
    title: string,
    collapsed = false,
    key?: NodeKey,
  ) {
    super(tag, collapsed, key);
    this.__logId = logId;
    this.__noteId = noteId;
    this.__title = title;
  }

  static importJSON(serialized: SerializedLogHeadingNode): LogHeadingNode {
    const tag =
      typeof serialized.tag === "string" && /^h[1-6]$/.test(serialized.tag)
        ? serialized.tag
        : "h2";
    return $createLogHeadingNode(
      tag,
      typeof serialized.logId === "string" ? serialized.logId : "",
      typeof serialized.noteId === "string" ? serialized.noteId : "",
      typeof serialized.title === "string" ? serialized.title : "",
      serialized.collapsed === true,
    ).updateFromJSON({ ...serialized, tag });
  }

  exportJSON(): SerializedLogHeadingNode {
    return {
      ...super.exportJSON(),
      type: "log-heading",
      version: 1,
      logId: this.__logId,
      noteId: this.__noteId,
      title: this.__title,
    };
  }

  private decorate(dom: HTMLElement): void {
    dom.dataset.logTarget = this.__title || "note";
    dom.dataset.logNote = this.__noteId;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    dom.classList.add("log-heading");
    this.decorate(dom);
    return dom;
  }

  updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean {
    const recreate = super.updateDOM(prevNode, dom, config);
    if (!recreate) {
      dom.classList.add("log-heading");
      this.decorate(dom);
    }
    return recreate;
  }

  getLogId(): string {
    return this.getLatest().__logId;
  }

  getNoteId(): string {
    return this.getLatest().__noteId;
  }

  getTitle(): string {
    return this.getLatest().__title;
  }

  /** Kept fresh by NoteLinkTitleSyncPlugin when the target is renamed. */
  setTitle(title: string): void {
    this.getWritable().__title = title;
  }
}

export function $createLogHeadingNode(
  tag: HeadingTagType,
  logId: string,
  noteId: string,
  title: string,
  collapsed = false,
): LogHeadingNode {
  return $applyNodeReplacement(
    new LogHeadingNode(tag, logId, noteId, title, collapsed),
  );
}

export function $isLogHeadingNode(
  node: LexicalNode | null | undefined,
): node is LogHeadingNode {
  return node instanceof LogHeadingNode;
}
