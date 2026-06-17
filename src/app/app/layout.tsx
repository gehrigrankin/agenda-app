import { auth } from "@clerk/nextjs/server";

import { AppShell } from "@/components/layout/AppShell";
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
  if (userId) {
    try {
      notes = await listNotesForSidebar(userId);
    } catch (err) {
      console.error("[app] failed to load notes for sidebar:", err);
    }
  }

  return <AppShell notes={notes}>{children}</AppShell>;
}
