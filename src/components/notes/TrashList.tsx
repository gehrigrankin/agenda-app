"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CircleDashed, FileText, RotateCcw, Trash2 } from "lucide-react";

import { purgeNoteAction, restoreNoteAction } from "@/app/app/actions";

/**
 * Interactive list for the Trash page: each row offers Restore (immediate)
 * and Delete forever (behind a confirm dialog, since a purge is a hard
 * DELETE). Server actions revalidate /app/trash, so rows disappear on their
 * own once a transition settles.
 */

export type TrashItem = {
  id: string;
  title: string;
  /** Pre-formatted on the server ("deleted 3 days ago") to avoid hydration drift. */
  deletedAgo: string;
  /** True when the note lives inside a bubble (it restores back into it). */
  isBubbleNote: boolean;
};

export function TrashList({ items }: { items: TrashItem[] }) {
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<TrashItem | null>(null);

  const restore = (id: string) => {
    setPendingId(id);
    startTransition(async () => {
      await restoreNoteAction(id);
      setPendingId(null);
    });
  };

  const purge = (id: string) => {
    setConfirming(null);
    setPendingId(id);
    startTransition(async () => {
      await purgeNoteAction(id);
      setPendingId(null);
    });
  };

  return (
    <>
      <ul className="flex flex-col divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {items.map((item) => {
          const busy = isPending && pendingId === item.id;
          return (
            <li
              key={item.id}
              className={`flex items-center gap-3 px-3 py-2.5 ${
                busy ? "opacity-50" : ""
              }`}
            >
              {item.isBubbleNote ? (
                <CircleDashed className="h-4 w-4 shrink-0 text-neutral-400" />
              ) : (
                <FileText className="h-4 w-4 shrink-0 text-neutral-400" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-neutral-700 dark:text-neutral-300">
                  {item.title || "Untitled"}
                </p>
                <p className="text-xs text-neutral-400">
                  {item.deletedAgo}
                  {item.isBubbleNote && " · bubble note"}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => restore(item.id)}
                className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 disabled:pointer-events-none dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restore
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirming(item)}
                className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:pointer-events-none dark:text-red-400 dark:hover:bg-red-950/40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete forever
              </button>
            </li>
          );
        })}
      </ul>

      {confirming && (
        <ConfirmDialog
          title={`Delete “${confirming.title || "Untitled"}” forever?`}
          message="This permanently deletes the note. This can’t be undone."
          confirmLabel="Delete forever"
          onConfirm={() => purge(confirming.id)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </>
  );
}

/** Close overlays on Escape. */
function useEscapeKey(onEscape: () => void) {
  const handlerRef = useRef(onEscape);
  handlerRef.current = onEscape;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handlerRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEscapeKey(onCancel);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cancel"
        onClick={onCancel}
        className="absolute inset-0 bg-black/40"
      />
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-5 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="mt-2 text-sm text-neutral-500">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            <Trash2 className="h-4 w-4" />
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
