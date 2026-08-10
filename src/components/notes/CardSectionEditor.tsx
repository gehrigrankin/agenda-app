"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  EditorState,
  SerializedEditorState,
  SerializedLexicalNode,
} from "lexical";
import { Loader2 } from "lucide-react";

import {
  getCardSectionAction,
  saveCardSectionAction,
} from "@/app/app/actions";
import { Editor } from "@/components/editor/Editor";
import { useDebouncedCallback } from "@/lib/hooks/use-debounced-callback";

/**
 * The body of a SCOPED linked-note card: an editor over one section of another
 * note rather than the whole thing.
 *
 * The difference from `InlineNoteEditor` is the save. That one owns its note
 * and overwrites the document; this one owns a slice, so it reads the target,
 * splices its blocks into the anchor's range, and writes the result back
 * (`saveCardSectionAction`). Overwriting from here would delete every part of
 * the target note the card cannot see — which is most of it.
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
  const [section, setSection] = useState<Section>(undefined);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error" | "detached"
  >("idle");

  useEffect(() => {
    let cancelled = false;
    getCardSectionAction(noteId, anchorId)
      .then((res) => {
        if (!cancelled) setSection(res);
      })
      .catch((err) => {
        console.error("[card-section] load failed:", err);
        if (!cancelled) setSection(null);
      });
    return () => {
      cancelled = true;
    };
  }, [noteId, anchorId]);

  // Same baseline trick as useNoteAutosave: the editor's first change fire is
  // its mount-time normalization of the loaded blocks, not a user edit, so it
  // seeds the baseline instead of triggering a save.
  const lastSavedJSONRef = useRef<string | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  const saveSection = useDebouncedCallback(
    (json: string, blocks: SerializedLexicalNode[]) => {
      const prev = lastSavedJSONRef.current;
      lastSavedJSONRef.current = json;
      setSaveState("saving");
      // Chained: an earlier slow splice must not land after a later one and
      // reinstate the blocks it was built from.
      const task = chainRef.current.then(() =>
        saveCardSectionAction(noteId, anchorId, blocks),
      );
      chainRef.current = task.then(
        () => undefined,
        () => undefined,
      );
      task
        .then((res) => {
          if (res.ok) {
            setSaveState("saved");
            return;
          }
          // The section is gone from the target note. Stop claiming to save:
          // re-splicing would resurrect writing the user deleted over there.
          if (lastSavedJSONRef.current === json) {
            lastSavedJSONRef.current = prev;
          }
          setSaveState("detached");
        })
        .catch((err) => {
          console.error("[card-section] save failed:", err);
          if (lastSavedJSONRef.current === json) {
            lastSavedJSONRef.current = prev;
          }
          setSaveState("error");
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
      if (json === lastSavedJSONRef.current) {
        saveSection.cancel();
        return;
      }
      if (lastSavedJSONRef.current === null) {
        lastSavedJSONRef.current = json;
        return;
      }
      setSaveState("saving");
      saveSection(json, blocks);
    },
    [saveSection],
  );

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
    <div className="flex max-h-[32rem] min-h-[7rem] flex-col overflow-y-auto">
      <Editor
        hideToolbar
        initialStateJSON={JSON.stringify(toEditorState(section.blocks))}
        onChange={onChange}
        contentClassName="editor-content min-h-[7rem] w-full px-3.5 py-3 text-[0.8125rem] leading-relaxed text-ink-200 outline-none"
      />
      <span className="pointer-events-none sticky bottom-0 self-end px-2 pb-1 text-[0.59375rem] text-ink-600">
        {saveState === "saving"
          ? "saving…"
          : saveState === "error"
            ? "save failed"
            : saveState === "detached"
              ? "section removed on that note"
              : saveState === "saved"
                ? "saved"
                : ""}
      </span>
    </div>
  );
}
