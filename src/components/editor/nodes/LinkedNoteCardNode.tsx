"use client";

import type { JSX } from "react";
import { useContext, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  $applyNodeReplacement,
  DecoratorNode,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import { Check, FileText, Pencil, PictureInPicture2 } from "lucide-react";

import { useDailyEditor } from "@/components/editor/DailyEditorContext";
import { LexicalPreview } from "@/components/notes/LexicalPreview";
import {
  QuickViewContext,
  usePreview,
  usePreviewInvalidator,
} from "@/components/notes/NotePreviewProvider";

// Dynamic: a static import would cycle (Editor's node list includes this
// card; the inline editor mounts a full Editor).
const InlineNoteEditor = dynamic(
  () => import("@/components/notes/InlineNoteEditor"),
  { ssr: false },
);

/**
 * Block-level linked-note CARD — the daily note's embed (design Turn 10).
 * Distinct from the inline NoteLinkNode chip on purpose: regular notes keep
 * their chips untouched; only the daily editor inserts cards (NoteLinkPlugin).
 *
 * Like the chip, `title` is a snapshot from insert time; the live title and
 * body come from the preview provider (batched fetch). Clicking the body (or
 * the pencil) swaps the preview for a real in-place editor; the window button
 * opens the note in a floating dock window (QuickViewContext). In split view
 * the card collapses to a chip and lives in the side pane instead.
 *
 * v1 fidelity note: the body previews the note's FIRST blocks, not "only what
 * you wrote today" — per-block authorship isn't tracked. The "written today"
 * header label carries the temporal signal.
 */

export type SerializedLinkedNoteCardNode = Spread<
  {
    noteId: string;
    title: string;
  },
  SerializedLexicalNode
>;

export class LinkedNoteCardNode extends DecoratorNode<JSX.Element> {
  __noteId: string;
  __title: string;

  static getType(): string {
    return "linked-note-card";
  }

  static clone(node: LinkedNoteCardNode): LinkedNoteCardNode {
    return new LinkedNoteCardNode(node.__noteId, node.__title, node.__key);
  }

  constructor(noteId = "", title = "", key?: NodeKey) {
    super(key);
    this.__noteId = noteId;
    this.__title = title;
  }

  /** Tolerates missing/malformed fields so hand-edited JSON never throws. */
  static importJSON(
    serializedNode: SerializedLinkedNoteCardNode,
  ): LinkedNoteCardNode {
    return $createLinkedNoteCardNode({
      noteId:
        typeof serializedNode.noteId === "string" ? serializedNode.noteId : "",
      title:
        typeof serializedNode.title === "string" ? serializedNode.title : "",
    });
  }

  exportJSON(): SerializedLinkedNoteCardNode {
    return {
      ...super.exportJSON(),
      type: "linked-note-card",
      version: 1,
      noteId: this.__noteId,
      title: this.__title,
    };
  }

  createDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "my-2";
    return el;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): false {
    return false;
  }

  getTextContent(): string {
    return this.__title;
  }

  decorate(): JSX.Element {
    return <LinkedNoteCard noteId={this.__noteId} title={this.__title} />;
  }
}

export function $createLinkedNoteCardNode(fields: {
  noteId: string;
  title: string;
}): LinkedNoteCardNode {
  return $applyNodeReplacement(
    new LinkedNoteCardNode(fields.noteId, fields.title),
  );
}

export function $isLinkedNoteCardNode(
  node: LexicalNode | null | undefined,
): node is LinkedNoteCardNode {
  return node instanceof LinkedNoteCardNode;
}

// ---------------------------------------------------------------------------
// Card component
// ---------------------------------------------------------------------------

/** "edited Jul 3" / "written today" from the preview's updatedAt. */
function statusLabel(updatedAtIso: string): string {
  const updated = new Date(updatedAtIso);
  const now = new Date();
  const sameDay =
    updated.getFullYear() === now.getFullYear() &&
    updated.getMonth() === now.getMonth() &&
    updated.getDate() === now.getDate();
  if (sameDay) return "written today";
  return `edited ${updated.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`;
}

