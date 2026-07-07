"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorState, SerializedEditorState } from "lexical";

import {
  renameNoteAction,
  saveNoteContentAction,
} from "@/app/app/actions";
import { runAutomationsForNoteAction } from "@/app/app/ai/actions";
import { localDateString } from "@/lib/dates";
import { useDebouncedCallback } from "./use-debounced-callback";

/**
 * Quiet period after the last content save before the user's automations run
 * against the note. Long enough that a mid-thought pause doesn't fire rules
 * on a half-typed line; the server throttles per note on top of this.
 */
const AUTOMATIONS_IDLE_MS = 20_000;

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
  // Seeded from the editor's FIRST change fire, not from `initialContent`:
  // Postgres jsonb canonicalizes object key order, so the DB round-trip of
  // the same state stringifies differently than Lexical's serialization and
  // would never match.
  const lastSavedJSONRef = useRef<string | null>(null);
  // Saves are chained so an earlier slow request can't land after (and
  // overwrite) a later one — the server action is a last-write-wins UPDATE.
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  const runSave = useCallback(
    async (work: () => Promise<void>, onError?: () => void) => {
      pendingRef.current += 1;
      setSaveState("saving");
      const task = chainRef.current.then(work);
      chainRef.current = task.then(
        () => undefined,
        () => undefined,
      );
      try {
        await task;
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

  // Fire-and-forget: after the note has been quiet for a while, let the
  // user's automations look at it. Returns immediately when no rules exist;
  // failures are silently dropped (automations are additive, never blocking).
  // Actions taken are announced via a window event that AutomationToasts
  // (mounted in AppShell) renders — same literal event name in both files.
  const runAutomations = useDebouncedCallback(() => {
    runAutomationsForNoteAction(noteId, localDateString())
      .then((results) => {
        if (results.length === 0) return;
        window.dispatchEvent(
          new CustomEvent("agenda:automations-ran", { detail: results }),
        );
      })
      .catch(() => {});
  }, AUTOMATIONS_IDLE_MS);

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
      runAutomations();
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
      if (json === lastSavedJSONRef.current) {
        // Back at the persisted baseline (e.g. the user undid a pending
        // edit): drop any armed save so it can't fire and persist content
        // the editor no longer shows.
        saveContent.cancel();
        if (pendingRef.current === 0) {
          setSaveState((s) => (s === "saving" ? "saved" : s));
        }
        return;
      }
      if (lastSavedJSONRef.current === null) {
        // First fire is the editor's mount-time normalization of the loaded
        // content (or the empty state of a brand-new note); absorb it as the
        // baseline rather than saving it.
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
