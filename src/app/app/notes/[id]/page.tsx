import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import type { SerializedEditorState } from "lexical";

import { NoteEditor } from "@/components/notes/NoteEditor";
import { getNote } from "@/server/notes";

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

  return (
    <NoteEditor
      // Keyed so switching notes remounts the editor: without this, title
      // state goes stale and a pending debounced save from the previous note
      // could fire with the new note's id.
      key={note.id}
      noteId={note.id}
      initialTitle={note.title}
      initialContent={(note.content as SerializedEditorState | null) ?? null}
    />
  );
}
