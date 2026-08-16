"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  EditorState,
  LexicalEditor,
  SerializedEditorState,
  SerializedLexicalNode,
} from "lexical";
import { AlertCircle, Loader2 } from "lucide-react";

import { getCardSectionAction } from "@/app/app/actions";
import { Editor } from "@/components/editor/Editor";
import {
  useCardSection,
  usePublishCardSection,
} from "@/components/notes/NotePreviewProvider";
import { SaveFailureBanner, SaveStatusChip } from "@/components/notes/SaveStatus";
import {
  cardSectionStashId,
  initialSaveBaseline,
  isLoadedEditorContent,
} from "@/lib/editor-save-baseline";
import { SaveRejected } from "@/lib/save-failure";
import { useDebouncedCallback } from "@/lib/hooks/use-debounced-callback";
import { useSaveRetry } from "@/lib/hooks/use-save-retry";
import { saveCardSectionRequest } from "@/lib/note-content-transport";
import {
  clearUnsavedStash,
  readUnsavedStash,
  writeUnsavedStash,
  type UnsavedStash,
} from "@/lib/unsaved-content";

/**
 * The body of a SCOPED linked-note card: an editor over one section of another
 * note rather than the whole thing.
 *
 * The difference from `InlineNoteEditor` is the save. That one owns its note
 * and overwrites the document; this one owns a slice, so it reads the target,
 * splices its blocks into the anchor's range, and writes the result back
 * through the note-content Route Handler. Overwriting from here would delete
 * every part of the target note the card cannot see — which is most of it.
 *
 * Loaded via next/dynamic by the card, for the same cycle reason as
 * `InlineNoteEditor`: Editor's node list contains the card that renders this.
 */

type Section =
  // undefined = loading; null = the anchor is no longer on that note.
  { blocks: SerializedLexicalNode[] } | null | undefined;

/** Wrap loose blocks in the root document Lexical expects to hydrate from. */
function toEditorState(blocks: SerializedLexicalNode[]): SerializedEditorState {
  const children =
    blocks.length > 0
      ? blocks
      : [
          {
            type: "paragraph",
            children: [],
            direction: null,
            format: "",
            indent: 0,
            version: 1,
          } as unknown as SerializedLexicalNode,
        ];
  return {
    root: {
      type: "root",
      children,
      direction: null,
      format: "",
      indent: 0,
      version: 1,
    },
  } as unknown as SerializedEditorState;
}

function rootChildren(state: SerializedEditorState): SerializedLexicalNode[] {
  const children = (state as unknown as { root?: { children?: unknown } })?.root
    ?.children;
  return Array.isArray(children) ? (children as SerializedLexicalNode[]) : [];
}

