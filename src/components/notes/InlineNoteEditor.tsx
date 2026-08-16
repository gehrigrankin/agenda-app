"use client";

import { useEffect, useState } from "react";
import type { SerializedEditorState } from "lexical";
import { Loader2 } from "lucide-react";

import { getNoteAction, type NoteDetailResult } from "@/app/app/actions";
import { Editor } from "@/components/editor/Editor";
import { SaveStatusChip } from "@/components/notes/SaveStatus";
import { useNoteAutosave } from "@/lib/hooks/use-note-autosave";

/**
 * A compact, autosaving editor for a note embedded INSIDE another surface —
 * the linked-note card's in-place edit mode. Loaded via next/dynamic by the
 * card (a static import would cycle: Editor's node list includes the card).
 */
export default function InlineNoteEditor({
  noteId,
  initialContent,
  initialContentRevision,
}: {
  noteId: string;
  /** Already-loaded content (the card's preview) — skips the fetch so the
   * preview→editor swap is instant instead of flashing a spinner. */
  initialContent?: SerializedEditorState | null;
  initialContentRevision?: number;
}) {
  // undefined = loading, null = unavailable.
  const [note, setNote] = useState<NoteDetailResult | null | undefined>(
    undefined,
  );

  const haveContent = initialContent !== undefined;
  useEffect(() => {
    if (haveContent) return;
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
  }, [noteId, haveContent]);

  if (haveContent) {
    return (
      <LoadedInlineEditor
        note={{
          id: noteId,
          content: initialContent ?? null,
          contentRevision: initialContentRevision ?? 0,
        }}
      />
    );
  }
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

function LoadedInlineEditor({
  note,
}: {
  note: Pick<NoteDetailResult, "id" | "content" | "contentRevision">;
}) {
  const { initialStateJSON, onEditorChange, status } = useNoteAutosave(
    note.id,
    note.content,
    note.contentRevision,
  );
  return (
    // Tall enough to read a real entry without scrolling inside a card that is
    // itself inside a scrolling note. 18rem cut most entries off mid-thought.
    <div className="flex max-h-[32rem] min-h-[7rem] flex-col overflow-y-auto">
      <Editor
        hideToolbar
        initialStateJSON={initialStateJSON}
        onChange={onEditorChange}
        contentClassName="editor-content min-h-[6rem] w-full px-3.5 py-3 text-[0.8125rem] leading-relaxed text-ink-200 outline-none"
      />
      {/* Click-through as before, except for the Retry button the chip grows
          when a save fails (see pointer-events-auto in SaveStatusChip). */}
      <span className="pointer-events-none sticky bottom-0 self-end px-2 pb-1">
        <SaveStatusChip status={status} compact />
      </span>
    </div>
  );
}
