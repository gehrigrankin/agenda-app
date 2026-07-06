"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { getNoteAction, type NoteDetailResult } from "@/app/app/actions";
import { Editor } from "@/components/editor/Editor";
import { useNoteAutosave } from "@/lib/hooks/use-note-autosave";

/**
 * A compact, autosaving editor for a note embedded INSIDE another surface —
 * the linked-note card's in-place edit mode. Loaded via next/dynamic by the
 * card (a static import would cycle: Editor's node list includes the card).
 */
export default function InlineNoteEditor({ noteId }: { noteId: string }) {
  // undefined = loading, null = unavailable.
  const [note, setNote] = useState<NoteDetailResult | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;
    getNoteAction(noteId)
      .then((n) => {
        if (!cancelled) setNote(n);
      })
      .catch((err) => {
        console.error("[inline-edit] load failed:", err);
        if (!cancelled) setNote(null);
      });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  if (note === undefined) {
    return (
      <div className="flex h-24 items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-ink-600" />
      </div>
    );
  }
  if (note === null) {
    return (
      <p className="p-3 text-[0.75rem] italic text-ink-600">
        Note unavailable — it may have been deleted.
      </p>
    );
  }
  return <LoadedInlineEditor note={note} />;
}

function LoadedInlineEditor({ note }: { note: NoteDetailResult }) {
  const { initialStateJSON, onEditorChange, saveState } = useNoteAutosave(
    note.id,
    note.content,
  );
  return (
    <div className="flex max-h-72 min-h-[6rem] flex-col overflow-y-auto">
      <Editor
        hideToolbar
        initialStateJSON={initialStateJSON}
        onChange={onEditorChange}
        contentClassName="editor-content min-h-[6rem] w-full px-3.5 py-3 text-[0.8125rem] leading-relaxed text-ink-200 outline-none"
      />
      <span className="pointer-events-none sticky bottom-0 self-end px-2 pb-1 text-[0.59375rem] text-ink-600">
        {saveState === "saving"
          ? "saving…"
          : saveState === "error"
            ? "save failed"
            : saveState === "saved"
              ? "saved"
              : ""}
      </span>
    </div>
  );
}
