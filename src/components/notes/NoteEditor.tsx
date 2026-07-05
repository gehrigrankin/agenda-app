"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { EditorState, SerializedEditorState } from "lexical";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Folder,
  Loader2,
  Trash2,
  X,
} from "lucide-react";

import { Editor } from "@/components/editor/Editor";
import { NoteTaskContext } from "@/components/editor/nodes/TaskNode";
import { useDebouncedCallback } from "@/lib/hooks/use-debounced-callback";
import {
  listFolderBubblesAction,
  moveNoteToBubbleAction,
  renameNoteAction,
  saveNoteContentAction,
  trashNoteAction,
  type FolderBubbleResult,
} from "@/app/app/actions";

type SaveState = "idle" | "saving" | "saved" | "error";

export interface NoteEditorProps {
  noteId: string;
  initialTitle: string;
  initialContent: SerializedEditorState | null;
  /** The bubble folder the note currently lives in (null/omitted = none). */
  initialBubbleId?: string | null;
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
  initialBubbleId = null,
  onClose,
  trashAction = trashNoteAction,
  onTrashed,
}: NoteEditorProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [isTrashing, setIsTrashing] = useState(false);
  // Optimistic view of which folder bubble the note lives in.
  const [bubbleId, setBubbleId] = useState<string | null>(initialBubbleId);

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
        <FolderMenu
          noteId={noteId}
          currentBubbleId={bubbleId}
          onMoved={setBubbleId}
        />
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

/** Close the dropdown on Escape (only while it's open). */
function useEscapeKey(active: boolean, onEscape: () => void) {
  const handlerRef = useRef(onEscape);
  handlerRef.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handlerRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active]);
}

/**
 * Header control to move the note into/out of a bubble folder (bubbles with
 * `isFolder` — the app's folder system). Folders are fetched lazily on first
 * open; the checkmark tracks the optimistic `currentBubbleId` from the parent.
 */
function FolderMenu({
  noteId,
  currentBubbleId,
  onMoved,
}: {
  noteId: string;
  currentBubbleId: string | null;
  onMoved: (bubbleId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [folders, setFolders] = useState<FolderBubbleResult[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEscapeKey(open, () => setOpen(false));

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next && folders === null && !loading) {
      setLoading(true);
      listFolderBubblesAction()
        .then(setFolders)
        .catch((err) => console.error("[notes] load folders failed:", err))
        .finally(() => setLoading(false));
    }
  };

  const pick = (bubbleId: string | null) => {
    setOpen(false);
    if (bubbleId === currentBubbleId) return;
    const prev = currentBubbleId;
    // Optimistic: flip the checkmark immediately, roll back on failure.
    onMoved(bubbleId);
    void moveNoteToBubbleAction(noteId, bubbleId).catch((err) => {
      console.error("[notes] move to folder failed:", err);
      onMoved(prev);
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        aria-label="Move to folder"
        title="Move to folder"
        className={`rounded p-1.5 ${
          currentBubbleId
            ? "text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
            : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        }`}
      >
        <Folder
          className={`h-4 w-4 ${currentBubbleId ? "fill-current" : ""}`}
        />
      </button>

      {open && (
        <>
          {/* Backdrop: click anywhere outside to close. */}
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default"
          />
          <div className="absolute right-0 top-full z-40 mt-1 w-60 rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
            {loading ? (
              <div className="flex items-center justify-center py-3 text-neutral-400">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : folders === null ? (
              <div className="px-3 py-2 text-xs italic text-neutral-400">
                Couldn&rsquo;t load folders — try again.
              </div>
            ) : (
              <>
                <FolderMenuItem
                  selected={currentBubbleId === null}
                  onClick={() => pick(null)}
                  icon={<X className="h-3.5 w-3.5 shrink-0 text-neutral-400" />}
                >
                  No folder
                </FolderMenuItem>
                {folders.length === 0 ? (
                  <div className="px-3 py-2 text-xs italic text-neutral-400">
                    No folders yet — mark a bubble as a folder in the Bubble
                    map.
                  </div>
                ) : (
                  folders.map((f) => (
                    <FolderMenuItem
                      key={f.id}
                      selected={currentBubbleId === f.id}
                      onClick={() => pick(f.id)}
                      icon={
                        f.emoji ? (
                          <span className="w-3.5 shrink-0 text-center text-xs leading-none">
                            {f.emoji}
                          </span>
                        ) : (
                          <Folder className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                        )
                      }
                    >
                      {f.title || "Untitled"}
                    </FolderMenuItem>
                  ))
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function FolderMenuItem({
  selected,
  onClick,
  icon,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {selected && <Check className="h-3.5 w-3.5 shrink-0 text-blue-500" />}
    </button>
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
