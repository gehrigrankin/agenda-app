"use client";

import { useState } from "react";
import { Menu, NotebookPen } from "lucide-react";

import { Sidebar } from "./Sidebar";

/**
 * Responsive app shell. On md+ the sidebar is a persistent column. On small
 * screens it becomes an off-canvas drawer toggled by the header hamburger, with
 * a tap-to-dismiss overlay. Holds the open/close state (client component) so the
 * page content can stay server-rendered.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Off-canvas overlay (mobile only) */}
      {open ? (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
        />
      ) : null}

      <Sidebar open={open} onClose={() => setOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile top bar with the menu toggle */}
        <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2 md:hidden dark:border-neutral-800">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setOpen(true)}
            className="rounded p-1.5 text-neutral-600 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <Menu className="h-5 w-5" />
          </button>
          <NotebookPen className="h-5 w-5" />
          <span className="font-semibold">Agenda</span>
        </div>

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
