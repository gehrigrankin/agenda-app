"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownUp,
  Check,
  ChevronDown,
  Clock,
  CornerDownRight,
  Inbox as InboxIcon,
  RefreshCw,
} from "lucide-react";

import type { InboxItemResult } from "@/app/app/inbox/actions";
import { BottomSheet } from "@/components/layout/BottomSheet";
import {
  PHONE_ICON_BTN,
  PhoneNavRow,
  PhoneTitle,
} from "@/components/phone/PhoneScreen";
import {
  domainOf,
  folderLabel,
  receivedLabel,
  snoozePresets,
  type InboxView,
} from "@/lib/inbox-triage";
import { openNavDrawer } from "@/lib/nav-drawer";

import { VIEW_META, type ViewCounts } from "./InboxSidebars";
import { SOURCE_META } from "./inbox-shared";

/**
 * Phone Inbox (design §6o): the triage queue is the first screen (reached
 * from More). A card swiped right accepts its suggested filing (green
 * "File → <folder>"), swiped left snoozes it (later today); both animate out
 * and wait a few seconds behind an Undo bar before the server action runs.
 * Tapping a card opens the full-screen File it view (InboxDetail, rendered by
 * the page and passed as `detail`). Presentational — the page owns the data
 * and the filing/snoozing actions.
 */

const SWIPE_THRESHOLD = 96;
const UNDO_MS = 5000;

export interface InboxPhoneProps {
  /** Items of the current view (the page's queue). */
  items: InboxItemResult[] | null;
  loading: boolean;
  view: InboxView;
  onView: (v: InboxView) => void;
  counts: ViewCounts;
  sort: "newest" | "oldest";
  onSort: () => void;
  now: Date | null;
  refreshing: boolean;
  onRefresh: () => void;
  hasSamples: boolean;
  onClearSamples: () => void;
  /** Accept the suggested filing / snooze — called after the Undo window. */
  onFile: (item: InboxItemResult) => void;
  onSnooze: (item: InboxItemResult, until: Date) => void;
  // navigation
  openId: string | null;
  onOpen: (id: string) => void;
  onBack: () => void;
  /** The File it view for `openId` (null while it resolves). */
  detail: React.ReactNode;
}

