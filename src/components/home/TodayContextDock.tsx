"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Activity, Maximize2, Minimize2, X } from "lucide-react";

export type TodayContextTab = "tasks" | "linked" | "calendar";
type SheetSize = "peek" | "half" | "full";

const LABELS: Record<TodayContextTab, string> = {
  tasks: "Tasks",
  linked: "Linked",
  calendar: "Calendar",
};

const HEIGHTS: Record<SheetSize, string> = {
  peek: "34%",
  half: "58%",
  // The sheet sits above the 3.25rem dock. Subtract that dock as well as the
  // top breathing room, otherwise the full-size header is pushed off-screen.
  full: "calc(100% - 3.75rem)",
};

/** Phone-only context dock for Today. The jot keeps the viewport; secondary
 * context opens over it and remains reachable without scrolling the page. */
export function TodayContextDock({
  active,
  onActiveChange,
  open,
  onOpenChange,
  badges,
  habitStatus,
  children,
}: {
  active: TodayContextTab;
  onActiveChange: (tab: TodayContextTab) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  badges: Partial<Record<TodayContextTab, string | number>>;
  habitStatus?: { count: number; done: number } | null;
  children: ReactNode;
}) {
  const [size, setSize] = useState<SheetSize>("half");
  const dragStart = useRef<number | null>(null);

  useEffect(() => {
    if (!open) setSize("half");
  }, [open]);

  const select = (tab: TodayContextTab) => {
    onActiveChange(tab);
    onOpenChange(true);
  };

  const finishDrag = (clientY: number) => {
    if (dragStart.current === null) return;
    const delta = clientY - dragStart.current;
    dragStart.current = null;
    if (delta > 90) {
      if (size === "full") setSize("half");
      else if (size === "half") setSize("peek");
      else onOpenChange(false);
    } else if (delta < -90) {
      if (size === "peek") setSize("half");
      else setSize("full");
    }
  };

  return (
    <>
      {open && (
        <section
          role="dialog"
          aria-modal="false"
          aria-label={`${LABELS[active]} for this day`}
          className="absolute inset-x-0 bottom-[3.25rem] z-30 flex flex-col overflow-hidden rounded-t-2xl border border-b-0 border-white/12 bg-panel shadow-[0_-18px_45px_rgba(0,0,0,0.55)] md:hidden"
          style={{ height: HEIGHTS[size] }}
        >
          <div
            className="flex touch-none flex-none items-center gap-2 border-b border-white/8 px-3 pb-2 pt-2"
            onPointerDown={(event) => {
              dragStart.current = event.clientY;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerUp={(event) => finishDrag(event.clientY)}
            onPointerCancel={() => {
              dragStart.current = null;
            }}
          >
            <span className="absolute left-1/2 top-1.5 h-1 w-9 -translate-x-1/2 rounded-full bg-white/18" />
            <strong className="mt-1 text-[0.8125rem] font-semibold text-ink-100">
              {LABELS[active]}
            </strong>
            <div className="ml-auto mt-1 flex items-center gap-1">
              <button
                type="button"
                aria-label={
                  size === "full" ? "Exit full screen" : "Open full screen"
                }
                onClick={() => setSize(size === "full" ? "half" : "full")}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-400"
              >
                {size === "full" ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </button>
              <button
                type="button"
                aria-label="Close panel"
                onClick={() => onOpenChange(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-400"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
        </section>
      )}

      <nav
        aria-label="Today context"
        className={`relative -mx-3 -mb-3 grid h-[3.25rem] w-[calc(100%+1.5rem)] flex-none grid-cols-3 gap-1 overflow-hidden border-t border-white/10 bg-[#0b0d0e] p-1 md:hidden ${open ? "z-30" : "z-20"}`}
      >
        {habitStatus && habitStatus.count > 0 && (
          <Link
            href="/app/habits"
            aria-label={`${habitStatus.done} of ${habitStatus.count} habits complete`}
            className="absolute bottom-[calc(100%+0.3rem)] left-1 flex h-7 items-center gap-1.5 rounded-full border border-sage/25 bg-[#18231f]/95 px-2.5 text-[0.6875rem] font-medium text-sage shadow-lg"
          >
            <Activity className="h-3 w-3" />
            Habits {habitStatus.done}/{habitStatus.count}
          </Link>
        )}
        {(Object.keys(LABELS) as TodayContextTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            aria-pressed={open && active === tab}
            onClick={() => select(tab)}
            className={`flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-[0.71875rem] font-medium ${
              open && active === tab ? "bg-sage/16 text-sage" : "text-ink-400"
            }`}
          >
            <span>{LABELS[tab]}</span>
            {badges[tab] !== undefined && (
              <span className="flex min-w-5 items-center justify-center rounded-full bg-white/8 px-1.5 py-0.5 text-[0.625rem] tabular-nums text-ink-300">
                {badges[tab]}
              </span>
            )}
          </button>
        ))}
      </nav>
    </>
  );
}
