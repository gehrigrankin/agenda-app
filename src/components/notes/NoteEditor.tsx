"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { EditorState, SerializedEditorState } from "lexical";
import { AlertCircle, ArrowLeft, Check, Loader2, Trash2 } from "lucide-react";

import { Editor } from "@/components/editor/Editor";
import { NoteTaskContext } from "@/components/editor/nodes/TaskNode";
import { useDebouncedCallback } from "@/lib/hooks/use-debounced-callback";
import {
  renameNoteAction,
  saveNoteContentAction,
  trashNoteAction,
} from "@/app/app/actions";

type SaveState = "idle" | "saving" | "saved" | "error";

export interface NoteEditorProps {
  noteId: string;
  initialTitle: string;
  initialContent: SerializedEditorState | null;
  /** When provided, shows a back button in the header (e.g. for overlays). */
  onClose?: () => void;
  /** Override the trash action (defaults to the standalone-note trash). */
  trashAction?: (id: string) => Promise<void>;
  /** Called after a successful trash (e.g. close an overlay). */
  onTrashed?: () => void;
}

export function NoteEditor({
  noteId,
  initialTitle,
  initialContent,
  onClose,
  trashAction = trashNoteAction,
  onTrashed,
}: NoteEditorProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [isTrashing, setIsTrashing] = useState(false);

  const initialStateJSON = initialContent
    ? JSON.stringify(initialContent)
    : null;

  // Track in-flight saves so the indicator only shows "saved" once settled.
  const pendingRef = useRef(0);
  const failedRef = useRef(false);
  // Last content we persisted (or scheduled to persist), serialized. Lets us
  // skip the OnChangePlugin's mount-time fire (which would otherwise bump
  // updatedAt and reorder the sidebar on every open) and any other no-change
  // updates.
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

  const onTitleChange = (next: string) => {
    setTitle(next);
    setSaveState("saving");
    saveTitle(next);
  };

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

  const noteTaskCtx = useMemo(() => ({ noteId }), [noteId]);

  const onTrash = async () => {
    if (isTrashing) return;
    setIsTrashing(true);
    try {
      await trashAction(noteId);
      onTrashed?.();
    } catch {
      setIsTrashing(false);
      router.refresh();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800 md:px-4">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Back"
            className="rounded p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Untitled"
          aria-label="Note title"
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none placeholder:text-neutral-400"
        />
        <SaveIndicator state={saveState} />
        <button
          type="button"
          onClick={onTrash}
          disabled={isTrashing}
          aria-label="Move note to Trash"
          title="Move to Trash"
          className="rounded p-1.5 text-neutral-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {/* Task nodes need to know which note hosts them (to link new tasks). */}
        <NoteTaskContext.Provider value={noteTaskCtx}>
          {/* `key` forces a fresh editor when navigating between notes. */}
          <Editor
            key={noteId}
            initialStateJSON={initialStateJSON}
            onChange={onEditorChange}
          />
        </NoteTaskContext.Provider>
      </div>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  return (
    <span className="flex items-center gap-1 text-xs text-neutral-400">
      {state === "saving" ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          Saving…
        </>
      ) : state === "error" ? (
        <span className="flex items-center gap-1 text-red-500">
          <AlertCircle className="h-3 w-3" />
          Save failed
        </span>
      ) : (
        <>
          <Check className="h-3 w-3" />
          Saved
        </>
      )}
    </span>
  );
}
