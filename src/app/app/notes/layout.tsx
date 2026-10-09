import { Suspense } from "react";

import { NotesShell, type ShellDailyNote } from "@/components/notes/NotesShell";
import { NotesShellSkeleton } from "@/components/notes/NotesShellSkeleton";
import type {
  ExplorerFolderInput,
  ExplorerNoteInput,
} from "@/lib/explorer-tree";
import { listExplorerFolders, listExplorerNotes } from "@/server/explorer";
import { listDailyNotes, listRecentlyOpenedNotes } from "@/server/notes";

import { getOwnerId } from "../owner";

/**
 * Notes route shell (Notes Sidebars design §2b/§3): the IDE-style Explorer —
 * every folder and note in one tree — beside a tabbed, splittable editor
 * (`[id]` renders into children). The Today card resolves "today" on the
 * client; the server just hands over the latest dailies.
 */
export default function NotesLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // The sync wrapper + Suspense means
    // first navigation paints a notes-shaped skeleton immediately instead of
    // blocking on the six shell queries (a layout's own await isn't covered
    // by loading.tsx — it would flash the parent /app home skeleton).
    <div className="flex h-full min-h-0">
      <Suspense fallback={<NotesShellSkeleton />}>
        <NotesShellLoader>{children}</NotesShellLoader>
      </Suspense>
    </div>
  );
}

async function NotesShellLoader({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const ownerId = await getOwnerId();

  let folders: ExplorerFolderInput[] = [];
  let notes: ExplorerNoteInput[] = [];
  let dailyNotes: ShellDailyNote[] = [];
  let recentNotes: { id: string; title: string; openedAt: string }[] = [];
  if (ownerId) {
    try {
      const [folderRows, noteRows, dailies, recents] = await Promise.all([
        listExplorerFolders(ownerId),
        listExplorerNotes(ownerId),
        listDailyNotes(ownerId, 60),
        listRecentlyOpenedNotes(ownerId, 12),
      ]);
      folders = folderRows;
      notes = noteRows;
      dailyNotes = dailies
        .filter(
          (d): d is typeof d & { dailyDate: Date } => d.dailyDate !== null,
        )
        .map((d) => ({
          id: d.id,
          title: d.title,
          dailyDate: d.dailyDate.toISOString().slice(0, 10),
          updatedAt: d.updatedAt.toISOString(),
        }));
      recentNotes = recents.map((n) => ({
        id: n.id,
        title: n.title,
        openedAt: new Date(n.openedAt).toISOString(),
      }));
    } catch (err) {
      console.error("[notes] failed to load explorer:", err);
    }
  }

  return (
    <NotesShell
      folders={folders}
      notes={notes}
      dailyNotes={dailyNotes}
      recentNotes={recentNotes}
    >
      {children}
    </NotesShell>
  );
}
