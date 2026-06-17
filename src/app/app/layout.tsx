import { Sidebar } from "@/components/layout/Sidebar";

/**
 * Protected app shell: persistent sidebar + main content pane.
 * Auth is enforced in middleware.ts (every /app route requires a session).
 */
export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
