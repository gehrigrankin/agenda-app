import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/AppShell";
import type { RecentNote } from "@/components/layout/NavRail";
import type { BoardEntry } from "@/components/layout/TopBar";
import { isGuestOwner } from "@/lib/guest";
import { listFolderBubbles } from "@/server/bubbles";
import { touchGuestSession } from "@/server/guest";
import { listNotesForSidebar } from "@/server/notes";

import { getGuestCookieOwnerId, getOwnerId } from "./owner";

/**
 * Protected app shell: top bar + floating nav rail around the content. Auth is
 * enforced in middleware.ts; we also read the owner here to scope the shell's
 * data (Boards dropdown + rail recents). A DB hiccup degrades to empty lists
 * rather than a crash.
 *
 * This is also the chokepoint that catches a guest who has just signed up: any
 * entry into the app that still carries a guest cookie while signed in detours
 * through /app/claim, so their work follows them in no matter which route they
 * landed on.
 */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const ownerId = await getOwnerId();

  if (ownerId && !isGuestOwner(ownerId) && (await getGuestCookieOwnerId())) {
    // A Route Handler, so no layout wraps it — this cannot loop.
    redirect("/app/claim");
  }

  let folders: BoardEntry[] = [];
  let recents: RecentNote[] = [];
  if (ownerId) {
    try {
      const [folderRows, noteRows] = await Promise.all([
        listFolderBubbles(ownerId),
        listNotesForSidebar(ownerId),
        // Registers the guest workspace and refreshes its retention clock.
        // Rides along with the shell's existing reads, so it adds no round
        // trip, and the statement itself no-ops until the guest's next day.
        // Failing it must not take the sidebar down with it, hence the local
        // catch rather than leaning on the try below.
        isGuestOwner(ownerId)
          ? touchGuestSession(ownerId).catch((err: unknown) => {
              console.error("[guest] failed to touch guest session:", err);
            })
          : null,
      ]);
      folders = folderRows;
      recents = noteRows.slice(0, 2).map((n) => ({ id: n.id, title: n.title }));
    } catch (err) {
      console.error("[app] failed to load shell data:", err);
    }
  }

  return (
    <AppShell
      folders={folders}
      recents={recents}
      isGuest={isGuestOwner(ownerId)}
    >
      {children}
    </AppShell>
  );
}
