"use client";

import { useState } from "react";
import { NotebookPen } from "lucide-react";
import { StoreProvider, useStore } from "@/lib/store";
import Sidebar from "./Sidebar";
import NoteEditor from "./editor/NoteEditor";
import NoteHeader from "./NoteHeader";

function Workspace() {
  const { data, dispatch, hydrated } = useStore();
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  if (!hydrated) {
    return (
      <div className="flex h-screen items-center justify-center text-zinc-400">
        Loading…
      </div>
    );
  }

  const selectedNote = data.notes.find((n) => n.id === selectedNoteId) ?? null;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar selectedNoteId={selectedNoteId} onSelectNote={setSelectedNoteId} />
      <main className="flex min-w-0 flex-1 flex-col">
        {selectedNote ? (
          <>
            <NoteHeader note={selectedNote} />
            <div className="min-h-0 flex-1">
              <NoteEditor
                note={selectedNote}
                onSave={(content, textContent) =>
                  dispatch({
                    type: "updateNoteContent",
                    id: selectedNote.id,
                    content,
                    textContent,
                  })
                }
              />
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-zinc-400">
            <NotebookPen size={40} strokeWidth={1.5} />
            <p className="text-sm">Select a note, or create one from the sidebar.</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default function AppShell() {
  return (
    <StoreProvider>
      <Workspace />
    </StoreProvider>
  );
}
