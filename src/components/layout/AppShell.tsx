"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  CircleDashed,
  Flame,
  GitCommitVertical,
  Inbox,
  LayoutGrid,
  MoreHorizontal,
  NotebookText,
  Plus,
  Search,
  Sprout,
  SquareCheck,
  Sun,
  Trash2,
  UserRound,
  Users,
  Wand2,
} from "lucide-react";

import { AutomationToasts } from "@/components/automations/AutomationToast";
import { CreateMenu } from "@/components/layout/CreateMenu";
import { ReminderSnoozePrompt } from "@/components/layout/ReminderSnoozePrompt";
import {
  NoteDockHost,
  NoteDockProvider,
} from "@/components/notes/NoteDockProvider";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";
import { CommandPalette } from "@/components/search/CommandPalette";
import { OPEN_SEARCH_EVENT } from "@/components/search/openSearch";
import { NavRail, type RecentNote } from "./NavRail";
import { TopBar, type BoardEntry } from "./TopBar";
import { useMobileWritingMode } from "./useMobileWritingMode";

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
  isGuest,
}: {
  children: React.ReactNode;
  folders: BoardEntry[];
  recents: RecentNote[];
  /** Resolved on the server: Clerk's <SignedOut> renders nothing until its JS
   *  loads, which would flash the guest's only route to an account. */
  isGuest: boolean;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const pathname = usePathname();
  const isToday = pathname === "/app";
  const mobileWriting = useMobileWritingMode(isToday);

  // dvh, not vh: iOS Safari's 100vh extends under its toolbars, which pushed
  // the bottom of the app (canvas controls included) off the visible screen.
  return (
    <NoteDockProvider>
      <div className="flex h-dvh flex-col overflow-hidden bg-canvas text-ink-100">
        <TopBar
          folders={folders}
          isGuest={isGuest}
          onOpenSearch={() => setSearchOpen(true)}
        />

        <div
          className={`relative min-h-0 flex-1 md:pt-0 ${
            isToday
              ? "bg-bar pt-8 md:bg-transparent md:pt-0"
              : "pt-[env(safe-area-inset-top)]"
          }`}
        >
          <NavRail recents={recents} folders={folders} />
          <main
            className={`flex h-full min-h-0 flex-col overflow-hidden transition-[padding] duration-200 md:pb-0 ${
              mobileWriting
                ? "pb-0"
                : "pb-13"
            }`}
            style={
              isToday
                ? { touchAction: "pan-y", overscrollBehaviorX: "none" }
                : undefined
            }
          >
            {children}
          </main>
          <MobileNavBar hidden={mobileWriting} hideFab={isToday} />
          <NoteDockHost />
        </div>

        {/* Always mounted: owns the global ⌘K / Ctrl+K shortcut. */}
        <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
        {/* Quiet confirmations (with Undo) when an automation edits something. */}
        <AutomationToasts />
        <Suspense fallback={null}>
          <ReminderSnoozePrompt />
        </Suspense>
        {/* PWA: registers public/sw.js (installability + push); renders nothing. */}
        <ServiceWorkerRegistration />
      </div>
    </NoteDockProvider>
  );
}

/** Everything the desktop rail reaches that the phone tabs don't. */
const MORE_DESTINATIONS: {
  href: string;
  label: string;
  icon: React.ReactNode;
}[] = [
  {
    href: "/app/threads",
    label: "Threads",
    icon: <GitCommitVertical className="h-5 w-5" />,
  },
  { href: "/app/people", label: "People", icon: <Users className="h-5 w-5" /> },
  { href: "/app/inbox", label: "Inbox", icon: <Inbox className="h-5 w-5" /> },
  {
    href: "/app/boards",
    label: "Folders",
    icon: <LayoutGrid className="h-5 w-5" />,
  },
  {
    href: "/app/bubbles",
    label: "Canvas",
    icon: <CircleDashed className="h-5 w-5" />,
  },
  { href: "/app/habits", label: "Habits", icon: <Flame className="h-5 w-5" /> },
  {
    href: "/app/automations",
    label: "Rules",
    icon: <Wand2 className="h-5 w-5" />,
  },
  {
    href: "/app/gardener",
    label: "Garden",
    icon: <Sprout className="h-5 w-5" />,
  },
  { href: "/app/trash", label: "Trash", icon: <Trash2 className="h-5 w-5" /> },
  {
    href: "/app/settings",
    label: "Profile",
    icon: <UserRound className="h-5 w-5" />,
  },
];

/**
 * Phone tab bar (design Turn 17, + More): six labeled tabs — Today · Notes ·
 * Calendar · Tasks · Search · More. Search opens the full-screen palette
 * instead of routing; More opens a bottom sheet with every destination the
 * desktop rail has that the tabs don't (Threads, People, Inbox, Boards,
 * Scratch, Habits, Rules, Garden, Trash).
 */
