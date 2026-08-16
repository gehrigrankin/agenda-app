"use client";

import type { JSX } from "react";
import { useCallback, useContext, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { LexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $applyNodeReplacement,
  $getNodeByKey,
  DecoratorNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import {
  ChevronDown,
  FileText,
  Link2,
  PictureInPicture2,
  RotateCw,
  X,
} from "lucide-react";

import {
  createCardAnchorAction,
  pruneCardAnchorAction,
} from "@/app/app/actions";
import { useDailyEditor } from "@/components/editor/DailyEditorContext";
import {
  QuickViewContext,
  usePreview,
} from "@/components/notes/NotePreviewProvider";

// Dynamic: a static import would cycle (Editor's node list includes this
// card; the inline editor mounts a full Editor).
const bodySkeleton = () => (
  <div className="flex flex-col gap-2 px-3.5 py-3" aria-hidden>
    <div className="h-3 w-3/4 animate-pulse rounded bg-white/6" />
    <div className="h-3 w-1/2 animate-pulse rounded bg-white/6" />
  </div>
);

const InlineNoteEditor = dynamic(
  () => import("@/components/notes/InlineNoteEditor"),
  { ssr: false, loading: bodySkeleton },
);

// Scoped cards edit one section of the target note; same cycle, same fix.
const CardSectionEditor = dynamic(
  () => import("@/components/notes/CardSectionEditor"),
  { ssr: false, loading: bodySkeleton },
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
    /**
     * The section of the target note this card owns (see `lib/card-anchors`).
     * Absent on cards inserted before scoping shipped — those keep showing the
     * whole target note, because there is no way to work out after the fact
     * which of its existing paragraphs were written from here, and guessing
     * would silently hide the user's writing.
     */
    anchorId?: string;
    /**
     * This card was inserted by the scoping-aware flow, so it owns a section of
     * the target note even if `anchorId` hasn't landed yet (the anchor is
     * created in a round trip after insert, and that round trip can fail).
     *
     * It is the whole difference between "waiting for my section" and "I am a
     * pre-#82 card": without it, a card whose anchor is still in flight is
     * indistinguishable from a legacy one and dumps the ENTIRE target note into
     * the body for a beat — the exact thing scoping exists to stop.
     */
    scoped?: boolean;
  },
  SerializedLexicalNode
>;

export class LinkedNoteCardNode extends DecoratorNode<JSX.Element> {
  __noteId: string;
  __title: string;
  __collapsed: boolean;
  __anchorId: string;
  __scoped: boolean;

  static getType(): string {
    return "linked-note-card";
  }

  static clone(node: LinkedNoteCardNode): LinkedNoteCardNode {
    return new LinkedNoteCardNode(
      node.__noteId,
      node.__title,
      node.__collapsed,
      node.__anchorId,
      node.__scoped,
      node.__key,
    );
  }

  constructor(
    noteId = "",
    title = "",
    collapsed = false,
    anchorId = "",
    scoped = false,
    key?: NodeKey,
  ) {
    super(key);
    this.__noteId = noteId;
    this.__title = title;
    this.__collapsed = collapsed;
    this.__anchorId = anchorId;
    // An anchor is proof of scoping on its own, so cards saved between #82 and
    // this flag keep their scoped body after a reload.
    this.__scoped = scoped || anchorId.length > 0;
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
      anchorId:
        typeof serializedNode.anchorId === "string"
          ? serializedNode.anchorId
          : "",
      scoped: serializedNode.scoped === true,
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
      anchorId: this.__anchorId,
      scoped: this.__scoped,
    };
  }

  getAnchorId(): string {
    return this.__anchorId;
  }

  /** Set once, when the anchor comes back from the server after insert. */
  setAnchorId(anchorId: string): void {
    const writable = this.getWritable();
    writable.__anchorId = anchorId;
    if (anchorId) writable.__scoped = true;
  }

  isScoped(): boolean {
    return this.__scoped;
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
        anchorId={this.__anchorId}
        scoped={this.__scoped}
      />
    );
  }
}

export function $createLinkedNoteCardNode(fields: {
  noteId: string;
  title: string;
  collapsed?: boolean;
  anchorId?: string;
  scoped?: boolean;
}): LinkedNoteCardNode {
  return $applyNodeReplacement(
    new LinkedNoteCardNode(
      fields.noteId,
      fields.title,
      fields.collapsed ?? false,
      fields.anchorId ?? "",
      fields.scoped ?? false,
    ),
  );
}

export function $isLinkedNoteCardNode(
  node: LexicalNode | null | undefined,
): node is LinkedNoteCardNode {
  return node instanceof LinkedNoteCardNode;
}

/**
 * Give a card its own section on the target note and write the id back onto
 * the node. Shared by the insert flow (NoteLinkPlugin) and the card's retry so
 * a first attempt and a second one can't drift apart.
 *
 * Resolves false when no anchor was created — the card then shows an empty
 * "awaiting section" body with a retry, never the target note's own text.
 */
