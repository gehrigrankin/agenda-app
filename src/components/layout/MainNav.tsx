"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import {
  ChevronsLeft,
  ChevronsRight,
  Loader2,
  MoreHorizontal,
  Plus,
  UserPlus,
} from "lucide-react";

import { useOutsideClose } from "@/lib/hooks/use-outside-close";
import { CreateMenu } from "./CreateMenu";
import { DESTINATIONS, isDestinationActive } from "./destinations";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The docked main nav (Notes Sidebars design §1): edge to edge, no gutter, no
 * shadow — the floating rail it replaces cost ~90px of every page and forced
 * each page to pad around it. Same items on every page:
 * Today · Notes · Tasks · Calendar · People · Inbox, a spacer, + New, More.
 *
 * Three widths, all driven by `--main-nav-w` on the shell root (AppShell) so
 * pages and portaled chrome can position against it:
 * - desktop (lg+, fine pointer): 76px icon + label, or 52px icon-only when
 *   collapsed with the « toggle (persisted);
 * - tablet (md–lg, or any md+ coarse pointer): a 60px icon-only rail;
 * - phone: not rendered — the bottom tab bar takes over.
 * The mode is pure CSS (breakpoint + `touch:` variant) so SSR and the first
 * paint already agree; only the collapsed flag comes from storage.
 */

export const MAIN_NAV_COLLAPSED_KEY = "agenda.layout.nav-collapsed";

/** Shell-root classes that set `--main-nav-w` for the current mode. */
export function mainNavWidthClass(collapsed: boolean): string {
  return collapsed
    ? "[--main-nav-w:0px] md:[--main-nav-w:4.625rem] lg:[--main-nav-w:4rem] lg:touch:[--main-nav-w:4.625rem]"
    : "[--main-nav-w:0px] md:[--main-nav-w:4.625rem] lg:[--main-nav-w:5.875rem] lg:touch:[--main-nav-w:4.625rem]";
}

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sage/70";

