"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";

import { useDebouncedCallback } from "@/lib/hooks/use-debounced-callback";
import {
  createBubbleAction,
  deleteBubbleAction,
  renameBubbleAction,
  updateBubbleNotesAction,
} from "@/app/app/bubbles/actions";

export interface BubbleData {
  id: string;
  parentId: string | null;
  title: string;
  notes: string;
}

// Muted palette cycled by position — gives circles variety without noise.
const PALETTE = [
  "bg-sky-100 border-sky-300 text-sky-900 hover:bg-sky-200 dark:bg-sky-950 dark:border-sky-800 dark:text-sky-100 dark:hover:bg-sky-900",
  "bg-violet-100 border-violet-300 text-violet-900 hover:bg-violet-200 dark:bg-violet-950 dark:border-violet-800 dark:text-violet-100 dark:hover:bg-violet-900",
  "bg-emerald-100 border-emerald-300 text-emerald-900 hover:bg-emerald-200 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-100 dark:hover:bg-emerald-900",
  "bg-amber-100 border-amber-300 text-amber-900 hover:bg-amber-200 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-100 dark:hover:bg-amber-900",
  "bg-rose-100 border-rose-300 text-rose-900 hover:bg-rose-200 dark:bg-rose-950 dark:border-rose-800 dark:text-rose-100 dark:hover:bg-rose-900",
  "bg-teal-100 border-teal-300 text-teal-900 hover:bg-teal-200 dark:bg-teal-950 dark:border-teal-800 dark:text-teal-100 dark:hover:bg-teal-900",
];

