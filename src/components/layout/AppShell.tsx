"use client";

import {
  Suspense,
  createContext,
  useContext,
  useState,
} from "react";
import { usePathname } from "next/navigation";

import { AutomationToasts } from "@/components/automations/AutomationToast";
import { ReminderSnoozePrompt } from "@/components/layout/ReminderSnoozePrompt";
import {
  NoteDockHost,
  NoteDockProvider,
} from "@/components/notes/NoteDockProvider";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";
import { CommandPalette } from "@/components/search/CommandPalette";
import { MAIN_NAV_COLLAPSED_KEY, MainNav, mainNavWidthClass } from "./MainNav";
import { MobileNav } from "./MobileNav";
import { usePersistentState } from "@/lib/hooks/use-persistent-state";
import { useMobileWritingMode } from "./useMobileWritingMode";

/**
 * Lets a page hide the shell's chrome (the main nav, the phone tab bar) —
 * Notes' focus mode (⌘⇧F) hides every sidebar, the nav included.
 */
const ShellChromeContext = createContext<(hidden: boolean) => void>(() => {});
export function useHideShellChrome() {
  return useContext(ShellChromeContext);
}

/**
 * Docked shell (Notes Sidebars design §1): [Main nav] [page], edge to edge —
 * no top bar, no floating rail. Each page lays out its own sidebars with
 * `PageLayout`. Phone keeps the bottom icon bar. Hosts the always-mounted ⌘K
 * palette and the note dock so open note windows survive navigation between
 * /app pages.
 *
 * `--main-nav-w` (set here per breakpoint/collapse) is the nav's width, for
 * anything positioned against it.
 */
export function AppShell({
  children,
  isGuest,
}: {
  children: React.ReactNode;
  /** Resolved on the server: Clerk's <SignedOut> renders nothing until its JS
   *  loads, which would flash the guest's only route to an account. */
  isGuest: boolean;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [chromeHidden, setChromeHidden] = useState(false);
  const [navCollapsed, setNavCollapsed] = usePersistentState<boolean>(
    MAIN_NAV_COLLAPSED_KEY,
    false,
    (v): v is boolean => typeof v === "boolean",
  );
  const pathname = usePathname();
  const isToday = pathname === "/app";
  // Every phone writing surface gets the Today behavior: when the software
  // keyboard is up, the tab bar and FAB leave the viewport instead of sitting
  // on top of the editor/input. This was initially scoped to the daily note,
  // which made Notes, Tasks, People and forms feel like different apps.
  const mobileWriting = useMobileWritingMode(true);

  // dvh, not vh: iOS Safari's 100vh extends under its toolbars, which pushed
  // the bottom of the app (canvas controls included) off the visible screen.
  return (
    <NoteDockProvider>
      <ShellChromeContext.Provider value={setChromeHidden}>
        <div
          className={`flex h-dvh overflow-hidden bg-canvas text-ink-100 ${mainNavWidthClass(navCollapsed)}`}
        >
          {!chromeHidden && (
            <MainNav
              isGuest={isGuest}
              collapsed={navCollapsed}
              onToggleCollapsed={() => setNavCollapsed((v) => !v)}
            />
          )}

          <div
            className={`relative min-h-0 min-w-0 flex-1 pt-[env(safe-area-inset-top)] ${
              isToday ? "bg-bar md:bg-transparent" : ""
            }`}
          >
            <main
              className={`flex h-full min-h-0 flex-col overflow-hidden transition-[padding] duration-200 md:pb-0 ${
                mobileWriting
                  ? "pb-0"
                  : "pb-[calc(3.5rem+env(safe-area-inset-bottom))]"
              }`}
              style={
                isToday
                  ? { touchAction: "pan-y", overscrollBehaviorX: "none" }
                  : undefined
              }
            >
              {children}
            </main>
            <MobileNav
              hidden={mobileWriting || chromeHidden}
              hideFab={isToday || pathname.startsWith("/app/notes")}
              isGuest={isGuest}
            />
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
      </ShellChromeContext.Provider>
    </NoteDockProvider>
  );
}