export function MainNav({
  isGuest,
  collapsed,
  onToggleCollapsed,
}: {
  isGuest: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const pathname = usePathname();
  const primary = DESTINATIONS.filter((d) => d.tier === "primary");
  // Labels show only in the full desktop mode; the tablet rail and the
  // collapsed desktop nav are icon-only (label moves to aria-label/title).
  const labelCls = collapsed ? "hidden" : "hidden lg:block touch:hidden";
  const tileW = collapsed
    ? "w-[2.75rem] lg:w-[3rem] lg:touch:w-[2.75rem]"
    : "w-[2.75rem] lg:w-[4.875rem] lg:touch:w-[2.75rem]";

  return (
    <nav
      aria-label="Main"
      className="hidden h-full w-(--main-nav-w) flex-none flex-col items-center border-r border-white/6 bg-nav pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 transition-[width] duration-150 md:flex"
    >
      <AccountMark isGuest={isGuest} />

      <ul className="mt-4 flex flex-col items-center gap-1">
        {primary.map((d) => {
          const active = isDestinationActive(pathname, d.href);
          return (
            <li key={d.href}>
              <Link
                href={d.href}
                aria-label={d.label}
                aria-current={active ? "page" : undefined}
                title={d.label}
                className={`flex min-h-11 ${tileW} flex-col items-center justify-center gap-1 rounded-xl py-1.5 transition-colors ${FOCUS} ${
                  active
                    ? "bg-sage/14 text-sage"
                    : "text-ink-400 hover:bg-white/5 hover:text-ink-200"
                }`}
              >
                <d.icon className="h-[1.1875rem] w-[1.1875rem]" />
                <span
                  className={`${labelCls} text-[0.75rem] leading-none ${active ? "font-semibold" : "font-medium"}`}
                >
                  {d.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="flex-1" />

      <CreateMenu
        placement="right-up"
        trigger={({ open, busy, toggle }) => (
          <button
            type="button"
            disabled={busy}
            onClick={toggle}
            aria-label="New…"
            aria-expanded={open}
            title="New"
            className={`flex h-11 w-11 items-center justify-center rounded-xl border border-sage/25 bg-sage/12 text-sage transition-colors hover:bg-sage/20 disabled:opacity-60 ${FOCUS}`}
          >
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Plus className="h-5 w-5" />
            )}
          </button>
        )}
      />

      <MoreMenu
        pathname={pathname}
        tileW={tileW}
        labelCls={labelCls}
        isGuest={isGuest}
      />

      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        aria-pressed={collapsed}
        title={collapsed ? "Expand navigation" : "Collapse navigation"}
        className={`mt-1 hidden h-8 w-8 items-center justify-center rounded-lg text-ink-600 hover:bg-white/5 hover:text-ink-300 lg:flex touch:hidden ${FOCUS}`}
      >
        {collapsed ? (
          <ChevronsRight className="h-4 w-4" />
        ) : (
          <ChevronsLeft className="h-4 w-4" />
        )}
      </button>
    </nav>
  );
}

/**
 * Top of the nav: the account. Signed-in owners get Clerk's avatar menu (it
 * replaces the old top bar's UserButton); guests get the app mark, linking to
 * sign-up — a guest's only route to keeping their work must never be hidden.
 */
function AccountMark({ isGuest }: { isGuest: boolean }) {
  if (isGuest) {
    return (
      <Link
        href="/sign-up"
        aria-label="Save your work — create an account"
        title="Save your work — create an account"
        className={`flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-sage text-[0.9375rem] font-bold text-sage-ink ${FOCUS}`}
      >
        A
      </Link>
    );
  }
  return (
    <div className="flex h-9 w-9 flex-none items-center justify-center">
      <UserButton
        appearance={{ elements: { avatarBox: "h-8 w-8 rounded-xl" } }}
      />
    </div>
  );
}

/**
 * More: Threads, Trash, Settings; then, below a divider, the pages the design
 * doesn't place (Canvas, Rules, Garden, Habits, Folders); then the theme
 * toggle (the top bar that held it is gone). Highlighted whenever the current
 * page lives in it — on Threads, More shows active.
 */
function MoreMenu({
  pathname,
  tileW,
  labelCls,
  isGuest,
}: {
  pathname: string;
  tileW: string;
  labelCls: string;
  isGuest: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLAnchorElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useOutsideClose(open, containerRef, close);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (open) firstItemRef.current?.focus();
  }, [open]);

  const more = DESTINATIONS.filter((d) => d.tier === "more");
  const extra = DESTINATIONS.filter((d) => d.tier === "extra");
  const active = [...more, ...extra].some((d) =>
    isDestinationActive(pathname, d.href),
  );

  const row = (d: (typeof DESTINATIONS)[number], i: number) => {
    const on = isDestinationActive(pathname, d.href);
    return (
      <Link
        key={d.href}
        ref={i === 0 ? firstItemRef : undefined}
        href={d.href}
        role="menuitem"
        onClick={close}
        aria-current={on ? "page" : undefined}
        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[0.8125rem] touch:min-h-11 ${FOCUS} ${
          on ? "bg-sage/14 text-sage" : "text-ink-200 hover:bg-white/6"
        }`}
      >
        <d.icon className="h-4 w-4 flex-none" />
        <span className="min-w-0 flex-1 truncate">{d.label}</span>
      </Link>
    );
  };

  return (
    <div ref={containerRef} className="relative mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="More"
        title="More"
        className={`flex min-h-11 ${tileW} flex-col items-center justify-center gap-1 rounded-xl py-1.5 transition-colors ${FOCUS} ${
          active || open
            ? "bg-sage/14 text-sage"
            : "text-ink-400 hover:bg-white/5 hover:text-ink-200"
        }`}
      >
        <MoreHorizontal className="h-[1.1875rem] w-[1.1875rem]" />
        <span
          className={`${labelCls} text-[0.75rem] leading-none ${active ? "font-semibold" : "font-medium"}`}
        >
          More
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="More"
          className="animate-pop-in absolute bottom-0 left-full z-50 ml-2 w-56 rounded-xl border border-white/10 bg-panel p-1.5 shadow-2xl"
        >
          {more.map(row)}
          <div className="my-1.5 h-px bg-white/7" role="separator" />
          {extra.map((d) => row(d, -1))}
          <div className="my-1.5 h-px bg-white/7" role="separator" />
          {isGuest && (
            <Link
              href="/sign-up"
              role="menuitem"
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.8125rem] text-sage hover:bg-white/6 touch:min-h-11 ${FOCUS}`}
            >
              <UserPlus className="h-4 w-4 flex-none" />
              Save your work
            </Link>
          )}
          <ThemeToggle menu />
        </div>
      )}
    </div>
  );
}
