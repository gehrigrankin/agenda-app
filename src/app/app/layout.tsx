import { auth } from "@clerk/nextjs/server";

import { AppShell } from "@/components/layout/AppShell";
import type { RecentNote } from "@/components/layout/NavRail";
import type { BoardEntry } from "@/components/layout/TopBar";
import { listFolderBubbles } from "@/server/bubbles";
import { listNotesForSidebar } from "@/server/notes";

/**
 * Protected app shell: top bar + floating nav rail around the content. Auth is
 * enforced in middleware.ts; we also read the user here to scope the shell's
 * data (Boards dropdown + rail recents). A DB hiccup degrades to empty lists
 * rather than a crash.
 */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { userId } = await auth();

  let folders: BoardEntry[] = [];
  let recents: RecentNote[] = [];
  if (userId) {
    try {
      const [folderRows, noteRows] = await Promise.all([
        listFolderBubbles(userId),
        listNotesForSidebar(userId),
      ]);
      folders = folderRows;
      recents = noteRows.slice(0, 2).map((n) => ({ id: n.id, title: n.title }));
    } catch (err) {
      console.error("[app] failed to load shell data:", err);
    }
  }

  return (
    <AppShell folders={folders} recents={recents}>
      {children}
    </AppShell>
  );
}
