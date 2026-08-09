import Link from "next/link";
import { notFound } from "next/navigation";
import type { SerializedEditorState } from "lexical";
import { Link2 } from "lucide-react";

import { NoteEditor } from "@/components/notes/NoteEditor";
import { NoteLogsPanel } from "@/components/notes/NoteLogsPanel";
import { listLogsForNote } from "@/server/note-logs";
import { getNote, listBacklinks, touchNoteOpened } from "@/server/notes";

import { getOwnerId } from "../../owner";

export default async function NotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ownerId = await getOwnerId();
  if (!ownerId) notFound();

  const note = await getNote(ownerId, id).catch((err) => {
    console.error("[app] failed to load note:", err);
    return null;
  });
  if (!note || note.deletedAt) notFound();

  // Recently-opened bookkeeping; never worth failing the page over.
  await touchNoteOpened(ownerId, id).catch((err) => {
    console.error("[app] failed to stamp note open:", err);
  });

  // Both are decorative — never let them take down the note page.
  const [backlinks, logs] = await Promise.all([
    listBacklinks(ownerId, id).catch((err) => {
      console.error("[app] failed to load backlinks:", err);
      return [];
    }),
    listLogsForNote(ownerId, id).catch((err) => {
      console.error("[app] failed to load logs:", err);
      return [];
    }),
  ]);

  return (
    // The logs rail is a sibling COLUMN at xl+, so the editor and the rail
    // scroll independently; under xl it falls back to a capped strip stacked
    // above the backlinks.
    <div className="flex h-full min-h-0">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1">
        <NoteEditor
          // Keyed so switching notes remounts the editor: without this, title
          // state goes stale and a pending debounced save from the previous note
          // could fire with the new note's id.
          key={note.id}
          noteId={note.id}
          initialTitle={note.title}
          initialContent={(note.content as SerializedEditorState | null) ?? null}
          initialBubbleId={note.bubbleId}
        />
      </div>

      <NoteLogsPanel logs={logs} variant="stacked" />

      {backlinks.length > 0 && (
        <div className="flex max-h-24 flex-wrap items-center gap-1.5 overflow-y-auto border-t border-white/10 px-4 py-2">
          <span className="shrink-0 text-xs text-ink-400">
            Linked from:
          </span>
          {backlinks.map((b) => (
            <Link
              key={b.id}
              href={`/app/notes/${b.id}`}
              className="flex max-w-48 items-center gap-1 rounded-full bg-white/8 px-2 py-0.5 text-xs text-ink-300 hover:bg-white/12"
            >
              <Link2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{b.title || "Untitled"}</span>
            </Link>
          ))}
        </div>
      )}
      </div>

      <NoteLogsPanel logs={logs} variant="aside" />
    </div>
  );
}
