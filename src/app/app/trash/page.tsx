import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { ChevronLeft, Trash2 } from "lucide-react";

import { TrashList, type TrashItem } from "@/components/notes/TrashList";
import { listTrashedNotes } from "@/server/notes";

/**
 * Trash (design Turn 17j): trashed notes (standalone, bubble, and daily) with
 * a "restores to …" sub-line and Restore per row, plus a single bulk "Empty
 * trash" action behind an inline confirm. "deleted X ago" is formatted here
 * on the server so the client list renders stable strings. There is no
 * auto-purge — trashed notes stick around until the owner restores or empties
 * them, hence the phone subtitle below.
 */
export default async function TrashPage() {
  const { userId } = await auth();
  let trashed: Awaited<ReturnType<typeof listTrashedNotes>> = [];
  if (userId) {
    try {
      trashed = await listTrashedNotes(userId);
    } catch (err) {
      console.error("[app] failed to load trash:", err);
    }
  }

  const items: TrashItem[] = trashed.map((note) => ({
    id: note.id,
    title: note.title,
    deletedAgo: note.deletedAt
      ? `deleted ${timeAgo(note.deletedAt)}`
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

/** Coarse relative time ("3 days ago") — no dependency needed. */
function timeAgo(date: Date): string {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - date.getTime()) / 1000),
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (days < 365) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}
