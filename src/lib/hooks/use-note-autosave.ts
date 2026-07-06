"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorState, SerializedEditorState } from "lexical";

import {
  renameNoteAction,
  saveNoteContentAction,
} from "@/app/app/actions";
import { useDebouncedCallback } from "./use-debounced-callback";

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * The note autosave machinery, extracted verbatim from NoteEditor so the
 * daily-note widget shares identical behavior: debounced title/content saves,
 * an in-flight counter so the indicator only settles once all saves land,
 * no-change skipping keyed on the serialized JSON (including the editor's
 * mount-time normalization fire), and a best-effort pagehide flush.
 */
export function useNoteAutosave(
  noteId: string,
  initialContent: SerializedEditorState | null,
) {
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const initialStateJSON = initialContent
    ? JSON.stringify(initialContent)
    : null;

  // Track in-flight saves so the indicator only shows "saved" once settled.
  const pendingRef = useRef(0);
  const failedRef = useRef(false);
  // Last content we persisted (or scheduled to persist), serialized. Lets us
  // skip the OnChangePlugin's mount-time fire (which would otherwise bump
  // updatedAt and reorder lists on every open) and other no-change updates.
  const lastSavedJSONRef = useRef<string | null>(initialStateJSON);

  const runSave = useCallback(
    async (work: () => Promise<void>, onError?: () => void) => {
      pendingRef.current += 1;
      setSaveState("saving");
      try {
        await work();
      } catch (err) {
        failedRef.current = true;
        onError?.();
        console.error("[notes] save failed:", err);
      } finally {
        pendingRef.current -= 1;
        if (pendingRef.current === 0) {
          setSaveState(failedRef.current ? "error" : "saved");
          failedRef.current = false;
        }
      }
    },
    [],
  );

  const saveTitle = useDebouncedCallback((next: string) => {
    void runSave(() => renameNoteAction(noteId, next));
  }, 600);

  const saveContent = useDebouncedCallback(
    (json: string, state: SerializedEditorState) => {
      const prev = lastSavedJSONRef.current;
      lastSavedJSONRef.current = json;
      void runSave(
        () => saveNoteContentAction(noteId, state),
        // Roll back so the next change retries instead of being skipped.
        () => {
          if (lastSavedJSONRef.current === json) lastSavedJSONRef.current = prev;
        },
      );
    },
    800,
  );

  // Best-effort flush of pending saves when the tab is hidden/closed. The
  // server-action fetch may still be cut short by the browser, but this
  // narrows the data-loss window considerably.
  useEffect(() => {
    const flushAll = () => {
      saveTitle.flush();
      saveContent.flush();
    };
    window.addEventListener("pagehide", flushAll);
    return () => window.removeEventListener("pagehide", flushAll);
  }, [saveTitle, saveContent]);

  const onTitleChange = useCallback(
    (next: string) => {
      setSaveState("saving");
      saveTitle(next);
    },
    [saveTitle],
  );

  const onEditorChange = useCallback(
    (editorState: EditorState) => {
      const serialized = editorState.toJSON();
      const json = JSON.stringify(serialized);
      if (json === lastSavedJSONRef.current) return;
      if (lastSavedJSONRef.current === null) {
        // Brand-new note: the editor's mount normalization emits an empty
        // state; absorb it as the baseline rather than saving it.
        lastSavedJSONRef.current = json;
        return;
      }
      setSaveState("saving");
      saveContent(json, serialized);
    },
    [saveContent],
  );

  return { saveState, initialStateJSON, onTitleChange, onEditorChange };
}
