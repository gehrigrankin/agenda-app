"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText } from "lucide-react";

import type { NoteSummary } from "@/server/notes";

export function NoteList({
  notes,
  onNavigate,
}: {
  notes: NoteSummary[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  if (notes.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded px-2 py-1 text-neutral-400">
        <FileText className="h-4 w-4" />
        <span className="italic">No notes yet</span>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {notes.map((note) => {
        const href = `/app/notes/${note.id}`;
        const active = pathname === href;
        return (
          <li key={note.id}>
            <Link
              href={href}
              onClick={onNavigate}
              className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm ${
                active
                  ? "bg-neutral-200/70 font-medium dark:bg-neutral-800"
                  : "text-neutral-700 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800"
              }`}
            >
              <FileText className="h-4 w-4 shrink-0 text-neutral-400" />
              <span className="truncate">{note.title || "Untitled"}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
