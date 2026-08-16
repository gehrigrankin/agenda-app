"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { LexicalEditor, SerializedEditorState } from "lexical";
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
import { SaveFailureBanner, SaveStatusChip } from "@/components/notes/SaveStatus";
import { useNoteAutosave } from "@/lib/hooks/use-note-autosave";
import {
  clearUnsavedStash,
  readUnsavedStash,
  type UnsavedStash,
} from "@/lib/unsaved-content";
import {
  listFolderBubblesAction,
  moveNoteToBubbleAction,
  trashNoteAction,
  type FolderBubbleResult,
} from "@/app/app/actions";

export interface NoteEditorProps {
  noteId: string;
  initialTitle: string;
  initialContent: SerializedEditorState | null;
  initialContentRevision: number;
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
  initialContentRevision,
  initialBubbleId = null,
  onClose,
  trashAction = trashNoteAction,
  onTrashed,
}: NoteEditorProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [isTrashing, setIsTrashing] = useState(false);
  // Optimistic view of which folder bubble the note lives in.
  const [bubbleId, setBubbleId] = useState<string | null>(initialBubbleId);

  const { status, initialStateJSON, onTitleChange, onEditorChange } =
    useNoteAutosave(noteId, initialContent, initialContentRevision);

  // Content a previous session couldn't persist (see UnsavedStash). Read once
  // per note, after mount — localStorage doesn't exist on the server.
  const editorRef = useRef<LexicalEditor | null>(null);
  const [stash, setStash] = useState<UnsavedStash | null>(null);
  useEffect(() => {
    setStash(readUnsavedStash(noteId));
  }, [noteId]);

  const discardStash = () => {
    clearUnsavedStash(noteId);
    setStash(null);
  };

  const restoreStash = () => {
    const editor = editorRef.current;
    if (!editor || !stash) return;
    try {
      editor.setEditorState(editor.parseEditorState(stash.content));
      // The state change fires OnChangePlugin, so the restored document saves
      // itself on the normal debounce — and clears the stash when it lands.
    } catch (err) {
      console.error("[notes] failed to restore unsaved changes:", err);
    }
    setStash(null);
  };

  const handleTitleChange = (next: string) => {
    setTitle(next);
    onTitleChange(next);
  };

  const noteTaskCtx = useMemo(() => ({ noteId }), [noteId]);

  // Only the full-page note view (/app/notes/[id]) passes neither onClose nor
  // onTrashed — dock windows, quick-view overlays, and the bubble zoom editor
  // all provide one of them. Those embedded surfaces must not grow the
  // phone-only bottom toolbar (md:hidden is the backstop, this is the gate).
  const isFullPage = !onClose && !onTrashed;

  const onTrash = async () => {
    if (isTrashing) return;
    setIsTrashing(true);
    try {
      await trashAction(noteId);
      if (onTrashed) {
        onTrashed();
      } else {
        // Full-page note view (no dock/quick-view override): the server
        // action no longer redirects, so navigate here instead of leaving
        // the user on a note that's now in Trash.
        router.push("/app/notes");
      }
    } catch {
      setIsTrashing(false);
      router.refresh();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-14 items-center gap-1 border-b border-white/10 px-2 py-1 md:min-h-0 md:gap-2 md:px-4 md:py-2">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Back"
            className="flex h-11 w-11 items-center justify-center rounded-full text-ink-500 hover:bg-white/8 md:h-auto md:w-auto md:rounded md:p-1.5"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <input
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Untitled"
          aria-label="Note title"
          className="min-w-0 flex-1 bg-transparent text-[1rem] font-semibold outline-none placeholder:text-ink-400 md:text-lg"
        />
        <SaveStatusChip status={status} />
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
          className="flex h-11 w-11 items-center justify-center rounded-full text-ink-500 hover:bg-red-950 hover:text-red-600 disabled:opacity-50 md:h-auto md:w-auto md:rounded md:p-1.5"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </header>

      {/* Why the save didn't land, spelled out — above the stash banner, since
          the failure is the thing still happening. */}
      <SaveFailureBanner status={status} />

      {stash && (
        // Work the server never accepted, held back from the reload that would
        // have destroyed it. Never applied automatically: the copy on screen
        // may well be the newer one, and silently overwriting it would be the
        // very failure this is here to prevent.
        <div className="flex flex-none items-center gap-2 border-b border-amber-500/25 bg-amber-500/8 px-4 py-2">
          <AlertCircle className="h-3.5 w-3.5 flex-none text-amber-400" />
          <span className="min-w-0 flex-1 text-[0.75rem] text-ink-300">
            Unsaved changes from {formatStashAge(stash.at)} didn&rsquo;t reach
            the server.
          </span>
          <button
            type="button"
            onClick={restoreStash}
            className="flex-none rounded-md bg-amber-500/20 px-2 py-1 text-[0.6875rem] font-medium text-amber-200 hover:bg-amber-500/30"
          >
            Restore them
          </button>
          <button
            type="button"
            onClick={discardStash}
            className="flex-none rounded-md px-2 py-1 text-[0.6875rem] font-medium text-ink-400 hover:bg-white/6 hover:text-ink-200"
          >
            Discard
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        {/* Task nodes need to know which note hosts them (to link new tasks). */}
        <NoteTaskContext.Provider value={noteTaskCtx}>
          {/* `key` forces a fresh editor when navigating between notes. */}
          <Editor
            key={noteId}
            noteId={noteId}
            editorRef={editorRef}
            initialStateJSON={initialStateJSON}
            onChange={onEditorChange}
            mobileToolbar={isFullPage}
            acceptExternalAppend
          />
        </NoteTaskContext.Provider>
      </div>
    </div>
  );
}

/** "a few minutes ago" / "at 9:42 PM" — enough to recognise which edits these were. */
function formatStashAge(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "a moment ago";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  return `earlier, at ${new Date(at).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

/** Close the dropdown on Escape (only while it's open). */
function useEscapeKey(active: boolean, onEscape: () => void) {
  const handlerRef = useRef(onEscape);
  handlerRef.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Capture + stopPropagation: the dropdown is the innermost Esc layer,
        // so outer document listeners (e.g. QuickViewOverlay's) must not also
        // close on the same keypress.
        e.stopPropagation();
        handlerRef.current();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
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
        className={`flex h-11 w-11 items-center justify-center rounded-full md:h-auto md:w-auto md:rounded md:p-1.5 ${
          currentBubbleId
            ? "text-steel hover:bg-steel/10"
            : "text-ink-500 hover:bg-white/8"
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
          <div className="absolute right-0 top-full z-40 mt-1 w-60 rounded-lg border border-white/8 bg-card py-1 shadow-xl">
            {loading ? (
              <div className="flex items-center justify-center py-3 text-ink-600">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : folders === null ? (
              <div className="px-3 py-2 text-xs italic text-ink-600">
                Couldn&rsquo;t load folders — try again.
              </div>
            ) : (
              <>
                <FolderMenuItem
                  selected={currentBubbleId === null}
                  onClick={() => pick(null)}
                  icon={<X className="h-3.5 w-3.5 shrink-0 text-ink-400" />}
                >
                  No folder
                </FolderMenuItem>
                {folders.length === 0 ? (
                  <div className="px-3 py-2 text-xs italic text-ink-600">
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
                          <Folder className="h-3.5 w-3.5 shrink-0 text-steel" />
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
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink-300 hover:bg-white/6"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {selected && <Check className="h-3.5 w-3.5 shrink-0 text-sage" />}
    </button>
  );
}
