"use client";

import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import {
  CalendarDays,
  CircleDashed,
  NotebookPen,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { BubbleTree, type SidebarBubble } from "@/components/layout/BubbleTree";
import {
  NotesFolders,
  type SidebarBubbleNote,
} from "@/components/layout/NotesFolders";
import { NewNoteButton } from "@/components/notes/NewNoteButton";
import { NoteList } from "@/components/notes/NoteList";
import type { NoteSummary } from "@/server/notes";

/**
 * App sidebar scaffold. The folder/tag tree, pinned folders, and note list are
 * MVP features that render here — they're stubbed for now so the shell and
 * navigation exist. Data wiring lands with Note CRUD + the tag tree.
 *
 * Responsive: a persistent column on md+, an off-canvas drawer on mobile
 * (visibility driven by `open`, dismissed via `onClose`).
 */
export function Sidebar({
  open = false,
  onClose,
  notes = [],
  bubbles = [],
  bubbleNotes = [],
}: {
  open?: boolean;
  onClose?: () => void;
  notes?: NoteSummary[];
  bubbles?: SidebarBubble[];
  bubbleNotes?: SidebarBubbleNote[];
}) {
  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex h-full w-64 shrink-0 transform flex-col border-r border-neutral-200 bg-neutral-50 transition-transform duration-200 ease-in-out md:static md:translate-x-0 dark:border-neutral-800 dark:bg-neutral-900 ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      <div className="flex items-center gap-2 px-4 py-3">
        <NotebookPen className="h-5 w-5" />
        <span className="font-semibold">Agenda</span>
        <button
          type="button"
          aria-label="Close menu"
          onClick={onClose}
          className="ml-auto rounded p-1 text-neutral-500 hover:bg-neutral-200/60 md:hidden dark:hover:bg-neutral-800"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex flex-col gap-0.5 px-2 text-sm">
        <SidebarLink href="/app" icon={<CalendarDays className="h-4 w-4" />} onClick={onClose}>
          Today
        </SidebarLink>
        <SidebarLink
          href="/app/bubbles"
          icon={<CircleDashed className="h-4 w-4" />}
          onClick={onClose}
        >
          Bubble map
        </SidebarLink>
      </nav>

      {/* Bubble tree (folder-like) under the Bubble map link */}
      <div className="mb-1 max-h-48 overflow-y-auto px-2 md:max-h-64">
        <BubbleTree bubbles={bubbles} onNavigate={onClose} />
      </div>

      <nav className="flex flex-col gap-0.5 px-2 text-sm">
        <SidebarLink href="/app" icon={<Search className="h-4 w-4" />} onClick={onClose}>
          Search
          <kbd className="ml-auto rounded border border-neutral-300 px-1 text-[10px] text-neutral-500 dark:border-neutral-700">
            ⌘K
          </kbd>
        </SidebarLink>
        <SidebarLink href="/app" icon={<Trash2 className="h-4 w-4" />} onClick={onClose}>
          Trash
        </SidebarLink>
      </nav>

      <div className="mt-3 flex items-center justify-between px-2">
        <span className="px-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
          Notes
        </span>
      </div>
      <div className="px-2">
        <NewNoteButton onCreated={onClose} />
      </div>
      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-1 text-sm">
        {bubbles.some((b) => b.isFolder) && (
          <div className="mb-1">
            <NotesFolders
              bubbles={bubbles}
              notes={bubbleNotes}
              onNavigate={onClose}
            />
          </div>
        )}
        <NoteList notes={notes} onNavigate={onClose} />
      </div>

      <div className="flex items-center gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <UserButton afterSignOutUrl="/" />
        <span className="text-xs text-neutral-500">Account</span>
      </div>
    </aside>
  );
}

function SidebarLink({
  href,
  icon,
  onClick,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-2 rounded px-2 py-1.5 text-neutral-700 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      {icon}
      {children}
    </Link>
  );
}
