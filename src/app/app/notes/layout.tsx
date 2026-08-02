import { Suspense } from "react";

import { auth } from "@clerk/nextjs/server";

import {
  NotesShell,
  type ShellDaily,
  type ShellDailyNote,
  type ShellNote,
} from "@/components/notes/NotesShell";
import { NotesShellSkeleton } from "@/components/notes/NotesShellSkeleton";
import { buildFolderTree, type FolderNode } from "@/lib/folderTree";
import { listFolderTreeBubbles } from "@/server/bubbles";
import {
  countNotesByBubble,
  listBubbleNoteSummaries,
  listDailyNotes,
  listNotesWithPreview,
  listRecentlyOpenedNotes,
} from "@/server/notes";

/**
 * Notes route shell (folder-system redesign, Turns 17d/19b/20): folders pane +
 * list pane + detail (`[id]` renders into children), collapsing to the
 * sectioned tree on phones. The pinned daily row is the MOST RECENT live
 * daily note — the server can't know the client's "today", so the client just
 * labels whatever this is.
 */
export default function NotesLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // md:pl clears the floating nav rail. The sync wrapper + Suspense means
    // first navigation paints a notes-shaped skeleton immediately instead of
    // blocking on the six shell queries (a layout's own await isn't covered
    // by loading.tsx — it would flash the parent /app home skeleton).
    <div className="flex h-full min-h-0 md:pl-[5.75rem]">
      <Suspense fallback={<NotesShellSkeleton />}>
        <NotesShellLoader>{children}</NotesShellLoader>
      </Suspense>
    </div>
  );
}

async function NotesShellLoader({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { userId } = await auth();

  let daily: ShellDaily | null = null;
  let dailyNotes: ShellDailyNote[] = [];
  let inboxNotes: ShellNote[] = [];
  let tree: FolderNode[] = [];
  let folderNotes: ShellNote[] = [];
  let recentNotes: { id: string; title: string; openedAt: string }[] = [];
  if (userId) {
    try {
      // One dailies read serves both the pinned latest-daily row (first row)
      // and the month-grouped "Daily notes" section (the whole list).
      const [dailies, rows, folders, counts, bubbleNotes, recents] =
        await Promise.all([
          listDailyNotes(userId, 60),
          listNotesWithPreview(userId, 60),
          listFolderTreeBubbles(userId),
          countNotesByBubble(userId),
          listBubbleNoteSummaries(userId),
          listRecentlyOpenedNotes(userId, 8),
        ]);
      recentNotes = recents.map((n) => ({
        id: n.id,
        title: n.title,
        openedAt: new Date(n.openedAt).toISOString(),
      }));
      const latest = dailies[0];
      if (latest) {
        daily = {
          id: latest.id,
          title: latest.title,
          updatedAt: latest.updatedAt.toISOString(),
        };
      }
      dailyNotes = dailies
        .filter((d): d is typeof d & { dailyDate: Date } => d.dailyDate !== null)
        .map((d) => ({
          id: d.id,
          title: d.title,
          dailyDate: d.dailyDate.toISOString().slice(0, 10),
          updatedAt: d.updatedAt.toISOString(),
        }));
      inboxNotes = rows.map((n) => ({
        id: n.id,
        title: n.title,
        preview: n.preview,
        updatedAt: n.updatedAt.toISOString(),
        bubbleId: null,
      }));

      const folderIds = new Set(folders.map((f) => f.id));
      tree = buildFolderTree(
        folders,
        new Map(
          counts
            .filter((c) => c.bubbleId !== null)
            .map((c) => [c.bubbleId as string, c.count]),
        ),
      );
      // Only notes living in folder bubbles belong in the tree/list — notes
      // in plain canvas bubbles stay a bubbles-page concern.
      folderNotes = bubbleNotes
        .filter((n) => n.bubbleId && folderIds.has(n.bubbleId))
        .map((n) => ({
          id: n.id,
          title: n.title,
          preview: n.preview,
          updatedAt: n.updatedAt.toISOString(),
          bubbleId: n.bubbleId,
        }));
    } catch (err) {
      console.error("[notes] failed to load list:", err);
    }
  }

  return (
    <NotesShell
      daily={daily}
      dailyNotes={dailyNotes}
      inboxNotes={inboxNotes}
      tree={tree}
      folderNotes={folderNotes}
      recentNotes={recentNotes}
    >
      {children}
    </NotesShell>
  );
}
