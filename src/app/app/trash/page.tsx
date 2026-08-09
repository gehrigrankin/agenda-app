import Link from "next/link";
import { ChevronLeft, Trash2 } from "lucide-react";

import { TrashList, type TrashItem } from "@/components/notes/TrashList";
import { relativeTime } from "@/lib/relative-time";
import { listTrashedNotes } from "@/server/notes";

import { getOwnerId } from "../owner";

/**
 * Trash (design Turn 17j): trashed notes (standalone, bubble, and daily) with
 * a "restores to …" sub-line and Restore per row, plus a single bulk "Empty
 * trash" action behind an inline confirm. "deleted X ago" is formatted here
 * on the server so the client list renders stable strings. There is no
 * auto-purge — trashed notes stick around until the owner restores or empties
 * them, hence the phone subtitle below.
 */
export default async function TrashPage() {
  const ownerId = await getOwnerId();
  let trashed: Awaited<ReturnType<typeof listTrashedNotes>> = [];
  if (ownerId) {
    try {
      trashed = await listTrashedNotes(ownerId);
    } catch (err) {
      console.error("[app] failed to load trash:", err);
    }
  }

  const items: TrashItem[] = trashed.map((note) => ({
    id: note.id,
    title: note.title,
    deletedAgo: note.deletedAt
      ? `deleted ${relativeTime(note.deletedAt, "long")}`
      : "deleted",
    restoreTarget: note.restoreTarget,
  }));

  return (
    // md:pl clears the floating nav rail; the extra max-width keeps the
    // column visually centered in the remaining space.
    <div className="mx-auto flex h-full min-h-0 w-full max-w-2xl flex-col gap-4 overflow-y-auto p-4 pb-8 md:max-w-[calc(42rem+5.75rem)] md:p-6 md:pl-[5.75rem]">
      {/* Phone back bar — Trash lives inside Notes/Settings on phone. */}
      <div className="flex flex-none flex-col gap-1 md:hidden">
        <div className="relative flex h-11 items-center">
          <Link
            href="/app/notes"
            className="flex h-11 items-center gap-0.5 px-2 text-[0.9375rem] font-medium text-sage"
          >
            <ChevronLeft className="h-5 w-5" />
            Notes
          </Link>
          <span className="absolute left-1/2 -translate-x-1/2 text-[1rem] font-semibold text-ink-100">
            Trash
          </span>
        </div>
        <p className="text-center text-[0.65625rem] text-ink-600">
          deleted notes stay here until you empty them
        </p>
      </div>

      <h1 className="hidden items-center gap-2 text-2xl font-semibold text-ink-100 md:flex">
        <Trash2 className="h-5 w-5 text-ink-400" />
        Trash
      </h1>

      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <Trash2 className="h-10 w-10 text-ink-600" />
          <div>
            <p className="text-sm font-medium text-ink-300">Trash is empty</p>
            <p className="mt-1 text-sm text-ink-600">
              Notes you delete land here before they’re gone for good.
            </p>
          </div>
        </div>
      ) : (
        <TrashList items={items} />
      )}
    </div>
  );
}
