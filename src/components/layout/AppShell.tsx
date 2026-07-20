"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  NotebookText,
  Search,
  SquareCheck,
  Sun,
} from "lucide-react";

import { AutomationToasts } from "@/components/automations/AutomationToast";
import {
  NoteDockHost,
  NoteDockProvider,
} from "@/components/notes/NoteDockProvider";
import { CommandPalette } from "@/components/search/CommandPalette";
import { OPEN_SEARCH_EVENT } from "@/components/search/openSearch";
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
          <NavRail recents={recents} folders={folders} />
          <main className="flex h-full min-h-0 flex-col overflow-hidden pb-14 md:pb-0">
            {children}
          </main>
          <MobileNavBar />
          <NoteDockHost />
        </div>

        {/* Always mounted: owns the global ⌘K / Ctrl+K shortcut. */}
        <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
        {/* Quiet confirmations (with Undo) when an automation edits something. */}
        <AutomationToasts />
      </div>
    </NoteDockProvider>
  );
}

/**
 * Phone tab bar (design Turn 17): five labeled tabs — Today · Notes · Calendar ·
 * Tasks · Search. No capture FAB (the + lives in page headers), no Scratch
 * (the graph retires on phone), no Trash (it lives inside Notes now); Search
 * opens the full-screen palette instead of routing.
 */
function MobileNavBar() {
  const pathname = usePathname();

  const TAB =
    "flex min-h-11 flex-col items-center justify-center gap-1 pt-1 pb-0.5";

  const item = (href: string, icon: React.ReactNode, label: string) => {
    const active =
      href === "/app" ? pathname === "/app" : pathname.startsWith(href);
    return (
      <Link
        href={href}
        aria-label={label}
        className={`${TAB} ${active ? "text-sage" : "text-ink-500"}`}
      >
        {icon}
        <span
          className={`text-[0.65625rem] ${active ? "font-semibold" : "font-medium"}`}
        >
          {label}
        </span>
      </Link>
    );
  };

  return (
    <nav className="absolute inset-x-0 bottom-0 z-40 border-t border-white/8 bg-bar pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="grid h-14 grid-cols-5">
        {item("/app", <Sun className="h-[1.375rem] w-[1.375rem]" />, "Today")}
        {item(
          "/app/notes",
          <NotebookText className="h-[1.375rem] w-[1.375rem]" />,
          "Notes",
        )}
        {item(
          "/app/calendar",
          <CalendarDays className="h-[1.375rem] w-[1.375rem]" />,
          "Calendar",
        )}
        {item(
          "/app/tasks",
          <SquareCheck className="h-[1.375rem] w-[1.375rem]" />,
          "Tasks",
        )}
        <button
          type="button"
          aria-label="Search"
          onClick={() => window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT))}
          className={`${TAB} text-ink-500`}
        >
          <Search className="h-[1.375rem] w-[1.375rem]" />
          <span className="text-[0.65625rem] font-medium">Search</span>
        </button>
      </div>
    </nav>
  );
}