export default function CardSectionEditor({
  noteId,
  anchorId,
}: {
  noteId: string;
  anchorId: string;
}) {
  const [fetched, setFetched] = useState<Section>(undefined);

  // Prefer the shared provider: it already fetched this target note's content
  // for the card's title, so the section is a client-side slice of bytes we
  // hold rather than another round trip. N cards used to mean N getNote calls,
  // re-fired on every remount -- and the daily-note day flip remounts these
  // constantly.
  const shared = useCardSection(noteId, anchorId);
  const publishSection = usePublishCardSection();
  const needsOwnFetch = shared.status === "unavailable";

  useEffect(() => {
    // Only when rendered outside a provider (some widget paths do that).
    if (!needsOwnFetch) return;
    let cancelled = false;
    getCardSectionAction(noteId, anchorId)
      .then((res) => {
        if (!cancelled) setFetched(res);
      })
      .catch((err) => {
        console.error("[card-section] load failed:", err);
        if (!cancelled) setFetched(null);
      });
    return () => {
      cancelled = true;
    };
  }, [noteId, anchorId, needsOwnFetch]);

  const section: Section = needsOwnFetch
    ? fetched
    : shared.status === "ready"
      ? { blocks: shared.blocks }
      : shared.status === "detached"
        ? null
        : undefined;

  const stashId = cardSectionStashId(noteId, anchorId);
  const editorRef = useRef<LexicalEditor | null>(null);
  const [stash, setStash] = useState<UnsavedStash | null>(null);
  useEffect(() => setStash(readUnsavedStash(stashId)), [stashId]);

  const lastSavedJSONRef = useRef<string | null>(null);
  const lastPersistedJSONRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const latestEditorJSONRef = useRef<string | null>(null);
  const loadedBlocksRef = useRef<SerializedLexicalNode[] | null>(null);
  if (section && loadedBlocksRef.current === null) {
    loadedBlocksRef.current = section.blocks;
  }
  const {
    status,
    runSave,
    markSaving,
    markPendingCancelled,
    discardFailed,
  } = useSaveRetry<"content">();

  const saveSection = useDebouncedCallback(
    (json: string, blocks: SerializedLexicalNode[]) => {
      lastSavedJSONRef.current = json;
      void runSave("content", {
        work: async () => {
          const res = await saveCardSectionRequest(noteId, anchorId, blocks);
          if (!res.ok) throw new SaveRejected(res.failure);
          lastPersistedJSONRef.current = json;
          // Keep the shared cache coherent with what we just wrote, or a
          // remount would rehydrate from the pre-save content.
          publishSection(noteId, anchorId, blocks, res.revision);
          if (latestEditorJSONRef.current === json) {
            clearUnsavedStash(stashId);
            dirtyRef.current = false;
          }
        },
        onFirstFailure: () => {
          if (lastSavedJSONRef.current === json) {
            lastSavedJSONRef.current = lastPersistedJSONRef.current;
          }
        },
      });
    },
    800,
  );

  useEffect(() => {
    const flush = () => saveSection.flush();
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [saveSection]);

  const onChange = useCallback(
    (editorState: EditorState) => {
      const serialized = editorState.toJSON();
      const blocks = rootChildren(serialized);
      const json = JSON.stringify(blocks);
      latestEditorJSONRef.current = json;
      if (json === lastSavedJSONRef.current) {
        // Typed back to what's on disk: cancel the pending save AND drop the
        // optimistic "saving…" the keystrokes before it put up. Without this
        // the label sticks forever, which is what made cards look like they
        // were saving constantly.
        saveSection.cancel();
        discardFailed("content");
        if (dirtyRef.current) clearUnsavedStash(stashId);
        dirtyRef.current = false;
        markPendingCancelled();
        return;
      }
      if (lastSavedJSONRef.current === null) {
        const matchesLoaded = isLoadedEditorContent(
          blocks,
          loadedBlocksRef.current,
        );
        const baseline = initialSaveBaseline(blocks, loadedBlocksRef.current);
        lastSavedJSONRef.current = baseline;
        lastPersistedJSONRef.current = baseline;
        // Lexical does not always emit a mount normalization event. Only
        // absorb this first event when it structurally matches what was
        // loaded; otherwise it is the user's first real edit.
        if (matchesLoaded) return;
      }
      dirtyRef.current = true;
      writeUnsavedStash(stashId, toEditorState(blocks));
      markSaving();
      saveSection(json, blocks);
    },
    [discardFailed, markPendingCancelled, markSaving, saveSection, stashId],
  );

  const restoreStash = () => {
    const editor = editorRef.current;
    if (!editor || !stash) return;
    try {
      editor.setEditorState(editor.parseEditorState(stash.content));
      setStash(null);
    } catch (err) {
      console.error("[card-section] failed to restore unsaved changes:", err);
    }
  };

  const discardStash = () => {
    clearUnsavedStash(stashId);
    setStash(null);
  };

  if (section === undefined) {
    return (
      <div className="flex h-24 items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-ink-600" />
      </div>
    );
  }
  if (section === null) {
    return (
      <p className="px-3.5 py-3 text-[0.75rem] italic text-ink-600">
        This card&rsquo;s section is no longer on that note.
      </p>
    );
  }

  return (
    // No max height and no inner scroller on purpose. Everything in a scoped
    // card IS what you wrote from the note you're standing in, and you should
    // never have to scroll a window to re-read your own paragraph. (The legacy
    // whole-note body in InlineNoteEditor keeps its cap — that one really does
    // show the other note's content.)
    <div className="flex min-h-[7rem] flex-col">
      <SaveFailureBanner status={status} />
      {stash && (
        <div className="flex items-center gap-1.5 border-b border-amber-500/25 bg-amber-500/8 px-3 py-1.5">
          <AlertCircle className="h-3 w-3 flex-none text-amber-400" />
          <span className="min-w-0 flex-1 text-[0.65625rem] text-ink-300">
            Unsaved card changes are available.
          </span>
          <button
            type="button"
            onClick={restoreStash}
            className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[0.625rem] font-medium text-amber-200"
          >
            Restore
          </button>
          <button
            type="button"
            onClick={discardStash}
            className="rounded px-1.5 py-0.5 text-[0.625rem] text-ink-400"
          >
            Discard
          </button>
        </div>
      )}
      <Editor
        hideToolbar
        editorRef={editorRef}
        initialStateJSON={JSON.stringify(toEditorState(section.blocks))}
        onChange={onChange}
        contentClassName="editor-content min-h-[7rem] w-full px-3.5 py-3 text-[0.8125rem] leading-relaxed text-ink-200 outline-none"
      />
      <span className="pointer-events-none sticky bottom-0 self-end px-2 pb-1">
        <SaveStatusChip status={status} compact />
      </span>
    </div>
  );
}
