import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/AppShell";
import { isGuestOwner } from "@/lib/guest";
import { touchGuestSession } from "@/server/guest";

import { getGuestCookieOwnerId, getOwnerId } from "./owner";

/**
 * Protected app shell: the docked main nav beside each page. Auth is enforced
 * in middleware.ts; we read the owner here for the guest checks below.
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

  if (ownerId && isGuestOwner(ownerId)) {
    // Registers the guest workspace and refreshes its retention clock. The
    // statement no-ops until the guest's next day; failing it must not take
    // the shell down.
    await touchGuestSession(ownerId).catch((err: unknown) => {
      console.error("[guest] failed to touch guest session:", err);
    });
  }

  return (
    <AppShell isGuest={isGuestOwner(ownerId)}>
      {children}
    </AppShell>
  );
}
