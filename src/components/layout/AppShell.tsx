"use client";

import { useState } from "react";
import { Menu, NotebookPen } from "lucide-react";

import { Sidebar } from "./Sidebar";
import type { SidebarBubble } from "./BubbleTree";
import type { SidebarBubbleNote } from "./NotesFolders";
import { CommandPalette } from "@/components/search/CommandPalette";
import type { NoteSummary } from "@/server/notes";

/**
 * Responsive app shell. On md+ the sidebar is a persistent column. On small
 * screens it becomes an off-canvas drawer toggled by the header hamburger, with
 * a tap-to-dismiss overlay. Holds the open/close state (client component) so the
 * page content can stay server-rendered. Also hosts the ⌘K command palette so
 * its state is shared with the sidebar's Search button.
 */
export function AppShell({
  children,
  notes,
  bubbles,
  bubbleNotes,
}: {
  children: React.ReactNode;
  notes: NoteSummary[];
  bubbles: SidebarBubble[];
  bubbleNotes: SidebarBubbleNote[];
}) {
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

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

      <Sidebar
        open={open}
        onClose={() => setOpen(false)}
        onOpenSearch={() => {
          // Also dismiss the mobile drawer so the palette isn't behind it.
          setOpen(false);
          setSearchOpen(true);
        }}
        notes={notes}
        bubbles={bubbles}
        bubbleNotes={bubbleNotes}
      />

      {/* Always mounted: owns the global ⌘K / Ctrl+K shortcut. */}
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />

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