export async function attachCardAnchor(
  editor: LexicalEditor,
  cardKey: NodeKey,
  fields: { targetNoteId: string; sourceNoteId: string; sourceTitle: string },
): Promise<boolean> {
  if (!fields.targetNoteId || !fields.sourceNoteId) return false;
  try {
    const res = await createCardAnchorAction(
      fields.targetNoteId,
      fields.sourceNoteId,
      fields.sourceTitle,
    );
    if (!res) return false;
    editor.update(() => {
      const node = $getNodeByKey(cardKey);
      if ($isLinkedNoteCardNode(node)) node.setAnchorId(res.anchorId);
    });
    return true;
  } catch (err) {
    console.error("[cards] anchor create failed:", err);
    return false;
  }
}

/**
 * Body of a scoped card whose anchor hasn't arrived. The anchor is one round
 * trip away, so a skeleton covers the normal case; past that the create failed
 * and the honest move is to say so and offer the retry — falling back to the
 * whole target note would be showing writing this card never made.
 */
function PendingSectionBody({
  onRetry,
}: {
  onRetry: (() => Promise<boolean>) | null;
}) {
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setFailed(true), 6000);
    return () => window.clearTimeout(t);
  }, []);

  if (!failed || retrying) {
    return (
      <div className="flex flex-col gap-2 px-3.5 py-3" aria-hidden>
        <div className="h-3 w-1/2 animate-pulse rounded bg-white/6" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3.5 py-3">
      <p className="min-w-0 flex-1 text-[0.75rem] italic text-ink-600">
        Couldn&rsquo;t set up this card&rsquo;s section on that note.
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={() => {
            setRetrying(true);
            // Success unmounts this body (the node gains an anchorId); failure
            // drops us back onto the same message.
            onRetry().then(
              (ok) => {
                if (!ok) setRetrying(false);
              },
              () => setRetrying(false),
            );
          }}
          className="flex flex-none items-center gap-1 rounded-md px-1.5 py-1 text-[0.6875rem] text-ink-400 hover:bg-white/6 hover:text-ink-200"
        >
          <RotateCw className="h-3 w-3" />
          Retry
        </button>
      )}
    </div>
  );
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
  anchorId,
  scoped,
  titleOpensWindow,
  onLinkIntoToday,
}: {
  /** Absent when the card renders outside the editor (split-view side pane). */
  nodeKey?: NodeKey;
  noteId: string;
  title: string;
  /** Node-persisted fold state; absent outside the editor (local state then). */
  collapsed?: boolean;
  /** Scopes the body to one section of the target note; "" = the whole note. */
  anchorId?: string;
  /** Card owns a section even without an `anchorId` yet — see the node docs. */
  scoped?: boolean;
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
  const { splitLinks, sourceNoteId, sourceTitle } = useDailyEditor();
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

  // Second (manual) go at the anchor the insert failed to create. Only from
  // inside an editor: elsewhere there is no node to write the id back onto.
  const retryAnchor = useCallback(async () => {
    if (!editor || nodeKey === undefined || !sourceNoteId) return false;
    return attachCardAnchor(editor, nodeKey, {
      targetNoteId: noteId,
      sourceNoteId,
      sourceTitle: sourceTitle ?? "",
    });
  }, [editor, nodeKey, noteId, sourceNoteId, sourceTitle]);

  // Removes the CARD from this doc only — the linked note itself is untouched
  // (autosave's link reconciliation drops the backlink row). Only offered
  // where the card actually lives in a doc.
  //
  // The anchor on the target note goes too, but ONLY if nothing was written
  // under it: an empty divider left behind is litter on somebody else's note,
  // while a section with words in it belongs to that note now and deleting the
  // card must not take it. `pruneEmptyCardAnchor` is the one making that call.
  const removeCard =
    editor && nodeKey !== undefined
      ? () => {
          editor.update(() => {
            $getNodeByKey(nodeKey)?.remove();
          });
          if (noteId && anchorId) {
            pruneCardAnchorAction(noteId, anchorId).catch((err) => {
              console.error("[cards] anchor prune failed:", err);
            });
          }
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
      ) : anchorId ? (
        // Scoped: the body is only the section this card owns.
        <CardSectionEditor noteId={noteId} anchorId={anchorId} />
      ) : scoped ? (
        // Scoped but anchorless: waiting on (or missing) its own section.
        <PendingSectionBody
          onRetry={inEditor && sourceNoteId ? retryAnchor : null}
        />
      ) : (
        // Pre-scoping card — the whole target note, as it has always been.
        <InlineNoteEditor
          noteId={noteId}
          initialContent={entry.preview.content}
          initialContentRevision={entry.preview.contentRevision}
        />
      )}
    </div>
  );
}
