import { auth } from "@clerk/nextjs/server";

import { AppShell } from "@/components/layout/AppShell";
import type { SidebarBubble } from "@/components/layout/BubbleTree";
import { listBubbles } from "@/server/bubbles";
import { listNotesForSidebar, type NoteSummary } from "@/server/notes";

/**
 * Protected app shell: persistent sidebar (drawer on mobile) + main content.
 * Auth is enforced in middleware.ts; we also read the user here to scope the
 * sidebar note list. A DB hiccup degrades to an empty list rather than a crash.
 */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { userId } = await auth();

  let notes: NoteSummary[] = [];
  let bubbles: SidebarBubble[] = [];
  if (userId) {
    try {
      notes = await listNotesForSidebar(userId);
      bubbles = (await listBubbles(userId)).map((b) => ({
        id: b.id,
        parentId: b.parentId,
        title: b.title,
        emoji: b.emoji,
      }));
    } catch (err) {
      console.error("[app] failed to load sidebar data:", err);
    }
  }

  return (
    <AppShell notes={notes} bubbles={bubbles}>
      {children}
    </AppShell>
  );
}