export function BubbleView({
  rootId,
  nodes,
}: {
  rootId: string;
  nodes: BubbleData[];
}) {
  const [currentId, setCurrentId] = useState(rootId);
  const [, startTransition] = useTransition();

  const { byId, childrenOf } = useMemo(() => {
    const byId = new Map<string, BubbleData>();
    const childrenOf = new Map<string, BubbleData[]>();
    for (const n of nodes) byId.set(n.id, n);
    for (const n of nodes) {
      if (n.parentId) {
        const arr = childrenOf.get(n.parentId) ?? [];
        arr.push(n);
        childrenOf.set(n.parentId, arr);
      }
    }
    return { byId, childrenOf };
  }, [nodes]);

  // Fall back to root if the current bubble vanished (e.g. after a delete).
  const current = byId.get(currentId) ?? byId.get(rootId);
  const effectiveId = current?.id ?? rootId;

  const breadcrumb = useMemo(() => {
    const path: BubbleData[] = [];
    let node = current;
    const seen = new Set<string>();
    while (node && !seen.has(node.id)) {
      seen.add(node.id);
      path.unshift(node);
      node = node.parentId ? byId.get(node.parentId) : undefined;
    }
    return path;
  }, [current, byId]);

  const children = childrenOf.get(effectiveId) ?? [];

  // Notes draft, reset when navigating to another bubble.
  const [notesDraft, setNotesDraft] = useState(current?.notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);
  useEffect(() => {
    setNotesDraft(current?.notes ?? "");
  }, [effectiveId]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveNotes = useDebouncedCallback((value: string) => {
    void updateBubbleNotesAction(effectiveId, value).finally(() =>
      setSavingNotes(false),
    );
  }, 600);

  if (!current) return null;

  const onNotesChange = (value: string) => {
    setNotesDraft(value);
    setSavingNotes(true);
    saveNotes(value);
  };

  const addChild = () => {
    const title = window.prompt("New bubble title");
    if (title === null) return;
    startTransition(() => {
      void createBubbleAction(effectiveId, title || "Untitled");
    });
  };

  const renameCurrent = () => {
    const title = window.prompt("Rename bubble", current.title);
    if (title === null) return;
    startTransition(() => {
      void renameBubbleAction(effectiveId, title || "Untitled");
    });
  };

  const deleteCurrent = () => {
    if (!current.parentId) return; // never delete the root
    const childCount = children.length;
    const ok = window.confirm(
      childCount > 0
        ? `Delete “${current.title}” and its ${childCount} child bubble${
            childCount === 1 ? "" : "s"
          } (and everything under them)? This can’t be undone.`
        : `Delete “${current.title}”? This can’t be undone.`,
    );
    if (!ok) return;
    const parentId = current.parentId;
    setCurrentId(parentId);
    startTransition(() => {
      void deleteBubbleAction(current.id);
    });
  };

  const isRoot = !current.parentId;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-neutral-200 px-4 py-2.5 text-sm dark:border-neutral-800">
        {breadcrumb.map((b, i) => (
          <span key={b.id} className="flex items-center gap-1">
            {i > 0 && (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
            )}
            <button
              type="button"
              onClick={() => setCurrentId(b.id)}
              className={`rounded px-1.5 py-0.5 ${
                b.id === effectiveId
                  ? "font-semibold text-neutral-900 dark:text-neutral-100"
                  : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800"
              }`}
            >
              {b.title || "Untitled"}
            </button>
          </span>
        ))}
      </nav>

      {/* Current bubble */}
      <div
        key={effectiveId}
        className="bubble-pop mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-5 overflow-y-auto px-4 py-6"
      >
        <div className="flex items-start gap-2">
          <h1 className="flex-1 text-2xl font-semibold tracking-tight">
            {current.title || "Untitled"}
          </h1>
          <button
            type="button"
            onClick={renameCurrent}
            aria-label="Rename bubble"
            title="Rename"
            className="rounded p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <Pencil className="h-4 w-4" />
          </button>
          {!isRoot && (
            <button
              type="button"
              onClick={deleteCurrent}
              aria-label="Delete bubble"
              title="Delete bubble (and its subtree)"
              className="rounded p-2 text-neutral-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>

        <textarea
          value={notesDraft}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Notes for this bubble…"
          className="min-h-28 w-full resize-y rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm leading-6 outline-none focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900"
        />
        <div className="-mt-3 h-4 text-xs text-neutral-400">
          {savingNotes ? "Saving…" : ""}
        </div>

        {/* Children */}
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-400">
            {children.length > 0
              ? `${children.length} bubble${children.length === 1 ? "" : "s"}`
              : "Bubbles"}
          </h2>
        </div>

        <div className="flex flex-wrap gap-4 pb-6">
          {children.map((child, i) => {
            const grandkids = childrenOf.get(child.id)?.length ?? 0;
            return (
              <button
                key={child.id}
                type="button"
                onClick={() => setCurrentId(child.id)}
                className={`group flex aspect-square w-28 flex-col items-center justify-center gap-1 rounded-full border p-3 text-center transition-transform duration-150 hover:scale-105 active:scale-95 sm:w-32 ${
                  PALETTE[i % PALETTE.length]
                }`}
              >
                <span className="line-clamp-3 text-sm font-medium leading-tight">
                  {child.title || "Untitled"}
                </span>
                {grandkids > 0 && (
                  <span className="text-[11px] opacity-70">{grandkids} ↓</span>
                )}
              </button>
            );
          })}

          {/* Add bubble */}
          <button
            type="button"
            onClick={addChild}
            className="flex aspect-square w-28 flex-col items-center justify-center gap-1 rounded-full border-2 border-dashed border-neutral-300 text-neutral-400 transition-colors hover:border-neutral-400 hover:text-neutral-600 active:scale-95 sm:w-32 dark:border-neutral-700 dark:hover:border-neutral-500"
          >
            <Plus className="h-6 w-6" />
            <span className="text-xs">Add bubble</span>
          </button>
        </div>

        {children.length === 0 && (
          <p className="text-sm text-neutral-400">
            This bubble has no children yet. Add one to branch out.
          </p>
        )}
      </div>
    </div>
  );
}
