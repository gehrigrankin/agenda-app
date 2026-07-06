"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FileText, Loader2, Pin, Plus, Sun } from "lucide-react";

import { createNoteAction } from "@/app/app/actions";

/**
 * Notes list pane (design Turn 9a): the daily note pinned first as the
 * sage-tinted row, then standalone notes with time + one-line preview. On
 * mobile the pane hides once a note is open (the detail takes the screen).
 */

export interface DailyRowData {
  id: string;
  title: string;
  updatedAt: string; // ISO
}

export interface NoteRowData {
  id: string;
  title: string;
  preview: string;
  updatedAt: string; // ISO
}

/** "2:15 PM" if updated today (client-local), else "Jul 3". */
function formatWhen(iso: string, now: Date): string {
  const d = new Date(iso);
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Detail container: on mobile it only shows once a note is selected (the list
 * pane and detail swap); on md+ both panes are always visible.
 */
export function NotesDetailPane({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const activeId = typeof params.id === "string" ? params.id : null;
  return (
    <div
      className={`min-w-0 flex-1 border-l border-white/7 md:block ${
        activeId ? "block" : "hidden"
      }`}
    >
      {children}
    </div>
  );
}

export function NotesListPane({
  daily,
  notes,
}: {
  daily: DailyRowData | null;
  notes: NoteRowData[];
}) {
  const params = useParams();
  const activeId = typeof params.id === "string" ? params.id : null;
  const [isCreating, startCreate] = useTransition();

  // Time labels are client-local; render them after mount so SSR markup stays
  // deterministic (the server's timezone would otherwise leak in).
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
  }, []);

  return (
    <div
      className={`w-full flex-none flex-col overflow-y-auto border-r border-white/7 p-2 md:flex md:w-[18.75rem] ${
        activeId ? "hidden" : "flex"
      }`}
    >
      <div className="flex flex-none items-center gap-2 px-2 pb-2 pt-1.5">
        <FileText className="h-3.5 w-3.5 text-steel" />
        <span className="text-[0.8125rem] font-semibold text-ink-100">Notes</span>
        <span className="text-[0.6875rem] text-ink-600">{notes.length}</span>
        <button
          type="button"
          aria-label="New note"
          disabled={isCreating}
          onClick={() => startCreate(() => createNoteAction())}
          className="ml-auto flex h-[1.375rem] w-[1.375rem] items-center justify-center rounded-md bg-white/6 hover:bg-white/10 disabled:opacity-60"
        >
          {isCreating ? (
            <Loader2 className="h-3 w-3 animate-spin text-ink-400" />
          ) : (
            <Plus className="h-3 w-3 text-ink-400" />
          )}
        </button>
      </div>

      {daily && (
        <>
          <Link
            href={`/app/notes/${daily.id}`}
            className={`block rounded-[0.625rem] border p-2.5 ${
              activeId === daily.id
                ? "border-sage/50 bg-sage/15"
                : "border-sage/35 bg-sage/10 hover:bg-sage/15"
            }`}
          >
            <span className="flex items-center gap-2">
              <Sun className="h-[0.8125rem] w-[0.8125rem] flex-none text-sage" />
              <span className="min-w-0 flex-1 truncate text-[0.78125rem] font-semibold leading-[1.3] text-ink-100">
                {daily.title}
              </span>
              <Pin className="h-[0.6875rem] w-[0.6875rem] flex-none text-sage" />
            </span>
            <span className="mt-1 block text-[0.6875rem] leading-normal text-[#9CB3A4]">
              Daily note
              {now ? ` · last written ${formatWhen(daily.updatedAt, now)}` : ""}
            </span>
          </Link>
          <div className="mx-1.5 my-1.5 h-px flex-none bg-white/6" />
        </>
      )}

      {notes.length === 0 ? (
        <p className="px-2.5 py-4 text-[0.75rem] text-ink-600">
          No notes yet — create one with the + above.
        </p>
      ) : (
        notes.map((n) => (
          <Link
            key={n.id}
            href={`/app/notes/${n.id}`}
            className={`block rounded-[0.5625rem] px-2.5 py-2.5 ${
              activeId === n.id ? "bg-white/6" : "hover:bg-white/4"
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[0.78125rem] font-medium leading-[1.3] text-ink-200">
                {n.title || "Untitled"}
              </span>
              <span className="flex-none text-[0.625rem] font-medium text-ink-600">
                {now ? formatWhen(n.updatedAt, now) : ""}
              </span>
            </span>
            <span className="mt-1 block truncate text-[0.6875rem] leading-normal text-[#7B837F]">
              {n.preview || "Empty note"}
            </span>
          </Link>
        ))
      )}
    </div>
  );
}
