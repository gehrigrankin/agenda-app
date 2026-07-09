"use client";

import { useState, useTransition } from "react";
import { FileText, Trash2 } from "lucide-react";

import { emptyTrashAction, restoreNoteAction } from "@/app/app/actions";

/**
 * Interactive list for the Trash page (design Turn 17j): each row offers
 * Restore (immediate), and a single bulk "Empty trash" action below the card
 * handles permanent deletion behind an inline confirm swap (no
 * window.confirm). Server actions revalidate /app/trash, so rows disappear
 * on their own once a transition settles.
 */

export type TrashItem = {
  id: string;
  title: string;
  /** Pre-formatted on the server ("deleted 3 days ago") to avoid hydration drift. */
  deletedAgo: string;
  /** Human label for where Restore lands the note: a bubble title, "Daily
   * notes", or "Notes" for a standalone note. */
  restoreTarget: string;
};

export function TrashList({ items }: { items: TrashItem[] }) {
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isEmptying, startEmptyTransition] = useTransition();
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  const restore = (id: string) => {
    setPendingId(id);
    startTransition(async () => {
      await restoreNoteAction(id);
      setPendingId(null);
    });
  };

  const emptyTrash = () => {
    setConfirmEmpty(false);
    startEmptyTransition(async () => {
      await emptyTrashAction();
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-2xl border border-white/7 bg-white/2">
        {items.map((item) => {
          const busy = isPending && pendingId === item.id;
          return (
            <div
              key={item.id}
              className={`flex min-h-[3.75rem] items-center gap-3 border-b border-white/6 px-3.5 last:border-b-0 ${
                busy ? "opacity-50" : ""
              }`}
            >
              <FileText className="h-[1.0625rem] w-[1.0625rem] flex-none text-ink-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.90625rem] font-medium text-ink-200">
                  {item.title || "Untitled"}
                </p>
                <p className="truncate text-[0.71875rem] text-ink-600">
                  {item.deletedAgo} · restores to {item.restoreTarget}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => restore(item.id)}
                className="h-9 flex-none rounded-[0.625rem] border border-white/10 bg-white/5 px-3.5 text-xs font-semibold text-ink-300 disabled:pointer-events-none disabled:opacity-50"
              >
                Restore
              </button>
            </div>
          );
        })}
      </div>

      {confirmEmpty ? (
        <div className="flex h-12 items-center justify-between gap-2 rounded-[0.875rem] border border-[#D9938A]/30 bg-[#D9938A]/6 px-3.5">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#D9938A]">
            Really delete {items.length} note{items.length === 1 ? "" : "s"}{" "}
            forever?
          </span>
          <div className="flex flex-none items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmEmpty(false)}
              className="h-8 rounded-lg px-2.5 text-xs font-semibold text-ink-300"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isEmptying}
              onClick={emptyTrash}
              className="h-8 rounded-lg bg-[#D9938A]/15 px-2.5 text-xs font-semibold text-[#D9938A] disabled:pointer-events-none disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={isEmptying}
          onClick={() => setConfirmEmpty(true)}
          className="flex h-12 items-center justify-center gap-2 rounded-[0.875rem] border border-[#D9938A]/30 bg-[#D9938A]/6 text-sm font-semibold text-[#D9938A] disabled:pointer-events-none disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
          Empty trash
        </button>
      )}
    </div>
  );
}
