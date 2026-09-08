"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronDown,
  FileText,
  History,
  Loader2,
  PictureInPicture2,
  Plus,
} from "lucide-react";

import { useNoteDock } from "@/components/notes/NoteDockProvider";
import { useOutsideClose } from "@/lib/hooks/use-outside-close";
import { CreateMenu } from "./CreateMenu";
import { DESTINATIONS, isDestinationActive } from "./destinations";
import type { BoardEntry } from "./TopBar";

/**
 * Re-exported from its new home in CreateMenu so the widgets that listen for
 * it keep importing it from here.
 */
export { TASKS_CHANGED_EVENT } from "./CreateMenu";

/**
 * Floating left rail (desktop only): three glassy groups over the canvas —
 * primary nav, create/recents, utilities. Mobile navigation lives in the
 * bottom bar instead (see AppShell). Both render the same destination list
 * from `./destinations` — add or rename nav items there, not here.
 */

export interface RecentNote {
  id: string;
  title: string;
}

const GROUP =
  "pointer-events-auto flex flex-col gap-1 rounded-2xl border border-white/10 bg-bar/92 p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.5)] backdrop-blur-[10px]";

function RailTile({
  href,
  icon,
  label,
  active,
  disabled,
  title,
}: {
  href?: string;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  const className = `flex w-[3.25rem] flex-col items-center gap-1 rounded-xl px-0 pb-[0.4375rem] pt-2 ${
    active
      ? "bg-sage/16 text-sage"
      : disabled
        ? "text-ink-400 opacity-40"
        : "text-ink-400 hover:bg-white/6"
  }`;
  const body = (
    <>
      {icon}
      <span
        className={`text-[0.5625rem] ${active ? "font-semibold" : "font-medium"}`}
      >
        {label}
      </span>
    </>
  );
  if (href && !disabled) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }
  return (
    <div className={className} title={title}>
      {body}
    </div>
  );
}

/**
 * The rail's + button. The menu itself is shared with the boards page and the
 * bubble header (see CreateMenu); this only supplies the rail-shaped trigger.
 */
function RailCreateMenu() {
  return (
    <CreateMenu
      placement="right"
      trigger={({ open, busy, toggle }) => (
        <button
          type="button"
          disabled={busy}
          onClick={toggle}
          aria-label="Create…"
          aria-expanded={open}
          className="flex w-[3.25rem] flex-col items-center gap-[0.1875rem] rounded-xl bg-sage/16 pb-1.5 pt-2 text-sage hover:bg-sage/24 disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="h-[1.0625rem] w-[1.0625rem] animate-spin" />
          ) : (
            <Plus className="h-[1.0625rem] w-[1.0625rem]" />
          )}
          <ChevronDown className="h-2.5 w-2.5 opacity-70" />
        </button>
      )}
    />
  );
}

/**
 * The rail's board switcher: same chrome as the + button but with the accent
 * dot, dropping down the list of boards (folder bubbles) to jump between.
 */
