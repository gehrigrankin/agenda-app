"use client";

import type { JSX } from "react";
import { useContext, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { LexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $applyNodeReplacement,
  $getNodeByKey,
  DecoratorNode,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import { ChevronDown, FileText, Link2, PictureInPicture2, X } from "lucide-react";

import { useDailyEditor } from "@/components/editor/DailyEditorContext";
import {
  QuickViewContext,
  usePreview,
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
 * Like the chip, `title` is a snapshot from insert time; the live title comes
 * from the preview provider (batched fetch). The card BODY is a live nested
 * editor — the note is always editable in place, no mode switch. The window
 * button opens the note in a floating dock window (QuickViewContext). In
 * split view the card collapses to a chip and lives in the side pane instead.
 *
 * v1 fidelity note: the body previews the note's FIRST blocks, not "only what
 * you wrote today" — per-block authorship isn't tracked. The "written today"
 * header label carries the temporal signal.
 */

export type SerializedLinkedNoteCardNode = Spread<
  {
    noteId: string;
    title: string;
    /** Card folded to its title bar (persisted per-doc). */
    collapsed?: boolean;
  },
  SerializedLexicalNode
>;

export class LinkedNoteCardNode extends DecoratorNode<JSX.Element> {
  __noteId: string;
  __title: string;
  __collapsed: boolean;

  static getType(): string {
    return "linked-note-card";
  }

  static clone(node: LinkedNoteCardNode): LinkedNoteCardNode {
    return new LinkedNoteCardNode(
      node.__noteId,
      node.__title,
      node.__collapsed,
      node.__key,
    );
  }

  constructor(noteId = "", title = "", collapsed = false, key?: NodeKey) {
    super(key);
    this.__noteId = noteId;
    this.__title = title;
    this.__collapsed = collapsed;
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
      collapsed: serializedNode.collapsed === true,
    });
  }

  exportJSON(): SerializedLinkedNoteCardNode {
    return {
      ...super.exportJSON(),
      type: "linked-note-card",
      version: 1,
      noteId: this.__noteId,
      title: this.__title,
      collapsed: this.__collapsed,
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

  /** Refresh the cached title snapshot (NoteLinkTitleSyncPlugin). */
  setTitle(title: string): void {
    this.getWritable().__title = title;
  }

  setCollapsed(collapsed: boolean): void {
    this.getWritable().__collapsed = collapsed;
  }

  decorate(): JSX.Element {
    return (
      <LinkedNoteCard
        nodeKey={this.__key}
        noteId={this.__noteId}
        title={this.__title}
        collapsed={this.__collapsed}
      />
    );
  }
}

export function $createLinkedNoteCardNode(fields: {
  noteId: string;
  title: string;
  collapsed?: boolean;
}): LinkedNoteCardNode {
  return $applyNodeReplacement(
    new LinkedNoteCardNode(fields.noteId, fields.title, fields.collapsed ?? false),
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
  nodeKey,
  noteId,
  title,
  collapsed,
  titleOpensWindow,
  onLinkIntoToday,
}: {
  /** Absent when the card renders outside the editor (split-view side pane). */
  nodeKey?: NodeKey;
  noteId: string;
  title: string;
  /** Node-persisted fold state; absent outside the editor (local state then). */
  collapsed?: boolean;
  /**
   * Makes the title text itself the "open in a window" trigger (hover
   * underline/color affordance). Only set by LinkedTodayWidget's "edited
   * today" cards — every other usage keeps the plain, non-interactive title.
   */
  titleOpensWindow?: boolean;
  /**
   * When provided, the top-right icon button links this note into today's
   * note instead of opening a window (title takes over that job — see
   * `titleOpensWindow`). Only set by LinkedTodayWidget's "edited today" cards.
   */
  onLinkIntoToday?: () => void;
}) {
  const router = useRouter();
  // Raw context, not useLexicalComposerContext(): the side-pane instances
  // mount outside any composer, where the hook would throw.
  const composer = useContext(LexicalComposerContext);
  const editor = composer?.[0] ?? null;
  const quickView = useContext(QuickViewContext);
  const { splitLinks } = useDailyEditor();
  const entry = usePreview(noteId || null);

  const preview = entry?.status === "ready" ? entry.preview : null;
  const displayTitle = preview?.title || title || "Untitled";

  // Fold state: lives on the node (persisted in the doc) when the card is in
  // an editor; plain local state for side-pane instances.
  const [localCollapsed, setLocalCollapsed] = useState(false);
  const inEditor = editor !== null && nodeKey !== undefined;
  const isCollapsed = inEditor ? collapsed === true : localCollapsed;
  const toggleCollapsed = () => {
    if (inEditor) {
      editor!.update(() => {
        const node = $getNodeByKey(nodeKey!);
        if ($isLinkedNoteCardNode(node)) node.setCollapsed(!isCollapsed);
      });
    } else {
      setLocalCollapsed((c) => !c);
    }
  };

  // Removes the CARD from this doc only — the linked note itself is untouched
  // (autosave's link reconciliation drops the backlink row). Only offered
  // where the card actually lives in a doc.
  const removeCard =
    editor && nodeKey !== undefined
      ? () => {
          editor.update(() => {
            $getNodeByKey(nodeKey)?.remove();
          });
        }
      : null;

  // Split view: the card leaves the flow of the jot — just a slim chip marks
  // where the link lives; the full (editable) card renders in the side pane.
  if (splitLinks) {
    return (
      <div
        contentEditable={false}
        onMouseDown={(e) => e.stopPropagation()}
        className="group flex items-center gap-2 rounded-lg border border-white/7 bg-card/60 px-3 py-1.5"
      >
        <FileText className="h-3 w-3 flex-none text-steel" />
        <span className="min-w-0 truncate text-[0.75rem] text-ink-300">
          {displayTitle}
        </span>
        <span className="ml-auto flex-none text-[0.59375rem] text-ink-600">
          in side panel →
        </span>
        {removeCard && (
          <button
            type="button"
            aria-label="Remove link from this note"
            title="Remove link from this note"
            onClick={removeCard}
            className="flex h-4 w-4 flex-none items-center justify-center rounded text-ink-600 opacity-0 hover:bg-white/6 hover:text-ink-200 focus-visible:opacity-100 group-hover:opacity-100"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  }

  const openWindow = () => {
    if (!noteId) return;
    if (quickView) quickView.open(noteId);
    else router.push(`/app/notes/${noteId}`);
  };

  return (
    <div
      // Keep Lexical from treating clicks inside the card as selection.
      onMouseDown={(e) => e.stopPropagation()}
      className="group rounded-xl border border-white/9 bg-card transition-colors focus-within:border-sage/40 hover:border-steel/40"
      contentEditable={false}
    >
      <div
        className={`flex items-center gap-2 px-3.5 py-2.5 ${
          isCollapsed ? "" : "border-b border-white/6"
        }`}
      >
        <button
          type="button"
          aria-label={isCollapsed ? "Expand card" : "Collapse card"}
          aria-expanded={!isCollapsed}
          title={isCollapsed ? "Expand card" : "Collapse to title"}
          onClick={toggleCollapsed}
          className="flex h-[1.375rem] w-[1.375rem] flex-none items-center justify-center rounded-md text-ink-600 hover:bg-white/6 hover:text-ink-200"
        >
          <ChevronDown
            className={`h-3 w-3 transition-transform ${
              isCollapsed ? "-rotate-90" : ""
            }`}
          />
        </button>
        <span
          className="h-1.5 w-1.5 flex-none rounded-full"
          style={{ background: preview?.bubbleColor ?? "#9CC5AC" }}
        />
        {titleOpensWindow ? (
          <button
            type="button"
            onClick={openWindow}
            title="Open in a window"
            className="min-w-0 truncate text-left text-[0.8125rem] font-semibold leading-none text-ink-100 underline-offset-2 hover:text-steel hover:underline"
          >
            {displayTitle}
          </button>
        ) : (
          <span className="min-w-0 truncate text-[0.8125rem] font-semibold leading-none text-ink-100">
            {displayTitle}
          </span>
        )}
        {preview && (
          <span className="flex-none text-[0.65625rem] leading-none text-ink-600">
            {statusLabel(preview.updatedAt)}
          </span>
        )}
        {onLinkIntoToday ? (
          <button
            type="button"
            aria-label="Link into today's note"
            title="Link into today's note"
            onClick={onLinkIntoToday}
            className="ml-auto flex h-[1.375rem] w-[1.375rem] flex-none items-center justify-center rounded-md text-ink-600 hover:bg-white/6 hover:text-steel"
          >
            <Link2 className="h-3 w-3" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Open in a window"
            title="Open in a window"
            onClick={openWindow}
            className="ml-auto flex h-[1.375rem] w-[1.375rem] flex-none items-center justify-center rounded-md text-ink-600 hover:bg-white/6 hover:text-steel"
          >
            <PictureInPicture2 className="h-3 w-3" />
          </button>
        )}
        {removeCard && (
          <button
            type="button"
            aria-label="Remove card from this note"
            title="Remove card from this note (the note itself is kept)"
            onClick={removeCard}
            className="flex h-[1.375rem] w-[1.375rem] flex-none items-center justify-center rounded-md text-ink-600 hover:bg-white/6 hover:text-ink-200"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      {/* The body IS the note, live: no preview→editor swap, so clicking puts
          the caret exactly where you clicked and the card never reshapes. */}
      {isCollapsed ? null : entry === undefined || entry.status === "loading" ? (
        <div className="flex flex-col gap-2 px-3.5 py-3" aria-hidden>
          <div className="h-3 w-3/4 animate-pulse rounded bg-white/6" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-white/6" />
        </div>
      ) : entry.status === "missing" ? (
        <p className="px-3.5 py-3 text-[0.75rem] italic text-ink-600">
          Note unavailable — it may have been deleted.
        </p>
      ) : (
        <InlineNoteEditor noteId={noteId} initialContent={entry.preview.content} />
      )}
    </div>
  );
}
