"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FilePlus,
  GitBranch,
  GitCommitVertical,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";

import {
  listDismissedThreadsAction,
  reopenThreadAction,
  type DismissedThreadItem,
  type ThreadDetailResult,
  type ThreadListItem,
  type ThreadMentionItem,
} from "@/app/app/ai/actions";
import { BottomSheet } from "@/components/layout/BottomSheet";
import {
  PHONE_ICON_BTN,
  PhoneNavRow,
  PhoneTitle,
} from "@/components/phone/PhoneScreen";
import { openNavDrawer } from "@/lib/nav-drawer";
import {
  KIND,
  mentionHref,
  mentionKind,
  useThreadContext,
} from "./ThreadsDesktop";
import {
  buildTimeline,
  flattenTimeline,
  formatMentionDate,
  mentionSpanLabel,
  relativeTime,
  threadColorClass,
} from "./thread-utils";

/**
 * Phone Threads (design §6k–6l): the list is the first screen (reached from
 * More); tapping a thread opens it as a full-screen timeline of cards. The
 * open thread lives in `?t=` so the back chevron / system back returns to the
 * list. Presentational — data and mutations arrive from ThreadsPageClient.
 */

export interface ThreadsPhoneProps {
  loading: boolean;
  aiConfigured: boolean | null;
  threads: ThreadListItem[];
  /** The thread open full-screen, or null for the list. */
  openId: string | null;
  detail: ThreadDetailResult | null;
  detailLoading: boolean;
  today: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  promoting: boolean;
  onPromote: () => void;
  onDismiss: (id: string) => void;
  dismissedVersion: number;
  onRestored: () => void;
  onOpen: (id: string) => void;
  onBack: () => void;
}

function Pulse({ className }: { className: string }) {
  return (
    <div className={`animate-pulse rounded-xl bg-panel/90 ${className}`} />
  );
}