function BoardsRailMenu({ folders }: { folders: BoardEntry[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useOutsideClose(open, containerRef, close);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Switch folder…"
        aria-expanded={open}
        className="flex w-[3.25rem] flex-col items-center gap-[0.1875rem] rounded-xl bg-sage/16 pb-1.5 pt-2 text-sage hover:bg-sage/24"
      >
        <span className="flex h-[1.0625rem] w-[1.0625rem] items-center justify-center">
          <span className="h-2.5 w-2.5 rounded-full bg-sage" />
        </span>
        <ChevronDown className="h-2.5 w-2.5 opacity-70" />
      </button>

      {open && (
        <div className="animate-pop-in absolute left-full top-0 z-50 ml-2 w-56 rounded-xl border border-white/10 bg-panel p-1.5 shadow-2xl">
          {folders.length === 0 ? (
            <p className="px-2.5 py-3 text-xs text-ink-500">
              No folders yet — mark a bubble as a folder to pin it here.
            </p>
          ) : (
            folders.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  router.push(`/app/bubbles?b=${f.id}`);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[0.78125rem] text-ink-200 hover:bg-white/6"
              >
                {f.emoji ? (
                  <span className="w-4 text-center text-sm leading-none">
                    {f.emoji}
                  </span>
                ) : (
                  <span
                    className="h-2 w-2 flex-none rounded-full"
                    style={{ background: f.color ?? "#9CC5AC" }}
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{f.title}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One recent-notes row: click navigates to the full note (unchanged); a
 * hover-revealed button opens it as a floating dock tab instead, so users
 * can pull a recent note into a side window without leaving the page.
 */
function RecentRow({ note }: { note: RecentNote }) {
  const dock = useNoteDock();
  return (
    <div className="group relative flex w-[3.25rem] flex-col items-center">
      <Link
        href={`/app/notes/${note.id}`}
        className="flex w-[3.25rem] flex-col items-center gap-1 rounded-xl px-0.5 pb-1.5 pt-[0.4375rem] text-ink-400 hover:bg-white/6"
      >
        <FileText className="h-[0.9375rem] w-[0.9375rem]" />
        <span className="max-w-[3rem] truncate text-[0.53125rem] font-medium">
          {note.title || "Untitled"}
        </span>
      </Link>
      {dock && (
        <button
          type="button"
          aria-label="Open in floating tab"
          title="Open in floating tab"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dock.open(note.id, note.title);
          }}
          className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-full bg-panel text-ink-500 opacity-0 hover:bg-white/12 hover:text-ink-200 focus-visible:opacity-100 group-hover:opacity-100"
        >
          <PictureInPicture2 className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  );
}

export function NavRail({
  recents,
  folders,
}: {
  recents: RecentNote[];
  folders: BoardEntry[];
}) {
  const pathname = usePathname();

  const primary = useMemo(
    () => DESTINATIONS.filter((d) => d.tier === "primary"),
    [],
  );
  const utilities = useMemo(
    () => DESTINATIONS.filter((d) => d.tier === "utility"),
    [],
  );

  const railRef = useRef<HTMLDivElement>(null);
  const topStackRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLDivElement>(null);
  const createRef = useRef<HTMLDivElement>(null);
  const boardsRef = useRef<HTMLDivElement>(null);
  const utilsRef = useRef<HTMLDivElement>(null);
  const recentsCardRef = useRef<HTMLDivElement>(null);
  const recentsHeaderRef = useRef<HTMLDivElement>(null);
  const recentsRowRef = useRef<HTMLDivElement>(null);

  /** Last good geometry, so we can still compute a fit when the recents card
   *  (and therefore its header/row) is currently not rendered at all. */
  const metricsRef = useRef({
    rowHeight: 0,
    rowGap: 0,
    headerHeight: 0,
    cardPadding: 0,
  });

  const [visibleRecents, setVisibleRecents] = useState(recents.length);
  const recentsKey = recents.map((n) => n.id).join(",");

  // New recents from the server: show them all again, then let the measure
  // pass below trim back to what fits.
  useLayoutEffect(() => {
    setVisibleRecents(recents.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentsKey]);

  /**
   * Overflow policy: the rail never scrolls and never clips. When the top
   * stack plus the utilities group would exceed the rail's height, the
   * recents card gives first — rows drop one at a time from the end, and once
   * not even one row fits the card is omitted entirely. Primary tiles, the +
   * button, the board switcher and the utilities never move.
   *
   * This is measured rather than handed to CSS `overflow` because both CSS
   * answers look broken: a clipped tile is a half-drawn control, and a
   * scrollbar inside a floating nav rail reads as a web page, not an app (the
   * same app-like intent documented in the BubbleCanvas header). Sizes come
   * from `getComputedStyle`/`offsetHeight` on the real elements so changing a
   * padding or gap class here needs no matching constant.
   */
  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const measure = () => {
      const stack = topStackRef.current;
      const primaryEl = primaryRef.current;
      const createEl = createRef.current;
      const boardsEl = boardsRef.current;
      const utilsEl = utilsRef.current;
      if (!stack || !primaryEl || !createEl || !boardsEl || !utilsEl) return;

      const railStyle = getComputedStyle(rail);
      const available =
        rail.clientHeight -
        parseFloat(railStyle.paddingTop) -
        parseFloat(railStyle.paddingBottom);

      const stackGap = parseFloat(getComputedStyle(stack).rowGap) || 0;
      // Four cards in the top stack => three gaps between them, plus one more
      // gap as the minimum breathing room above the utilities group.
      const fixed =
        primaryEl.offsetHeight +
        createEl.offsetHeight +
        boardsEl.offsetHeight +
        utilsEl.offsetHeight +
        stackGap * 4;

      const m = metricsRef.current;
      const card = recentsCardRef.current;
      if (card) {
        const cardStyle = getComputedStyle(card);
        m.cardPadding =
          parseFloat(cardStyle.paddingTop) +
          parseFloat(cardStyle.paddingBottom);
        m.rowGap = parseFloat(cardStyle.rowGap) || m.rowGap;
      }
      if (recentsHeaderRef.current)
        m.headerHeight = recentsHeaderRef.current.offsetHeight;
      if (recentsRowRef.current)
        m.rowHeight = recentsRowRef.current.offsetHeight;

      // header + n rows + n gaps (one above each row, including the first).
      const stride = m.rowHeight + m.rowGap;
      if (stride <= 0) return;
      const overhead = m.cardPadding + m.headerHeight;

      const fit = Math.floor((available - fixed - overhead) / stride);
      const next = Math.max(0, Math.min(recents.length, fit));
      setVisibleRecents((prev) => (prev === next ? prev : next));
    };

    measure();
    // Observe only the rail itself: observing the recents card would make our
    // own trimming re-enter the observer.
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    return () => observer.disconnect();
  }, [recentsKey, recents.length]);

  const shownRecents = recents.slice(0, visibleRecents);

  return (
    <div
      ref={railRef}
      className="pointer-events-none absolute inset-y-0 left-[0.875rem] z-40 hidden flex-col justify-between py-4 md:flex"
    >
      <div ref={topStackRef} className="flex flex-col gap-2">
        {/* Primary nav */}
        <div ref={primaryRef} className={GROUP}>
          {primary.map((d) => (
            <RailTile
              key={d.href}
              href={d.href}
              active={isDestinationActive(pathname, d.href)}
              icon={<d.icon className="h-[1.0625rem] w-[1.0625rem]" />}
              label={d.label}
            />
          ))}
        </div>

        {/* Create */}
        <div ref={createRef} className={GROUP}>
          <RailCreateMenu />
        </div>

        {/* Board switcher */}
        <div ref={boardsRef} className={GROUP}>
          <BoardsRailMenu folders={folders} />
        </div>

        {/* Recents */}
        {shownRecents.length > 0 && (
          <div ref={recentsCardRef} className={GROUP}>
            <div
              ref={recentsHeaderRef}
              className="flex w-[3.25rem] flex-col items-center rounded-xl pb-1.5 pt-[0.4375rem]"
            >
              <History className="h-[0.8125rem] w-[0.8125rem] text-ink-600" />
            </div>
            {shownRecents.map((n, i) => (
              <div key={n.id} ref={i === 0 ? recentsRowRef : undefined}>
                <RecentRow note={n} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Utilities */}
      <div ref={utilsRef} className={GROUP}>
        {utilities.map((d) => (
          <RailTile
            key={d.href}
            href={d.href}
            active={isDestinationActive(pathname, d.href)}
            icon={<d.icon className="h-4 w-4" />}
            label={d.label}
          />
        ))}
      </div>
    </div>
  );
}
