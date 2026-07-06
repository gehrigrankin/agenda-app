"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Layers,
  LayoutGrid,
  Search,
  Sun,
} from "lucide-react";

import {
  addDays,
  DATE_STR_RE,
  formatLongDate,
  localDateString,
} from "@/lib/dates";

/**
 * Redesign top bar: app mark, Boards dropdown (folder bubbles), day switcher
 * pill, centered ⌘K search pill, Customize (coming soon) and the Clerk avatar.
 * Boards + day switcher hide on mobile — the bottom nav bar covers navigation
 * there.
 */

export interface BoardEntry {
  id: string;
  title: string;
  emoji: string | null;
  color: string | null;
}

/** Close on Escape while active (house pattern, kept local per file). */
function useEscapeKey(active: boolean, onEscape: () => void) {
  const handlerRef = useRef(onEscape);
  handlerRef.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handlerRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active]);
}

export function TopBar({
  folders,
  onOpenSearch,
}: {
  folders: BoardEntry[];
  onOpenSearch: () => void;
}) {
  return (
    <div className="flex h-14 flex-none items-center gap-2.5 border-b border-white/6 bg-bar px-4">
      {/* App mark */}
      <div className="flex h-[1.875rem] w-[1.875rem] flex-none items-center justify-center rounded-lg bg-sage text-[0.9375rem] font-bold text-sage-ink">
        A
      </div>

      <BoardsMenu folders={folders} />

      {/* useSearchParams needs a Suspense boundary; the fallback is the same
          pill without a date label so the bar never jumps. */}
      <Suspense fallback={<DaySwitcherShell label="" prevDisabled nextDisabled />}>
        <DaySwitcher />
      </Suspense>

      {/* Centered search pill */}
      <button
        type="button"
        onClick={onOpenSearch}
        className="mx-auto flex min-w-0 flex-1 items-center gap-2.5 rounded-[0.5625rem] border border-white/7 bg-input px-3 py-2 text-left md:max-w-[28.75rem]"
      >
        <Search className="h-3.5 w-3.5 flex-none text-ink-600" />
        <span className="min-w-0 flex-1 truncate text-[0.78125rem] text-ink-600">
          Jump to a note, board, or day…
        </span>
        <span className="hidden flex-none rounded border border-white/12 px-1.5 py-0.5 text-[0.625rem] font-medium text-ink-500 md:inline">
          ⌘K
        </span>
      </button>

      <div className="ml-auto flex flex-none items-center gap-1.5">
        <button
          type="button"
          title="Coming soon"
          className="hidden items-center gap-1.5 rounded-[0.5625rem] px-3 py-2 text-[0.78125rem] font-medium text-ink-300 hover:bg-white/6 md:flex"
        >
          <LayoutGrid className="h-3.5 w-3.5 text-sage" />
          Customize
        </button>
        <UserButton afterSignOutUrl="/" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Boards dropdown
// ---------------------------------------------------------------------------

function BoardsMenu({ folders }: { folders: BoardEntry[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEscapeKey(open, () => setOpen(false));

  return (
    <div className="relative hidden flex-none md:block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-[0.5625rem] border border-white/8 bg-white/6 px-3 py-2 text-[0.78125rem] font-medium text-ink-200"
      >
        <Layers className="h-3.5 w-3.5 text-sage" />
        Boards
        <ChevronDown className="h-3 w-3 text-ink-400" />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close boards menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default"
          />
          <div className="absolute left-0 top-full z-40 mt-1.5 w-56 overflow-hidden rounded-xl border border-white/10 bg-panel p-1.5 shadow-2xl animate-pop-in">
            {folders.length === 0 ? (
              <p className="px-2.5 py-3 text-xs text-ink-500">
                No boards yet — mark a bubble as a folder to pin it here.
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
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Day switcher
// ---------------------------------------------------------------------------

function DaySwitcherShell({
  label,
  prevDisabled,
  nextDisabled,
  onPrev,
  onNext,
}: {
  label: string;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  return (
    <div className="hidden flex-none items-center gap-0.5 rounded-[0.5625rem] border border-white/7 bg-white/4 p-1 md:flex">
      <button
        type="button"
        aria-label="Previous day"
        disabled={prevDisabled}
        onClick={onPrev}
        className="flex h-[1.625rem] w-[1.625rem] items-center justify-center rounded-[0.4375rem] hover:bg-white/6 disabled:opacity-35 disabled:hover:bg-transparent"
      >
        <ChevronLeft className="h-3.5 w-3.5 text-ink-400" />
      </button>
      <span className="flex items-center gap-1.5 px-2.5">
        <Sun className="h-[0.8125rem] w-[0.8125rem] text-sage" />
        {/* Fixed line-height keeps the pill height stable while the label is
            empty pre-mount. */}
        <span className="min-w-[5rem] text-[0.8125rem] font-semibold leading-[1rem] text-ink-100">
          {label}
        </span>
      </span>
      <button
        type="button"
        aria-label="Next day"
        disabled={nextDisabled}
        onClick={onNext}
        className="flex h-[1.625rem] w-[1.625rem] items-center justify-center rounded-[0.4375rem] hover:bg-white/6 disabled:opacity-35 disabled:hover:bg-transparent"
      >
        <ChevronRight className="h-3.5 w-3.5 text-ink-400" />
      </button>
    </div>
  );
}

function DaySwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Today is CLIENT-local; resolve it after mount so SSR stays deterministic.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    setToday(localDateString());
  }, []);

  const dParam = searchParams.get("d");
  const requested =
    pathname === "/app" && dParam && DATE_STR_RE.test(dParam) ? dParam : null;
  // Clamp future dates back to today; off-home the switcher shows today.
  const viewed =
    today === null ? null : requested && requested < today ? requested : today;

  const goTo = (dateStr: string) => {
    if (today !== null && dateStr >= today) router.push("/app");
    else router.push(`/app?d=${dateStr}`);
  };

  return (
    <DaySwitcherShell
      label={viewed ? formatLongDate(viewed) : ""}
      prevDisabled={viewed === null}
      nextDisabled={viewed === null || viewed >= (today ?? viewed)}
      onPrev={() => viewed && goTo(addDays(viewed, -1))}
      onNext={() => viewed && goTo(addDays(viewed, 1))}
    />
  );
}
