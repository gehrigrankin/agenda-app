import { auth } from "@clerk/nextjs/server";
import { Trash2 } from "lucide-react";

import { TrashList, type TrashItem } from "@/components/notes/TrashList";
import { listTrashedNotes } from "@/server/notes";

/**
 * Trash: trashed notes (standalone and bubble notes) with Restore / Delete
 * forever. "deleted X ago" is formatted here on the server so the client list
 * renders stable strings.
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
    isBubbleNote: note.bubbleId !== null,
  }));

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-2xl flex-col gap-4 overflow-y-auto p-6">
      <div className="flex items-center gap-2">
        <Trash2 className="h-5 w-5 text-neutral-400" />
        <h1 className="text-lg font-semibold">Trash</h1>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <Trash2 className="h-10 w-10 text-neutral-300" />
          <div>
            <p className="text-sm font-medium text-neutral-500">
              Trash is empty
            </p>
            <p className="mt-1 text-sm text-neutral-400">
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
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}
