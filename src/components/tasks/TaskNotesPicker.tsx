"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Link2, X } from "lucide-react";

import {
  attachTaskToNoteAction,
  detachTaskFromNoteAction,
  duplicateTaskToNoteAction,
  listNotesForTaskAction,
  moveTaskToNoteAction,
  searchNotesForTaskPickerAction,
  type TaskNoteLink,
} from "@/app/app/actions";

/**
 * NOTES action for a task row (editor checkbox, Tasks page row): lists every
 * note the task is attached to — each with an unlink — and, via a mode
 * picker, attaches it to another note as a MOVE (detach here, attach there),
 * a MIRROR ("show on": attach there too, same row, shared completion), or a
 * DUPLICATE (a new independent task there).
 *
 * Fetches its own linked-notes list on mount (not lazily on open) so the
 * trigger can carry an "on N notes" badge — the shared-ness indicator —
 * without every caller wiring that up separately.
 */

const DEBOUNCE_MS = 200;

type Mode = "mirror" | "move" | "duplicate";

const MODES: [Mode, string][] = [
  ["mirror", "Show on"],
  ["move", "Move"],
  ["duplicate", "Duplicate"],
];

export function TaskNotesPicker({
  taskId,
  currentNoteId,
  onRemovedFromCurrentNote,
  align = "right",
}: {
  taskId: string;
  /** The note hosting the row this picker opened from, if any. */
  currentNoteId: string | null;
  /**
   * Fired after the task is detached (or moved away) from `currentNoteId` —
   * the caller should stop showing this row/chip.
   */
  onRemovedFromCurrentNote?: () => void;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<TaskNoteLink[] | null>(null);
  const [mode, setMode] = useState<Mode>("mirror");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TaskNoteLink[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Fetch once on mount so the trigger can show its badge unopened.
  useEffect(() => {
    listNotesForTaskAction(taskId)
      .then(setLinks)
      .catch((err) => console.error("[task-notes] list failed:", err));
  }, [taskId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Debounced search, recents-first when the query is empty.
  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => {
      searchNotesForTaskPickerAction(query)
        .then(setResults)
        .catch((err) => console.error("[task-notes] search failed:", err));
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [open, query]);

  const linkedIds = new Set((links ?? []).map((l) => l.id));
  const targets = results.filter((n) => !linkedIds.has(n.id));

  const unlink = async (noteId: string) => {
    setBusyId(noteId);
    try {
      await detachTaskFromNoteAction(taskId, noteId);
      setLinks((prev) => (prev ?? []).filter((l) => l.id !== noteId));
      if (noteId === currentNoteId) onRemovedFromCurrentNote?.();
    } catch (err) {
      console.error("[task-notes] unlink failed:", err);
    } finally {
      setBusyId(null);
    }
  };

  const chooseTarget = async (note: TaskNoteLink) => {
    setBusyId(note.id);
    try {
      if (mode === "mirror") {
        await attachTaskToNoteAction(taskId, note.id);
        setLinks((prev) => [...(prev ?? []), note]);
      } else if (mode === "move") {
        if (!currentNoteId) return;
        await moveTaskToNoteAction(taskId, currentNoteId, note.id);
        setLinks((prev) =>
          (prev ?? []).filter((l) => l.id !== currentNoteId).concat(note),
        );
        onRemovedFromCurrentNote?.();
      } else {
        await duplicateTaskToNoteAction(taskId, note.id);
      }
      setQuery("");
      setResults([]);
      setOpen(false);
    } catch (err) {
      console.error("[task-notes] action failed:", err);
    } finally {
      setBusyId(null);
    }
  };

  const count = links?.length ?? 0;
  const shared = count > 1;

  return (
    <span className="relative flex-none">
      <button
        type="button"
        aria-label="Notes this task is on"
        aria-expanded={open}
        title={shared ? `On ${count} notes` : "Notes"}
        onClick={() => {
          setOpen((o) => !o);
          setQuery("");
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className={`relative flex h-[1.375rem] w-[1.375rem] items-center justify-center rounded-md hover:bg-white/8 ${
          open || shared
            ? "bg-white/8 text-ink-200"
            : "text-ink-600 hover:text-ink-300"
        }`}
      >
        <Link2 className="h-3 w-3" />
        {shared && (
          <span className="absolute -right-1 -top-1 flex h-3 min-w-[0.75rem] items-center justify-center rounded-full bg-sage px-0.5 text-[0.5625rem] font-semibold leading-none text-sage-ink">
            {count}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close notes picker"
            onClick={() => setOpen(false)}
            onMouseDown={(e) => e.stopPropagation()}
            className="fixed inset-0 z-30 cursor-default"
          />
          <div
            onMouseDown={(e) => e.stopPropagation()}
            className={`absolute top-full z-40 mt-1.5 w-64 overflow-hidden rounded-xl border border-white/10 bg-panel p-1.5 shadow-2xl ${
              align === "right" ? "right-0" : "left-0"
            }`}
          >
            {links === null ? (
              <p className="px-2 py-2 text-[0.6875rem] text-ink-600">
                Loading…
              </p>
            ) : links.length === 0 ? (
              <p className="px-2 py-2 text-[0.6875rem] text-ink-600">
                Not on any note.
              </p>
            ) : (
              <div className="mb-1 max-h-32 overflow-y-auto border-b border-white/6 pb-1">
                {links.map((note) => (
                  <div
                    key={note.id}
                    className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[0.71875rem] hover:bg-white/6"
                  >
                    <Link
                      href={`/app/notes/${note.id}`}
                      className="min-w-0 flex-1 truncate text-ink-300 hover:text-ink-100 hover:underline"
                    >
                      {note.title || "Untitled"}
                      {note.id === currentNoteId && (
                        <span className="ml-1 text-ink-600">(here)</span>
                      )}
                    </Link>
                    <button
                      type="button"
                      aria-label={`Remove from ${note.title || "Untitled"}`}
                      title="Unlink from this note"
                      disabled={busyId === note.id}
                      onClick={() => void unlink(note.id)}
                      className="flex-none rounded p-0.5 text-ink-600 hover:text-ink-200 disabled:opacity-50"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="mb-1 flex gap-1 px-0.5">
              {MODES.map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  disabled={m === "move" && !currentNoteId}
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded-md px-1.5 py-1 text-[0.625rem] font-medium ${
                    mode === m
                      ? "bg-sage/15 text-sage"
                      : "text-ink-500 hover:bg-white/6 hover:text-ink-300"
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  {label}
                </button>
              ))}
            </div>

            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a note…"
              className="mb-1 w-full rounded-lg border border-white/8 bg-input px-2.5 py-1.5 text-[0.71875rem] text-ink-100 outline-none placeholder:text-ink-600"
            />

            <div className="max-h-40 overflow-y-auto">
              {targets.length === 0 && (
                <p className="px-2 py-2 text-[0.6875rem] text-ink-600">
                  {query ? "No match." : "No recent notes."}
                </p>
              )}
              {targets.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  disabled={busyId === note.id}
                  onClick={() => void chooseTarget(note)}
                  className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[0.71875rem] text-ink-300 hover:bg-white/6 disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {note.title || "Untitled"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </span>
  );
}
