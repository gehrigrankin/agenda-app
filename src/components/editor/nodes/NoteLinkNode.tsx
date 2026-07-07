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
import { FileText } from "lucide-react";

import { QuickViewContext } from "@/components/notes/NotePreviewProvider";

/**
 * Inline [[note-link]] chip. `noteId` is the real reference; `title` is a
 * CACHED SNAPSHOT taken when the link was inserted — if the target note is
 * later renamed, the chip shows the old title until an editor containing it
 * opens (NoteLinkTitleSyncPlugin refreshes the snapshots on mount and the
 * autosave persists them). Backlink rows in `note_links` are reconciled from
 * serialized content on autosave (see saveNoteContentAction).
 */

export type SerializedNoteLinkNode = Spread<
  {
    noteId: string;
    title: string;
  },
  SerializedLexicalNode
>;

export class NoteLinkNode extends DecoratorNode<JSX.Element> {
  __noteId: string;
  __title: string;

  static getType(): string {
    return "note-link";
  }

  static clone(node: NoteLinkNode): NoteLinkNode {
    return new NoteLinkNode(node.__noteId, node.__title, node.__key);
  }

  constructor(noteId = "", title = "", key?: NodeKey) {
    super(key);
    this.__noteId = noteId;
    this.__title = title;
  }

  /** Tolerates missing/malformed fields so old or hand-edited JSON never throws. */
  static importJSON(serializedNode: SerializedNoteLinkNode): NoteLinkNode {
    return $createNoteLinkNode({
      noteId:
        typeof serializedNode.noteId === "string" ? serializedNode.noteId : "",
      title: typeof serializedNode.title === "string" ? serializedNode.title : "",
    });
  }

  exportJSON(): SerializedNoteLinkNode {
    return {
      ...super.exportJSON(),
      type: "note-link",
      version: 1,
      noteId: this.__noteId,
      title: this.__title,
    };
  }

  createDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "inline-block align-baseline";
    return el;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): true {
    return true;
  }

  getTextContent(): string {
    return this.__title;
  }

  /** Refresh the cached title snapshot (NoteLinkTitleSyncPlugin). */
  setTitle(title: string): void {
    this.getWritable().__title = title;
  }

  decorate(): JSX.Element {
    return <NoteLinkChip noteId={this.__noteId} title={this.__title} />;
  }
}

export function $createNoteLinkNode(fields: {
  noteId: string;
  title: string;
}): NoteLinkNode {
  return $applyNodeReplacement(new NoteLinkNode(fields.noteId, fields.title));
}

export function $isNoteLinkNode(
  node: LexicalNode | null | undefined,
): node is NoteLinkNode {
  return node instanceof NoteLinkNode;
}

// ---------------------------------------------------------------------------
// React chip
// ---------------------------------------------------------------------------

function NoteLinkChip({ noteId, title }: { noteId: string; title: string }) {
  const router = useRouter();
  const quickView = useContext(QuickViewContext);
  return (
    <button
      type="button"
      onClick={() => {
        if (!noteId) return;
        // Prefer the editable quick-view overlay (home) over a full-page
        // navigation, so a linked note can be edited in place.
        if (quickView) quickView.open(noteId);
        else router.push(`/app/notes/${noteId}`);
      }}
      // Keep Lexical from treating the click as an editor selection gesture.
      onMouseDown={(e) => e.stopPropagation()}
      title={title || "Untitled"}
      className="mx-0.5 inline-flex max-w-full items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 align-baseline text-sm text-neutral-700 hover:ring-1 hover:ring-neutral-300 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:ring-neutral-600"
    >
      <FileText className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
      <span className="truncate">{title || "Untitled"}</span>
    </button>
  );
}
