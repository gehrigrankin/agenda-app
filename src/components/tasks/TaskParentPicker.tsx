"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CornerDownRight, X } from "lucide-react";

import { setTaskParentAction } from "@/app/app/actions";

/** Just enough of a task to offer it as a parent candidate in the dropdown. */
export type ParentCandidate = {
  id: string;
  title: string;
  parentId: string | null;
};

/**
 * Per-row parent picker for the Tasks page (ROADMAP: "Tasks with
 * parent/child + a dropdown"). Same shape as `TaskTagPicker`: it owns both
 * the optimistic write-through and the `setTaskParentAction` call (with
 * rollback on failure), so the page only has to supply a plain state setter.
 *
 * Candidates exclude the task itself and anything already descended from it
 * — picking one of those would either bounce off the server's cycle guard or
 * silently try to hang a subtree off itself. Computed client-side from
 * whatever tasks are already loaded, so opening the picker never round-trips.
 */
export function TaskParentPicker({
  taskId,
  parentId,
  parentTitle,
  candidates,
  onParentChange,
}: {
  taskId: string;
  parentId: string | null;
  /** Title of the current parent, for the trigger's tooltip (null = top-level). */
  parentTitle: string | null;
  candidates: ParentCandidate[];
  /** Optimistic write-through; called again with the old value on failure. */
  onParentChange: (taskId: string, parentId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Exclude self and every current descendant of self, transitively.
  const excluded = new Set<string>([taskId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of candidates) {
      if (c.parentId && excluded.has(c.parentId) && !excluded.has(c.id)) {
        excluded.add(c.id);
        grew = true;
      }
    }
  }

  const q = query.trim().toLowerCase();
  const matches = candidates.filter(
    (c) => !excluded.has(c.id) && (!q || c.title.toLowerCase().includes(q)),
  );

  const choose = (next: string | null) => {
    const previous = parentId;
    onParentChange(taskId, next);
    setOpen(false);
    setTaskParentAction(taskId, next).catch((err) => {
      console.error("[tasks] set parent failed:", err);
      onParentChange(taskId, previous);
    });
  };

  return (
    <span className="relative flex-none">
      <button
        type="button"
        aria-label={
          parentTitle ? `Change parent (currently “${parentTitle}”)` : "Set parent task"
        }
        aria-expanded={open}
        title={parentTitle ? `Sub-task of “${parentTitle}”` : "Set parent task"}
        onClick={() => {
          setOpen((o) => !o);
          setQuery("");
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className={`flex h-[1.375rem] w-[1.375rem] items-center justify-center rounded-md hover:bg-white/8 ${
          open
            ? "bg-white/8 text-ink-200"
            : parentId
              ? "text-ink-400"
              : "text-ink-600 hover:text-ink-300"
        }`}
      >
        <CornerDownRight className="h-3 w-3" />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close parent picker"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default"
          />
          <div className="absolute right-0 top-full z-40 mt-1.5 w-56 overflow-hidden rounded-xl border border-white/10 bg-panel p-1.5 shadow-2xl">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a task to nest under…"
              className="mb-1 w-full rounded-lg border border-white/8 bg-input px-2.5 py-1.5 text-[0.71875rem] text-ink-100 outline-none placeholder:text-ink-600"
            />
            <div className="max-h-52 overflow-y-auto">
              {parentId !== null && (
                <button
                  type="button"
                  onClick={() => choose(null)}
                  className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[0.71875rem] text-ink-400 hover:bg-white/6"
                >
                  <X className="h-3 w-3 flex-none" />
                  <span>No parent (top-level)</span>
                </button>
              )}
              {matches.length === 0 ? (
                <p className="px-2 py-2 text-[0.6875rem] text-ink-600">No match.</p>
              ) : (
                matches.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={c.id === parentId}
                    onClick={() => choose(c.id)}
                    className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[0.71875rem] hover:bg-white/6 ${
                      c.id === parentId ? "text-sage" : "text-ink-300"
                    }`}
                  >
                    <Check
                      className={`h-3 w-3 flex-none ${c.id === parentId ? "" : "opacity-0"}`}
                    />
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </span>
  );
}
