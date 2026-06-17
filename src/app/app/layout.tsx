import { auth } from "@clerk/nextjs/server";

import { AppShell } from "@/components/layout/AppShell";
import { listNotesForSidebar } from "@/server/notes";

/**
 * Protected app shell: persistent sidebar (drawer on mobile) + main content.
 * Auth is enforced in middleware.ts; we also read the user here to scope the
 * sidebar note list.
 */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { userId } = await auth();
  const notes = userId ? await listNotesForSidebar(userId) : [];

  return <AppShell notes={notes}>{children}</AppShell>;
}