export function LinkedNoteCard({
  noteId,
  title,
}: {
  noteId: string;
  title: string;
}) {
  const router = useRouter();
  const quickView = useContext(QuickViewContext);
  const invalidatePreview = usePreviewInvalidator();
  const { splitLinks } = useDailyEditor();
  const entry = usePreview(noteId || null);
  const [editing, setEditing] = useState(false);

  const preview = entry?.status === "ready" ? entry.preview : null;
  const displayTitle = preview?.title || title || "Untitled";

  // Split view: the card leaves the flow of the jot — just a slim chip marks
  // where the link lives; the full (editable) card renders in the side pane.
  if (splitLinks) {
    return (
      <div
        contentEditable={false}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex items-center gap-2 rounded-lg border border-white/7 bg-card/60 px-3 py-1.5"
      >
        <FileText className="h-3 w-3 flex-none text-steel" />
        <span className="min-w-0 truncate text-[0.75rem] text-ink-300">
          {displayTitle}
        </span>
        <span className="ml-auto flex-none text-[0.59375rem] text-ink-600">
          in side panel →
        </span>
      </div>
    );
  }

  const openWindow = () => {
    if (!noteId) return;
    if (quickView) quickView.open(noteId);
    else router.push(`/app/notes/${noteId}`);
  };

  const stopEditing = () => {
    setEditing(false);
    // Pull the edits back into the card preview (and sibling widgets).
    if (noteId) invalidatePreview?.(noteId);
  };

  return (
    <div
      // Keep Lexical from treating clicks inside the card as selection.
      onMouseDown={(e) => e.stopPropagation()}
      className={`group rounded-xl border bg-card transition-colors ${
        editing ? "border-sage/40" : "border-white/9 hover:border-steel/40"
      }`}
      contentEditable={false}
    >
      <div className="flex items-center gap-2 border-b border-white/6 px-3.5 py-2.5">
        <span
          className="h-1.5 w-1.5 flex-none rounded-full"
          style={{ background: preview?.bubbleColor ?? "#9CC5AC" }}
        />
        <span className="min-w-0 truncate text-[0.8125rem] font-semibold leading-none text-ink-100">
          {displayTitle}
        </span>
        {preview && !editing && (
          <span className="flex-none text-[0.65625rem] leading-none text-ink-600">
            {statusLabel(preview.updatedAt)}
          </span>
        )}
        {editing && (
          <span className="flex-none text-[0.65625rem] leading-none text-sage">
            editing
          </span>
        )}
        <span className="ml-auto flex flex-none items-center gap-0.5">
          {editing ? (
            <button
              type="button"
              aria-label="Done editing"
              title="Done"
              onClick={stopEditing}
              className="flex h-[1.375rem] w-[1.375rem] items-center justify-center rounded-md bg-sage/16 text-sage hover:bg-sage/24"
            >
              <Check className="h-3 w-3" />
            </button>
          ) : (
            <>
              <button
                type="button"
                aria-label="Edit here"
                title="Edit right here"
                onClick={() => noteId && setEditing(true)}
                className="flex h-[1.375rem] w-[1.375rem] items-center justify-center rounded-md text-ink-600 hover:bg-white/6 hover:text-steel"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label="Open in a window"
                title="Open in a window"
                onClick={openWindow}
                className="flex h-[1.375rem] w-[1.375rem] items-center justify-center rounded-md text-ink-600 hover:bg-white/6 hover:text-steel"
              >
                <PictureInPicture2 className="h-3 w-3" />
              </button>
            </>
          )}
        </span>
      </div>
      {editing ? (
        <InlineNoteEditor noteId={noteId} initialContent={preview?.content} />
      ) : (
        <div
          role="button"
          tabIndex={0}
          aria-label={`Edit ${displayTitle}`}
          onClick={() => noteId && setEditing(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (noteId) setEditing(true);
            }
          }}
          className="cursor-text px-3.5 py-3"
        >
          {entry === undefined || entry.status === "loading" ? (
            <div className="flex flex-col gap-2" aria-hidden>
              <div className="h-3 w-3/4 animate-pulse rounded bg-white/6" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-white/6" />
            </div>
          ) : entry.status === "missing" ? (
            <p className="text-[0.75rem] italic text-ink-600">
              Note unavailable — it may have been deleted.
            </p>
          ) : (
            <LexicalPreview state={entry.preview.content} maxBlocks={6} />
          )}
        </div>
      )}
    </div>
  );
}
