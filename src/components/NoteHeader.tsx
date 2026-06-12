"use client";

import { useStore } from "@/lib/store";
import type { Note } from "@/lib/types";

export default function NoteHeader({ note }: { note: Note }) {
  const { data, dispatch } = useStore();
  const section = data.sections.find((s) => s.id === note.sectionId);
  const folder = note.folderId
    ? data.folders.find((f) => f.id === note.folderId)
    : null;

  return (
    <div className="border-b border-zinc-200 px-6 pb-3 pt-5 dark:border-zinc-800">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-zinc-400">
        {section && (
          <>
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: section.color }}
            />
            <span>{section.name}</span>
          </>
        )}
        {folder && <span>/ {folder.name}</span>}
        <span className="ml-auto">
          Edited {new Date(note.updatedAt).toLocaleString()}
        </span>
      </div>
      <input
        value={note.title}
        onChange={(e) =>
          dispatch({ type: "renameNote", id: note.id, title: e.target.value })
        }
        placeholder="Untitled"
        className="w-full bg-transparent text-2xl font-bold outline-none placeholder:text-zinc-300"
      />
    </div>
  );
}