export function InboxPhone(props: InboxPhoneProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas md:hidden">
      {props.openId ? (
        <>
          <PhoneNavRow backLabel="Inbox" onBack={props.onBack} />
          <div className="flex min-h-0 flex-1 flex-col pb-14">
            {props.detail}
          </div>
        </>
      ) : (
        <ListScreen {...props} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

function ListScreen({
  items,
  loading,
  view,
  onView,
  counts,
  sort,
  onSort,
  now,
  refreshing,
  onRefresh,
  hasSamples,
  onClearSamples,
  onFile,
  onSnooze,
  onOpen,
}: InboxPhoneProps) {
  const [sheet, setSheet] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ key: number; text: string } | null>(
    null,
  );
  const pending = useRef<{
    id: string;
    timer: number;
    commit: () => void;
  } | null>(null);
  const toastKey = useRef(0);

  const flush = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    window.clearTimeout(p.timer);
    pending.current = null;
    p.commit();
  }, []);

  // Leaving the page commits whatever is still waiting out its Undo window.
  useEffect(() => flush, [flush]);

  const defer = (item: InboxItemResult, text: string, commit: () => void) => {
    flush();
    setHidden((prev) => new Set(prev).add(item.id));
    const timer = window.setTimeout(() => {
      flush();
      setToast(null);
    }, UNDO_MS);
    pending.current = {
      id: item.id,
      timer,
      commit: () => {
        commit();
        setHidden((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      },
    };
    setToast({ key: ++toastKey.current, text });
  };

  const undo = () => {
    const p = pending.current;
    if (!p) return;
    window.clearTimeout(p.timer);
    pending.current = null;
    setHidden((prev) => {
      const next = new Set(prev);
      next.delete(p.id);
      return next;
    });
    setToast(null);
  };

  const triage = view !== "filed" && view !== "snoozed";
  const visible = (items ?? []).filter((i) => !hidden.has(i.id));
  const meta = VIEW_META[view];
  const heading =
    view === "filed" || view === "snoozed"
      ? `${visible.length} ${meta.queueLabel}`
      : `${visible.length} to triage · swipe right to file, left to snooze`;

  return (
    <>
      <PhoneNavRow
        backLabel="More"
        onBack={openNavDrawer}
        trailing={
          <button
            type="button"
            aria-label="Refresh inbox"
            disabled={refreshing || loading}
            onClick={onRefresh}
            className={PHONE_ICON_BTN}
          >
            <RefreshCw
              className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`}
            />
          </button>
        }
      />
      <PhoneTitle
        title="Inbox"
        subtitle={loading ? "Checking captures…" : heading}
        trailing={
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => setSheet(true)}
            className="flex h-11 flex-none items-center gap-1 rounded-xl bg-white/6 pr-2.5 pl-3.5 text-[0.9375rem] font-medium text-ink-100 outline-none active:bg-white/10 focus-visible:ring-1 focus-visible:ring-sage/60"
          >
            {meta.label}
            <ChevronDown className="h-4 w-4 text-ink-400" />
          </button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pb-24">
        {hasSamples && !loading && (
          <div className="flex justify-end px-4 pb-1">
            <button
              type="button"
              onClick={onClearSamples}
              className="flex h-11 items-center rounded-lg px-3 text-[0.8125rem] font-medium text-ink-500 active:bg-white/5"
            >
              Clear samples
            </button>
          </div>
        )}
        {loading || !now ? (
          <div className="flex flex-col gap-2 px-4" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-2xl bg-panel/90"
              />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-8 pt-16 text-center">
            <InboxIcon className="h-9 w-9 text-ink-700" />
            <p className="text-[1rem] font-medium text-ink-300">{meta.empty}</p>
            {view === "all" && (
              <p className="max-w-sm text-[0.8125rem] text-ink-500">
                Install the app, then share links, photos, and text from any
                other app — they land straight here, ready to file as notes.
              </p>
            )}
          </div>
        ) : (
          <ul className="flex flex-col gap-2 px-4">
            {visible.map((item) => {
              const target = folderLabel(
                item.bubbleTitle,
                item.suggestionLabel,
              );
              return (
                <li key={item.id}>
                  <SwipeCard
                    item={item}
                    now={now}
                    swipeable={triage}
                    fileLabel={target ? `File → ${target}` : "File as note"}
                    onOpen={() => onOpen(item.id)}
                    onFile={() =>
                      defer(
                        item,
                        target ? `Filed to ${target}` : "Filed as a note",
                        () => onFile(item),
                      )
                    }
                    onSnooze={() => {
                      const until = snoozePresets(new Date())[0].until;
                      defer(item, "Snoozed until later today", () =>
                        onSnooze(item, until),
                      );
                    }}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {toast && (
        <div
          key={toast.key}
          role="status"
          className="fixed right-20 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.75rem)] left-4 z-[60] flex min-h-12 items-center gap-2 rounded-xl border border-white/10 bg-card pr-1 pl-4 shadow-xl"
        >
          <Check className="h-4 w-4 flex-none text-sage" />
          <span className="min-w-0 flex-1 truncate text-[0.875rem] text-ink-100">
            {toast.text}
          </span>
          <button
            type="button"
            onClick={undo}
            className="flex h-11 flex-none items-center rounded-lg px-3 text-[0.875rem] font-semibold text-sage active:bg-white/8"
          >
            Undo
          </button>
        </div>
      )}

      {sheet && (
        <BottomSheet
          label="Inbox view"
          onClose={() => setSheet(false)}
          header={
            <p className="px-5 pb-2 text-[0.75rem] font-semibold tracking-[0.1em] text-ink-500 uppercase">
              Show
            </p>
          }
        >
          <div className="pb-2">
            {(
              [
                "all",
                "email",
                "voice",
                "clips",
                "shared",
                "filed",
                "snoozed",
              ] as InboxView[]
            ).map((v, i) => {
              const Icon = VIEW_META[v].icon;
              return (
                <div key={v}>
                  {i === 5 && <div className="my-1 border-t border-white/6" />}
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={view === v}
                    onClick={() => {
                      setSheet(false);
                      onView(v);
                    }}
                    className={`flex min-h-12 w-full items-center gap-3 px-5 text-left text-[1rem] active:bg-white/5 ${
                      view === v ? "text-sage" : "text-ink-100"
                    }`}
                  >
                    <Icon className="h-5 w-5 flex-none" />
                    <span className="flex-1">{VIEW_META[v].label}</span>
                    <span className="text-[0.875rem] text-ink-500 tabular-nums">
                      {counts[v]}
                    </span>
                  </button>
                </div>
              );
            })}
            <div className="my-1 border-t border-white/6" />
            <button
              type="button"
              onClick={() => {
                onSort();
                setSheet(false);
              }}
              className="flex min-h-12 w-full items-center gap-3 px-5 text-left text-[1rem] text-ink-100 active:bg-white/5"
            >
              <ArrowDownUp className="h-5 w-5 flex-none text-ink-400" />
              <span className="flex-1">
                {sort === "newest"
                  ? "Newest first — show oldest first"
                  : "Oldest first — show newest first"}
              </span>
            </button>
          </div>
        </BottomSheet>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// swipeable card
// ---------------------------------------------------------------------------

type Phase = "idle" | "out" | "collapse";

function SwipeCard({
  item,
  now,
  swipeable,
  fileLabel,
  onOpen,
  onFile,
  onSnooze,
}: {
  item: InboxItemResult;
  now: Date;
  swipeable: boolean;
  fileLabel: string;
  onOpen: () => void;
  onFile: () => void;
  onSnooze: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [dx, setDx] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [height, setHeight] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{
    x: number;
    y: number;
    id: number;
    locked: boolean;
  } | null>(null);
  const moved = useRef(false);

  const { Icon, long } = SOURCE_META[item.source];
  const domain = domainOf(item.url);
  const from = `${item.source === "link" && domain ? domain : long} · ${receivedLabel(item.receivedAt, now)}`;

  const finish = (dir: "file" | "snooze") => {
    const w = wrapRef.current?.offsetWidth ?? 360;
    setHeight(wrapRef.current?.offsetHeight ?? 0);
    setPhase("out");
    setDx(dir === "file" ? w : -w);
    window.setTimeout(() => {
      setPhase("collapse");
      setHeight(0);
      window.setTimeout(dir === "file" ? onFile : onSnooze, 170);
    }, 190);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!swipeable || phase !== "idle") return;
    gesture.current = {
      x: e.clientX,
      y: e.clientY,
      id: e.pointerId,
      locked: false,
    };
    moved.current = false;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const mx = e.clientX - g.x;
    const my = e.clientY - g.y;
    if (!g.locked) {
      if (Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my) * 1.2) {
        g.locked = true;
        setDragging(true);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } else if (Math.abs(my) > 8) {
        gesture.current = null;
        return;
      } else return;
    }
    moved.current = true;
    setDx(mx);
  };
  const end = (e: React.PointerEvent, cancelled: boolean) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    setDragging(false);
    if (!g.locked) return;
    if (!cancelled && dx > SWIPE_THRESHOLD) finish("file");
    else if (!cancelled && dx < -SWIPE_THRESHOLD) finish("snooze");
    else setDx(0);
  };

  const revealed = Math.min(1, Math.abs(dx) / SWIPE_THRESHOLD);

  return (
    <div
      ref={wrapRef}
      className="relative overflow-hidden rounded-2xl"
      style={{
        height: height === null ? undefined : height,
        transition: phase === "collapse" ? "height 160ms ease-out" : undefined,
      }}
    >
      {swipeable && dx > 0 && (
        <div
          aria-hidden
          className="absolute inset-0 flex items-center gap-2 bg-sage px-4 text-[0.9375rem] font-semibold text-sage-ink"
          style={{ opacity: 0.55 + revealed * 0.45 }}
        >
          <CornerDownRight className="h-5 w-5 flex-none" />
          <span className="truncate">{fileLabel}</span>
        </div>
      )}
      {swipeable && dx < 0 && (
        <div
          aria-hidden
          className="absolute inset-0 flex items-center justify-end gap-2 bg-area-amber px-4 text-[0.9375rem] font-semibold text-sage-ink"
          style={{ opacity: 0.55 + revealed * 0.45 }}
        >
          <span>Snooze</span>
          <Clock className="h-5 w-5 flex-none" />
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          if (moved.current) {
            moved.current = false;
            return;
          }
          onOpen();
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => end(e, false)}
        onPointerCancel={(e) => end(e, true)}
        className="relative flex min-h-[4.5rem] w-full touch-pan-y items-start gap-3 rounded-2xl border border-white/7 bg-panel px-3.5 py-3 text-left outline-none select-none [-webkit-touch-callout:none] focus-visible:ring-1 focus-visible:ring-sage/60"
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging
            ? "none"
            : "transform 190ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        }}
      >
        <Icon className="mt-0.5 h-[1.125rem] w-[1.125rem] flex-none text-ink-400" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[1rem] leading-tight font-medium text-ink-100">
            {item.title}
            {item.isSample && (
              <span className="ml-2 rounded border border-white/10 px-1.5 py-px align-middle text-[0.625rem] font-medium tracking-wide text-ink-500 uppercase">
                sample
              </span>
            )}
          </span>
          <span className="truncate text-[0.8125rem] text-ink-500">{from}</span>
          {item.excerpt && (
            <span className="line-clamp-2 text-[0.875rem] leading-snug text-ink-400">
              {item.excerpt}
            </span>
          )}
        </span>
      </button>
    </div>
  );
}