function MobileNavBar({
  hidden,
  hideFab,
}: {
  hidden: boolean;
  hideFab: boolean;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  // Route change (tap inside the sheet included) closes the sheet.
  useEffect(() => setMoreOpen(false), [pathname]);

  useEffect(() => {
    if (hidden) setMoreOpen(false);
  }, [hidden]);

  const TAB =
    "flex min-h-11 flex-col items-center justify-center gap-0.5 px-2 py-1.5";

  const isActive = (href: string) =>
    href === "/app" ? pathname === "/app" : pathname.startsWith(href);
  const moreActive = MORE_DESTINATIONS.some((d) => isActive(d.href));

  const item = (href: string, icon: React.ReactNode, label: string) => (
    <Link
      href={href}
      aria-label={label}
      className={`${TAB} ${isActive(href) ? "text-sage" : "text-ink-500"}`}
    >
      {icon}
      <span
        className={`text-[0.6875rem] ${isActive(href) ? "font-semibold" : "font-medium"}`}
      >
        {label}
      </span>
    </Link>
  );

  return (
    <>
      {moreOpen && (
        <div className="absolute inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 cursor-default bg-black/40"
          />
          {/* bottom offset = tab bar height + the home-indicator safe area the
              tab bar itself pads with, so the last row never hides behind it;
              max-h + scroll keeps every tile reachable on short screens. */}
          <div className="absolute inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] max-h-[70dvh] overflow-y-auto rounded-t-2xl border-t border-white/10 bg-bar px-3 pb-3 pt-4 shadow-[0_-16px_40px_rgba(0,0,0,0.5)]">
            <div className="grid grid-cols-3 gap-1.5">
              {MORE_DESTINATIONS.map((d) => (
                <Link
                  key={d.href}
                  href={d.href}
                  onClick={() => setMoreOpen(false)}
                  className={`flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 ${
                    isActive(d.href)
                      ? "border-sage/30 bg-sage/10 text-sage"
                      : "border-white/7 bg-white/[0.03] text-ink-300"
                  }`}
                >
                  {d.icon}
                  <span className="text-[0.6875rem] font-medium">
                    {d.label}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
      {/* Create lives on a FAB rather than a seventh tab: the bar is a fixed
          six-column grid, and squeezing another column in shrinks every label
          below legibility. Sits clear of the tab bar and its safe area. */}
      {!moreOpen && !hideFab && (
        <div
          aria-hidden={hidden}
          className={`absolute right-4 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-40 transition-[opacity,transform] duration-200 md:hidden ${
            hidden
              ? "pointer-events-none translate-y-3 opacity-0"
              : "translate-y-0 opacity-100"
          }`}
        >
          <CreateMenu
            items={["note", "task", "event", "board"]}
            placement="above-right"
            trigger={({ open, busy, toggle }) => (
              <button
                type="button"
                aria-label="Create"
                aria-expanded={open}
                disabled={busy}
                onClick={toggle}
                className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-sage text-bar shadow-[0_6px_20px_rgba(0,0,0,0.45)] disabled:opacity-60"
              >
                <Plus className="h-6 w-6" />
              </button>
            )}
          />
        </div>
      )}
      <nav
        aria-hidden={hidden}
        className={`fixed inset-x-0 bottom-0 z-40 border-t border-white/8 bg-bar transition-[opacity,transform] duration-200 md:hidden ${
          hidden
            ? "pointer-events-none translate-y-full opacity-0"
            : "translate-y-0 opacity-100"
        }`}
      >
        <div className="grid h-13 grid-cols-6">
          {item("/app", <Sun className="h-6 w-6" />, "Today")}
          {item(
            "/app/notes",
            <NotebookText className="h-6 w-6" />,
            "Notes",
          )}
          {item(
            "/app/calendar",
            <CalendarDays className="h-6 w-6" />,
            "Calendar",
          )}
          {item(
            "/app/tasks",
            <SquareCheck className="h-6 w-6" />,
            "Tasks",
          )}
          <button
            type="button"
            aria-label="Search"
            onClick={() =>
              window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT))
            }
            className={`${TAB} text-ink-500`}
          >
            <Search className="h-6 w-6" />
            <span className="text-[0.6875rem] font-medium">Search</span>
          </button>
          <button
            type="button"
            aria-label="More"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((v) => !v)}
            className={`${TAB} ${moreOpen || moreActive ? "text-sage" : "text-ink-500"}`}
          >
            <MoreHorizontal className="h-6 w-6" />
            <span
              className={`text-[0.6875rem] ${moreOpen || moreActive ? "font-semibold" : "font-medium"}`}
            >
              More
            </span>
          </button>
        </div>
      </nav>
    </>
  );
}
