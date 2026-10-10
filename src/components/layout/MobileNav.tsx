"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { MoreHorizontal, Plus, Search, UserPlus } from "lucide-react";

import { OPEN_SEARCH_EVENT } from "@/components/search/openSearch";
import { CreateMenu } from "./CreateMenu";
import {
  DESTINATIONS,
  MOBILE_TAB_HREFS,
  isDestinationActive,
  type Destination,
} from "./destinations";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Phone navigation (Notes Sidebars design §4j / §5): a bottom tab bar —
 * Today · Notes · Tasks · Calendar · More — plus a drawer that holds every
 * page (Threads, Trash and Settings live under More), search, the theme, and
 * sync status. The drawer opens from More or by swiping in from the left
 * edge on any screen.
 *
 * Both render from `./destinations`, like the desktop nav, so the item sets
 * can't drift.
 */

/** Pixels from the left edge where a swipe starts the drawer. */
const EDGE = 22;

export function MobileNav({
  hidden,
  hideFab,
  isGuest,
}: {
  /** Keyboard up / focus mode: the bar steps out of the way. */
  hidden: boolean;
  hideFab: boolean;
  isGuest: boolean;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const close = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => setDrawerOpen(false), [pathname]);
  useEffect(() => {
    if (hidden) setDrawerOpen(false);
  }, [hidden]);

  useEdgeSwipe(!hidden, () => setDrawerOpen(true));

  const tabs = MOBILE_TAB_HREFS.map(
    (href) => DESTINATIONS.find((d) => d.href === href)!,
  );
  const inTabs = (d: Destination) =>
    (MOBILE_TAB_HREFS as readonly string[]).includes(d.href);
  const moreActive = DESTINATIONS.some(
    (d) => !inTabs(d) && isDestinationActive(pathname, d.href),
  );

  const TAB =
    "flex min-h-11 flex-col items-center justify-center gap-0.5 px-1 py-1.5 outline-none focus-visible:bg-white/6";

  return (
    <>
      {drawerOpen && (
        <NavDrawer pathname={pathname} isGuest={isGuest} onClose={close} />
      )}

      {/* Create stays on a FAB while pages without their own + rely on it. */}
      {!drawerOpen && !hideFab && (
        <div
          aria-hidden={hidden}
          inert={hidden}
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
        aria-label="Main"
        aria-hidden={hidden}
        inert={hidden}
        className={`fixed inset-x-0 bottom-0 z-40 border-t border-white/8 bg-nav pb-[env(safe-area-inset-bottom)] transition-[opacity,transform] duration-200 md:hidden ${
          hidden
            ? "pointer-events-none translate-y-full opacity-0"
            : "translate-y-0 opacity-100"
        }`}
      >
        <div className="grid h-14 grid-cols-5">
          {tabs.map((d) => {
            const active = isDestinationActive(pathname, d.href);
            return (
              <Link
                key={d.href}
                href={d.href}
                aria-current={active ? "page" : undefined}
                className={`${TAB} ${active ? "text-sage" : "text-ink-500"}`}
              >
                <d.icon className="h-6 w-6" />
                <span
                  className={`text-[0.6875rem] ${active ? "font-semibold" : "font-medium"}`}
                >
                  {d.label}
                </span>
              </Link>
            );
          })}
          <button
            type="button"
            aria-label="More"
            aria-haspopup="dialog"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((v) => !v)}
            className={`${TAB} ${drawerOpen || moreActive ? "text-sage" : "text-ink-500"}`}
          >
            <MoreHorizontal className="h-6 w-6" />
            <span
              className={`text-[0.6875rem] ${drawerOpen || moreActive ? "font-semibold" : "font-medium"}`}
            >
              More
            </span>
          </button>
        </div>
      </nav>
    </>
  );
}

/** Opens the drawer on a rightward swipe that starts at the left edge. */
function useEdgeSwipe(enabled: boolean, onOpen: () => void) {
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  useEffect(() => {
    if (!enabled) return;
    const mql = window.matchMedia("(max-width: 767.98px)");
    let start: { x: number; y: number } | null = null;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      start =
        mql.matches && t && t.clientX <= EDGE
          ? { x: t.clientX, y: t.clientY }
          : null;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = Math.abs(t.clientY - start.y);
      if (dy > 40) start = null;
      else if (dx > 56) {
        start = null;
        openRef.current();
      }
    };
    const onEnd = () => {
      start = null;
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, [enabled]);
}

function NavDrawer({
  pathname,
  isGuest,
  onClose,
}: {
  pathname: string;
  isGuest: boolean;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [dx, setDx] = useState(0);
  const drag = useRef<number | null>(null);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>("a,button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const primary = DESTINATIONS.filter((d) => d.tier === "primary");
  const more = DESTINATIONS.filter((d) => d.tier === "more");
  const extra = DESTINATIONS.filter((d) => d.tier === "extra");

  const row = (d: Destination) => {
    const active = isDestinationActive(pathname, d.href);
    return (
      <Link
        key={d.href}
        href={d.href}
        onClick={onClose}
        aria-current={active ? "page" : undefined}
        className={`flex min-h-12 items-center gap-3.5 rounded-xl px-3.5 text-[1rem] outline-none focus-visible:ring-1 focus-visible:ring-sage/60 ${
          active ? "bg-sage/14 font-semibold text-ink-100" : "text-ink-200"
        }`}
      >
        <d.icon
          className={`h-5 w-5 ${active ? "text-sage" : "text-ink-400"}`}
        />
        {d.label}
      </Link>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[60] md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Navigation"
    >
      <button
        type="button"
        aria-label="Close navigation"
        tabIndex={-1}
        onClick={onClose}
        className="animate-overlay-fade-in absolute inset-0 cursor-default bg-black/55"
      />
      <div
        ref={panelRef}
        onTouchStart={(e) => {
          drag.current = e.touches[0]?.clientX ?? null;
        }}
        onTouchMove={(e) => {
          if (drag.current === null) return;
          setDx(Math.min(0, (e.touches[0]?.clientX ?? 0) - drag.current));
        }}
        onTouchEnd={() => {
          drag.current = null;
          if (dx < -70) onClose();
          else setDx(0);
        }}
        className="absolute inset-y-0 left-0 flex w-[min(19rem,80vw)] flex-col overflow-y-auto border-r border-white/8 bg-sidebar pt-[calc(1.25rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[18px_0_50px_rgba(0,0,0,0.5)] transition-transform"
        style={{ transform: `translateX(${dx}px)` }}
      >
        <DrawerAccount isGuest={isGuest} />
        <button
          type="button"
          onClick={() => {
            onClose();
            window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT));
          }}
          className="mx-2.5 mb-2 flex min-h-11 items-center gap-3 rounded-xl border border-white/8 bg-white/4 px-3.5 text-left text-[0.9375rem] text-ink-500"
        >
          <Search className="h-4.5 w-4.5" />
          Search
        </button>
        <nav aria-label="Pages" className="flex flex-col gap-0.5 px-2.5">
          {primary.map(row)}
          <div role="separator" className="mx-3 my-2 h-px bg-white/8" />
          {more.map(row)}
          <div role="separator" className="mx-3 my-2 h-px bg-white/8" />
          {extra.map(row)}
        </nav>
        <div className="mt-auto px-2.5 pt-3">
          <ThemeToggle menu />
        </div>
      </div>
    </div>
  );
}

function DrawerAccount({ isGuest }: { isGuest: boolean }) {
  const online = useOnline();
  const status = (
    <span className="flex items-center gap-1.5 text-[0.8125rem] text-ink-500">
      <span
        className={`h-1.5 w-1.5 rounded-full ${online ? "bg-sage" : "bg-overdue"}`}
      />
      {online ? "Synced" : "Offline — changes save when you're back"}
    </span>
  );
  if (isGuest) {
    return (
      <div className="mb-3 flex items-center gap-3 px-5">
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-sage text-[1rem] font-bold text-sage-ink">
          A
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <Link
            href="/sign-up"
            className="flex items-center gap-1.5 text-[1rem] font-semibold text-sage"
          >
            <UserPlus className="h-4 w-4" /> Save your work
          </Link>
          {status}
        </span>
      </div>
    );
  }
  return <SignedInAccount status={status} />;
}

function SignedInAccount({ status }: { status: React.ReactNode }) {
  const { user } = useUser();
  const name = user?.firstName || user?.username || "You";
  return (
    <div className="mb-3 flex items-center gap-3 px-5">
      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-white/10 bg-white/6 text-[1rem] font-semibold text-ink-200">
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[1rem] font-semibold text-ink-100">
          {name}
        </span>
        {status}
      </span>
    </div>
  );
}

function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return online;
}
