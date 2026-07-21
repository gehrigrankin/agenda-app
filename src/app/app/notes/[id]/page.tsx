import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import type { SerializedEditorState } from "lexical";
import { Link2 } from "lucide-react";

import { NoteEditor } from "@/components/notes/NoteEditor";
import { getNote, listBacklinks, touchNoteOpened } from "@/server/notes";

export default async function NotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) notFound();

  const note = await getNote(userId, id).catch((err) => {
    console.error("[app] failed to load note:", err);
    return null;
  });
  if (!note || note.deletedAt) notFound();

  // Recently-opened bookkeeping; never worth failing the page over.
  await touchNoteOpened(userId, id).catch((err) => {
    console.error("[app] failed to stamp note open:", err);
  });

  // Backlinks are decorative — never let them take down the note page.
  const backlinks = await listBacklinks(userId, id).catch((err) => {
    console.error("[app] failed to load backlinks:", err);
    return [];
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
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

      {backlinks.length > 0 && (
        <div className="flex max-h-24 flex-wrap items-center gap-1.5 overflow-y-auto border-t border-neutral-200 px-4 py-2 dark:border-neutral-800">
          <span className="shrink-0 text-xs text-neutral-400">
            Linked from:
          </span>
          {backlinks.map((b) => (
            <Link
              key={b.id}
              href={`/app/notes/${b.id}`}
              className="flex max-w-48 items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              <Link2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{b.title || "Untitled"}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