export function ThreadsPhone(props: ThreadsPhoneProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas md:hidden">
      {props.openId ? <ThreadScreen {...props} /> : <ListScreen {...props} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

function ListScreen({
  loading,
  aiConfigured,
  threads,
  refreshing,
  onRefresh,
  dismissedVersion,
  onRestored,
  onOpen,
}: ThreadsPhoneProps) {
  const [now] = useState(() => Date.now());
  const scanDisabled = refreshing || loading || aiConfigured === false;

  return (
    <>
      <PhoneNavRow
        backLabel="More"
        onBack={openNavDrawer}
        trailing={
          <button
            type="button"
            aria-label="Scan for threads"
            disabled={scanDisabled}
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
        title="Threads"
        subtitle={loading ? "Finding recurring ideas…" : undefined}
      />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pb-20">
        {loading ? (
          <div className="flex flex-col gap-2 px-4" aria-hidden>
            <Pulse className="h-14 w-full" />
            <Pulse className="h-14 w-full" />
            <Pulse className="h-14 w-full" />
          </div>
        ) : threads.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-8 pt-12 pb-6 text-center">
            <GitCommitVertical className="h-9 w-9 text-ink-700" />
            {aiConfigured === false ? (
              <>
                <p className="text-[1rem] font-medium text-ink-300">
                  Thread detection needs an API key
                </p>
                <p className="max-w-sm text-[0.8125rem] text-ink-500">
                  Set ANTHROPIC_API_KEY to let the app notice topics that keep
                  coming back across your notes.
                </p>
              </>
            ) : (
              <>
                <p className="text-[1rem] font-medium text-ink-300">
                  No threads yet
                </p>
                <p className="max-w-sm text-[0.8125rem] text-ink-500">
                  They appear when a topic shows up across several notes.
                </p>
                <button
                  type="button"
                  disabled={refreshing}
                  onClick={onRefresh}
                  className="mt-2 flex h-11 items-center gap-2 rounded-xl bg-sage px-4 text-[0.875rem] font-semibold text-sage-ink disabled:opacity-60"
                >
                  {refreshing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Scan now
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            {aiConfigured === false && (
              <p className="mx-5 mb-2 text-[0.75rem] text-ink-500">
                New scans need ANTHROPIC_API_KEY — showing threads already
                found.
              </p>
            )}
            <ul>
              {threads.map((t) => (
                <li
                  key={t.id}
                  className="border-b border-white/6 last:border-0"
                >
                  <button
                    type="button"
                    onClick={() => onOpen(t.id)}
                    className="flex min-h-[3.5rem] w-full items-center gap-3 px-5 py-2 text-left outline-none active:bg-white/5 focus-visible:bg-white/5"
                  >
                    <GitBranch
                      className={`h-[1.125rem] w-[1.125rem] flex-none ${threadColorClass(t.id)}`}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[1rem] text-ink-100">
                        {t.topic}
                      </span>
                      <span className="block truncate text-[0.8125rem] text-ink-500">
                        {t.status === "promoted" && "Promoted · "}
                        {mentionSpanLabel(
                          t.mentionCount,
                          t.firstMentionAt,
                          t.lastMentionAt,
                        )}
                      </span>
                    </span>
                    <span className="flex-none self-start pt-1 text-[0.8125rem] text-ink-500 tabular-nums">
                      {relativeTime(t.lastMentionAt, now)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {!loading && (
          <DismissedThreads
            refreshKey={dismissedVersion}
            onRestored={onRestored}
          />
        )}
      </div>
    </>
  );
}

/** Dismissals are reversible — kept at the end of the list, also when empty. */
function DismissedThreads({
  refreshKey,
  onRestored,
}: {
  refreshKey: number;
  onRestored: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<DismissedThreadItem[] | null>(null);
  const [restoring, setRestoring] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listDismissedThreadsAction()
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((err) => console.error("[threads] dismissed load failed:", err));
    return () => {
      cancelled = true;
    };
  }, [open, refreshKey]);

  const restore = (id: string) => {
    setRestoring((prev) => new Set(prev).add(id));
    reopenThreadAction(id)
      .then((ok) => {
        if (ok) {
          setItems((prev) => (prev ? prev.filter((i) => i.id !== id) : prev));
          onRestored();
        }
      })
      .catch((err) => console.error("[threads] restore failed:", err))
      .finally(() =>
        setRestoring((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        }),
      );
  };

  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="mt-2 border-t border-white/6 pb-6">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 w-full items-center gap-1.5 px-5 text-[0.8125rem] font-medium text-ink-500 outline-none active:bg-white/5"
      >
        <Chevron className="h-4 w-4 flex-none" />
        Dismissed
      </button>
      {open &&
        (items === null ? (
          <Pulse className="mx-5 h-10" />
        ) : items.length === 0 ? (
          <p className="px-5 text-[0.8125rem] text-ink-500">
            Nothing dismissed lately.
          </p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="flex min-h-11 items-center gap-2 pr-2 pl-5"
            >
              <span className="min-w-0 flex-1 truncate text-[0.9375rem] text-ink-400">
                {item.topic}
              </span>
              <button
                type="button"
                aria-label={`Reopen thread ${item.topic}`}
                disabled={restoring.has(item.id)}
                onClick={() => restore(item.id)}
                className={`${PHONE_ICON_BTN} text-ink-500`}
              >
                {restoring.has(item.id) ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
              </button>
            </div>
          ))
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// thread timeline
// ---------------------------------------------------------------------------

function ThreadScreen({
  openId,
  threads,
  detail,
  detailLoading,
  today,
  promoting,
  onPromote,
  onDismiss,
  onBack,
}: ThreadsPhoneProps) {
  const [sheet, setSheet] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const context = useThreadContext(openId);
  const listed = threads.find((t) => t.id === openId);
  const ready =
    detail && detail.id === openId && !detailLoading ? detail : null;

  const rows = useMemo(
    () =>
      ready ? flattenTimeline(buildTimeline(ready.mentions), expanded) : [],
    [ready, expanded],
  );
  const voiceSet = useMemo(
    () => new Set(context?.voiceNoteIds ?? []),
    [context],
  );

  const first = ready?.mentions[0];
  const started = first
    ? new Date(first.mentionDate).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        ...(new Date(first.mentionDate).getFullYear() !==
        new Date().getFullYear()
          ? { year: "numeric" }
          : {}),
      })
    : null;
  const people = context?.people.map((p) => p.name).join(", ");
  const subtitle = ready
    ? [
        started ? `started ${started}` : null,
        people || null,
        context && context.tasks.length > 0
          ? `${context.tasks.length} open task${context.tasks.length === 1 ? "" : "s"}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;
  const promoted = ready?.status === "promoted";

  return (
    <>
      <PhoneNavRow
        backLabel="Threads"
        onBack={onBack}
        trailing={
          <button
            type="button"
            aria-label="Thread actions"
            disabled={!ready}
            onClick={() => setSheet(true)}
            className={PHONE_ICON_BTN}
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        }
      />
      <PhoneTitle
        title={ready?.topic ?? listed?.topic ?? "Thread"}
        subtitle={subtitle}
      />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-24">
        {!ready ? (
          <div className="flex flex-col gap-3" aria-hidden>
            <Pulse className="h-16 w-full" />
            <Pulse className="h-16 w-full" />
            <Pulse className="h-16 w-full" />
          </div>
        ) : (
          <ol>
            {rows.map((row, i) => {
              const last = i === rows.length - 1;
              const isGroup = row.type === "group";
              const newest = row.type === "mention" && row.newest;
              return (
                <li
                  key={row.type === "group" ? row.key : row.mention.id}
                  className="flex gap-3"
                >
                  <span
                    className="relative flex w-3 flex-none justify-center"
                    aria-hidden
                  >
                    {!last && (
                      <span className="absolute top-4 -bottom-0 w-[1.5px] bg-white/10" />
                    )}
                    <span
                      className={`relative mt-[1.05rem] h-2.5 w-2.5 flex-none rounded-full border-[1.5px] ${
                        newest
                          ? "border-sage bg-sage shadow-[0_0_0_3px_rgba(156,197,172,0.18)]"
                          : isGroup
                            ? "border-white/25 bg-canvas"
                            : "border-steel bg-canvas"
                      }`}
                    />
                  </span>
                  <div className={`min-w-0 flex-1 ${last ? "" : "pb-3"}`}>
                    {row.type === "group" ? (
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded((prev) => new Set(prev).add(row.key))
                        }
                        className="flex min-h-11 w-full items-center rounded-xl border border-dashed border-white/10 px-3.5 text-left text-[0.875rem] text-ink-500 active:bg-white/5"
                      >
                        …{row.mentions.length} quieter mention
                        {row.mentions.length === 1 ? "" : "s"} collapsed
                      </button>
                    ) : (
                      <TimelineCard
                        mention={row.mention}
                        kind={mentionKind(row.mention, voiceSet)}
                        today={today}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {sheet && ready && (
        <BottomSheet
          label="Thread actions"
          header={
            <p className="truncate px-5 pb-2 text-[0.8125rem] text-ink-500">
              {ready.topic}
            </p>
          }
          onClose={() => setSheet(false)}
        >
          <div className="pb-2">
            {promoted ? (
              <Link
                href={`/app/notes/${ready.promotedNoteId}`}
                className="flex min-h-12 items-center gap-3 px-5 text-[1rem] text-sage active:bg-white/5"
              >
                <Check className="h-5 w-5" />
                Promoted — open the note
                <ExternalLink className="ml-auto h-4 w-4 text-ink-500" />
              </Link>
            ) : (
              <button
                type="button"
                disabled={promoting}
                onClick={() => {
                  onPromote();
                  setSheet(false);
                }}
                className="flex min-h-12 w-full items-center gap-3 px-5 text-left text-[1rem] text-ink-100 active:bg-white/5 disabled:opacity-60"
              >
                {promoting ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <FilePlus className="h-5 w-5 text-ink-400" />
                )}
                Promote to note
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setSheet(false);
                onDismiss(ready.id);
              }}
              className="flex min-h-12 w-full items-center gap-3 px-5 text-left text-[1rem] text-area-coral active:bg-white/5"
            >
              <X className="h-5 w-5" />
              Dismiss thread
            </button>
          </div>
        </BottomSheet>
      )}
    </>
  );
}

function TimelineCard({
  mention,
  kind,
  today,
}: {
  mention: ThreadMentionItem;
  kind: "note" | "daily" | "voice";
  today: string | null;
}) {
  const { icon: Icon, label } = KIND[kind];
  return (
    <Link
      href={mentionHref(mention)}
      className="block rounded-xl border border-white/7 bg-panel px-3.5 py-2.5 outline-none active:bg-white/5 focus-visible:ring-1 focus-visible:ring-sage/60"
    >
      <span className="flex items-start gap-2">
        <Icon
          className={`mt-[0.2rem] h-4 w-4 flex-none ${mention.quiet ? "text-ink-600" : "text-ink-400"}`}
          aria-hidden
        />
        <span
          className={`min-w-0 flex-1 truncate text-[1rem] font-medium ${
            mention.quiet ? "text-ink-300" : "text-ink-100"
          }`}
        >
          {mention.noteTitle || "Untitled"}
        </span>
        <span className="flex-none pt-0.5 text-[0.75rem] text-ink-500 tabular-nums">
          {formatMentionDate(mention.mentionDate, today)}
        </span>
      </span>
      <span className="mt-1 line-clamp-2 block text-[0.875rem] leading-snug text-ink-400">
        <span className="text-ink-500">{label}</span>
        {mention.snippet ? ` · ${mention.snippet}` : ""}
      </span>
    </Link>
  );
}
