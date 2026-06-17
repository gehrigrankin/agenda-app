import { AppShell } from "@/components/layout/AppShell";

/**
 * Protected app shell: persistent sidebar (drawer on mobile) + main content.
 * Auth is enforced in middleware.ts (every /app route requires a session).
 */
export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}
