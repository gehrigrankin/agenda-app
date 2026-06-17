import { auth } from "@clerk/nextjs/server";
import { NotebookPen } from "lucide-react";

import { NewNoteButton } from "@/components/notes/NewNoteButton";
import { listNotesForSidebar } from "@/server/notes";

export default async function AppHomePage() {
  const { userId } = await auth();
  const notes = userId ? await listNotesForSidebar(userId) : [];

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 p-8 text-center">
      <NotebookPen className="h-10 w-10 text-neutral-300" />
      <div>
        <h1 className="text-lg font-medium">
          {notes.length === 0 ? "Create your first note" : "Pick a note"}
        </h1>
        <p className="mt-1 max-w-sm text-balance text-sm text-neutral-500">
          {notes.length === 0
            ? "Notes autosave as you type. Tasks, folders, and a daily agenda come next."
            : "Choose a note from the sidebar, or start a new one."}
        </p>
      </div>
      <NewNoteButton variant="cta" />
    </div>
  );
}
