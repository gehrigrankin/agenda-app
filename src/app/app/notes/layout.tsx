import { auth } from "@clerk/nextjs/server";

import {
  NotesShell,
  type ShellDaily,
  type ShellNote,
} from "@/components/notes/NotesShell";
import { buildFolderTree, type FolderNode } from "@/lib/folderTree";
import { listFolderTreeBubbles } from "@/server/bubbles";
import {
  countNotesByBubble,
  listBubbleNoteSummaries,
  listNotesWithPreview,
  listRecentDailyNotes,
} from "@/server/notes";

/**
 * Notes route shell (folder-system redesign, Turns 17d/19b/20): folders pane +
 * list pane + detail (`[id]` renders into children), collapsing to the
 * sectioned tree on phones. The pinned daily row is the MOST RECENT live
 * daily note — the server can't know the client's "today", so the client just
 * labels whatever this is.
 */
export default async function NotesLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { userId } = await auth();

  let daily: ShellDaily | null = null;
  let inboxNotes: ShellNote[] = [];
  let tree: FolderNode[] = [];
  let folderNotes: ShellNote[] = [];
  if (userId) {
    try {
      const [dailies, rows, folders, counts, bubbleNotes] = await Promise.all([
        listRecentDailyNotes(userId, 1),
        listNotesWithPreview(userId, 60),
        listFolderTreeBubbles(userId),
        countNotesByBubble(userId),
        listBubbleNoteSummaries(userId),
      ]);
      const latest = dailies[0];
      if (latest) {
        daily = {
          id: latest.id,
          title: latest.title,
          updatedAt: latest.updatedAt.toISOString(),
        };
      }
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
    // md:pl clears the floating nav rail.
    <div className="flex h-full min-h-0 md:pl-[5.75rem]">
      <NotesShell
        daily={daily}
        inboxNotes={inboxNotes}
        tree={tree}
        folderNotes={folderNotes}
      >
        {children}
      </NotesShell>
    </div>
  );
}
