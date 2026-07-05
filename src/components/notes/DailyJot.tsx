"use client";

import { useEffect, useState } from "react";
import type { SerializedEditorState } from "lexical";
import { Loader2 } from "lucide-react";

import { NoteEditor } from "@/components/notes/NoteEditor";
import { getOrCreateTodayNoteAction } from "@/app/app/actions";

interface TodayNote {
  id: string;
  title: string;
  content: SerializedEditorState | null;
}

/** The user's local calendar date as YYYY-MM-DD (why this lives on the client). */
function localDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Resolves today's daily jot (get-or-create via server action, using the
 * CLIENT's local date since the server can't know the user's timezone) and
 * renders the standard NoteEditor inline.
 */
export function DailyJot() {
  const [note, setNote] = useState<TodayNote | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getOrCreateTodayNoteAction(localDateString())
      .then((n) => {
        if (!cancelled) setNote(n);
      })
      .catch((err) => {
        console.error("[daily] failed to resolve today's note:", err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-neutral-500">
        Couldn&rsquo;t load today&rsquo;s note. Refresh to try again.
      </div>
    );
  }

  if (!note) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 p-8 text-sm text-neutral-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Opening today&rsquo;s note…
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <NoteEditor
        key={note.id}
        noteId={note.id}
        initialTitle={note.title}
        initialContent={note.content}
      />
    </div>
  );
}
