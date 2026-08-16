"use client";

import { useCallback, useEffect, useRef } from "react";
import type { EditorState, SerializedEditorState } from "lexical";

import { renameNoteAction } from "@/app/app/actions";
import { runAutomationsForNoteAction } from "@/app/app/ai/actions";
import { localDateString } from "@/lib/dates";
import {
  initialSaveBaseline,
  isLoadedEditorContent,
} from "@/lib/editor-save-baseline";
import { SaveRejected } from "@/lib/save-failure";
import { saveNoteContentRequest } from "@/lib/note-content-transport";
import {
  clearUnsavedStash,
  writeUnsavedStash,
} from "@/lib/unsaved-content";
import { useDebouncedCallback } from "./use-debounced-callback";
import { useSaveRetry } from "./use-save-retry";

export type { SaveState, SaveStatus } from "./use-save-retry";

/**
 * Quiet period after the last content save before the user's automations run
 * against the note. Long enough that a mid-thought pause doesn't fire rules
 * on a half-typed line; the server throttles per note on top of this.
 */
const AUTOMATIONS_IDLE_MS = 20_000;

/** The two things a note autosaves; each supersedes its own kind, not the other. */
type SaveKind = "content" | "title";

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
  const initialStateJSON = initialContent
    ? JSON.stringify(initialContent)
    : null;
  // Last content we persisted (or scheduled to persist), serialized. Lets us
  // skip the OnChangePlugin's mount-time fire (which would otherwise bump
  // updatedAt and reorder lists on every open) and other no-change updates.
  // Seeded from the editor's FIRST change fire, not from `initialContent`:
  // Postgres jsonb canonicalizes object key order, so the DB round-trip of
  // the same state stringifies differently than Lexical's serialization and
  // would never match.
  const lastSavedJSONRef = useRef<string | null>(null);
  // Unlike lastSavedJSONRef, this advances only after the server acknowledges
  // a write. A failed newer save must roll back to confirmed content, not to
  // an older queued save that may also have failed.
  const lastPersistedJSONRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  // Latest state visible in the editor. An older in-flight save must not clear
  // the recovery copy for newer keystrokes that are still in the debounce.
  const latestEditorJSONRef = useRef<string | null>(null);
  const {
    status,
    runSave,
    markSaving,
    markPendingCancelled,
    discardFailed,
  } = useSaveRetry<SaveKind>();

  const saveTitle = useDebouncedCallback((next: string) => {
    void runSave("title", {
      work: async () => {
        const res = await renameNoteAction(noteId, next);
        if (!res.ok) throw new SaveRejected(res.failure);
      },
    });
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
      lastSavedJSONRef.current = json;
      void runSave("content", {
        work: async () => {
          const res = await saveNoteContentRequest(noteId, state);
          // The server refused and said why — carry that through so the
          // editor shows the reason instead of a bare "save failed".
          if (!res.ok) throw new SaveRejected(res.failure);
          lastPersistedJSONRef.current = json;
          // Landed — the stash (if any) is now behind the server's copy.
          if (latestEditorJSONRef.current === json) {
            clearUnsavedStash(noteId);
            dirtyRef.current = false;
          }
        },
        // Roll back so the next change retries instead of being skipped. The
        // content was stashed as soon as it became dirty, before the debounce.
        onFirstFailure: () => {
          if (lastSavedJSONRef.current === json) {
            lastSavedJSONRef.current = lastPersistedJSONRef.current;
          }
        },
      });
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
      markSaving();
      saveTitle(next);
    },
    [markSaving, saveTitle],
  );

  const onEditorChange = useCallback(
    (editorState: EditorState) => {
      const serialized = editorState.toJSON();
      const json = JSON.stringify(serialized);
      latestEditorJSONRef.current = json;
      if (json === lastSavedJSONRef.current) {
        // Back at the persisted baseline (e.g. the user undid a pending
        // edit): drop any armed save so it can't fire and persist content
        // the editor no longer shows.
        saveContent.cancel();
        discardFailed("content");
        if (dirtyRef.current) clearUnsavedStash(noteId);
        dirtyRef.current = false;
        markPendingCancelled();
        return;
      }
      if (lastSavedJSONRef.current === null) {
        const matchesLoaded = isLoadedEditorContent(serialized, initialContent);
        const baseline = initialSaveBaseline(serialized, initialContent);
        lastSavedJSONRef.current = baseline;
        lastPersistedJSONRef.current = baseline;
        // The first fire is USUALLY the editor's mount-time normalization of
        // the loaded content, which must not be saved (it would bump
        // updatedAt and reorder every list on mere opening).
        //
        // Usually — but OnChangePlugin runs with ignoreSelectionChange, so a
        // document that needs NO normalization fires nothing at mount, and
        // then the first fire is a real edit. Absorbing that unconditionally
        // silently dropped it. Typing hid the bug (the next keystroke saves
        // everything), but a one-shot change with no follow-up — folding a
        // task, toggling a card — was lost for good.
        //
        // So absorb it only when it really is the document we loaded. Compared
        // structurally, not by string: jsonb canonicalizes key order, so the
        // round-tripped copy never stringifies identically to Lexical's own
        // serialization.
        //
        // A note with NO stored content is still absorbed unconditionally: the
        // mount fire there is Lexical's empty document, which is not equal to
        // `null` by any comparison and would save on every open.
        if (matchesLoaded) return;
      }
      // Persist dirty content before the debounce/request so a reload at any
      // point in the save window cannot destroy the only copy.
      dirtyRef.current = true;
      writeUnsavedStash(noteId, serialized);
      markSaving();
      saveContent(json, serialized);
    },
    [discardFailed, initialContent, markPendingCancelled, markSaving, noteId, saveContent],
  );

  return {
    saveState: status.state,
    status,
    initialStateJSON,
    onTitleChange,
    onEditorChange,
  };
}
