"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CircleDashed,
  FileText,
  House,
  Loader2,
  Plus,
  SquareCheck,
  Trash2,
} from "lucide-react";

import { createNoteAction } from "@/app/app/actions";
import {
  NoteDockHost,
  NoteDockProvider,
} from "@/components/notes/NoteDockProvider";
import { CommandPalette } from "@/components/search/CommandPalette";
import { NavRail, type RecentNote } from "./NavRail";
import { TopBar, type BoardEntry } from "./TopBar";

/**
 * Redesign shell: top bar + floating nav rail over the content canvas
 * (desktop), bottom icon bar (mobile). Hosts the always-mounted ⌘K palette so
 * the top bar's search pill and the global shortcut share one state, and the
 * note dock so open note windows survive navigation between /app pages.
 */
export function AppShell({
  children,
  folders,
  recents,
}: {
  children: React.ReactNode;
  folders: BoardEntry[];
  recents: RecentNote[];
}) {
  const [searchOpen, setSearchOpen] = useState(false);

  // dvh, not vh: iOS Safari's 100vh extends under its toolbars, which pushed
  // the bottom of the app (canvas controls included) off the visible screen.
  return (
    <NoteDockProvider>
      <div className="flex h-dvh flex-col overflow-hidden bg-canvas text-ink-100">
        <TopBar folders={folders} onOpenSearch={() => setSearchOpen(true)} />

        <div className="relative min-h-0 flex-1">
          <NavRail recents={recents} />
          <main className="flex h-full min-h-0 flex-col overflow-hidden pb-14 md:pb-0">
            {children}
          </main>
          <MobileNavBar />
          <NoteDockHost />
        </div>

        {/* Always mounted: owns the global ⌘K / Ctrl+K shortcut. */}
        <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
      </div>
    </NoteDockProvider>
  );
}

function MobileNavBar() {
  const pathname = usePathname();
  const [isCreating, startCreate] = useTransition();

  const item = (href: string, icon: React.ReactNode, label: string) => {
    const active =
      href === "/app" ? pathname === "/app" : pathname.startsWith(href);
    return (
      <Link
        href={href}
        aria-label={label}
        className={`flex h-10 w-10 items-center justify-center rounded-[0.625rem] ${
          active ? "bg-sage/16 text-sage" : "text-ink-400"
        }`}
      >
        {icon}
      </Link>
    );
  };

  return (
    <nav className="absolute inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-white/8 bg-bar pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="flex h-14 w-full items-center justify-around">
        {item("/app", <House className="h-5 w-5" />, "Home")}
        {item("/app/notes", <FileText className="h-5 w-5" />, "Notes")}
        <button
          type="button"
          aria-label="New note"
          disabled={isCreating}
          onClick={() => startCreate(() => createNoteAction())}
          className="flex h-10 w-10 items-center justify-center rounded-[0.625rem] bg-sage/16 text-sage disabled:opacity-60"
        >
          {isCreating ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Plus className="h-5 w-5" />
          )}
        </button>
        {item("/app/tasks", <SquareCheck className="h-5 w-5" />, "Tasks")}
        {item("/app/bubbles", <CircleDashed className="h-5 w-5" />, "Scratch")}
        {item("/app/trash", <Trash2 className="h-5 w-5" />, "Trash")}
      </div>
    </nav>
  );
}
