"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  FilePlus,
  GitCommitVertical,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";

import {
  dismissThreadAction,
  getAiSettingsAction,
  getThreadAction,
  listThreadsAction,
  promoteThreadAction,
  scanThreadsAction,
  type ThreadDetailResult,
  type ThreadListItem,
  type ThreadMentionItem,
} from "@/app/app/ai/actions";
import { localDateString } from "@/lib/dates";

/**
 * Threads page (design Turn 14b): the app notices when a topic keeps
 * appearing across notes and quietly assembles a chronological thread —
 * every mention, in context, without tagging anything. Left column lists the
 * detected threads; the main panel renders the selected one's timeline.
 *
 * All data loads client-side. On mount a non-forced scan runs in the
 * background (it self-throttles server-side to once per 6h) and the list is
 * refreshed if it turned up anything new.
 */

// ---------------------------------------------------------------------------
// formatting helpers
// ---------------------------------------------------------------------------

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** "7 mentions over 8 weeks" (or just "7 mentions" for a same-week thread). */
function mentionSpanLabel(
  count: number,
  firstMentionAt: string | null,
  lastMentionAt: string | null,
): string {
  const noun = count === 1 ? "mention" : "mentions";
  if (!firstMentionAt || !lastMentionAt) return `${count} ${noun}`;
  const weeks = Math.max(
    1,
    Math.round(
      (new Date(lastMentionAt).getTime() - new Date(firstMentionAt).getTime()) /
        MS_PER_WEEK,
    ),
  );
  if (weeks <= 1) return `${count} ${noun}`;
  return `${count} ${noun} over ${weeks} weeks`;
}

/** "Today" for the local calendar day, else "May 12" (+ year if not current). */
function formatMentionDate(iso: string, todayStr: string | null): string {
  const d = new Date(iso);
  if (todayStr && localDateString(d) === todayStr) return "Today";
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("en-US", opts);
}

function sourceLabel(mention: ThreadMentionItem): string {
  return mention.noteDailyDate ? "daily note" : mention.noteTitle || "Untitled";
}

// ---------------------------------------------------------------------------
// timeline grouping — consecutive quiet mentions collapse into one row
// ---------------------------------------------------------------------------

type TimelineItem =
  | { kind: "mention"; mention: ThreadMentionItem; newest: boolean }
  | { kind: "group"; key: string; mentions: ThreadMentionItem[] };

/** Mentions arrive oldest-first; the last one is always shown (never
 * collapsed) so the timeline always ends on an explicit "newest" row. */
function buildTimeline(mentions: ThreadMentionItem[]): TimelineItem[] {
  if (mentions.length === 0) return [];
  const items: TimelineItem[] = [];
  const body = mentions.slice(0, -1);
  const newest = mentions[mentions.length - 1];
  let buffer: ThreadMentionItem[] = [];
  const flush = () => {
    if (buffer.length === 0) return;
    if (buffer.length === 1) {
      items.push({ kind: "mention", mention: buffer[0], newest: false });
    } else {
      items.push({ kind: "group", key: buffer[0].id, mentions: buffer });
    }
    buffer = [];
  };
  for (const m of body) {
    if (m.quiet) {
      buffer.push(m);
    } else {
      flush();
      items.push({ kind: "mention", mention: m, newest: false });
    }
  }
  flush();
  items.push({ kind: "mention", mention: newest, newest: true });
  return items;
}

type FlatRow =
  | { type: "mention"; mention: ThreadMentionItem; newest: boolean }
  | { type: "group"; key: string; mentions: ThreadMentionItem[] };

function flattenTimeline(
  items: TimelineItem[],
  expanded: Set<string>,
): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const item of items) {
    if (item.kind === "mention") {
      rows.push({ type: "mention", mention: item.mention, newest: item.newest });
    } else if (expanded.has(item.key)) {
      for (const m of item.mentions) {
        rows.push({ type: "mention", mention: m, newest: false });
      }
    } else {
      rows.push({ type: "group", key: item.key, mentions: item.mentions });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// timeline rows
// ---------------------------------------------------------------------------

function Connector({ isLast }: { isLast: boolean }) {
  return !isLast ? <span className="w-[1.5px] flex-1 bg-white/9" /> : null;
}

function MentionRow({
  mention,
  newest,
  isLast,
  today,
  onOpen,
}: {
  mention: ThreadMentionItem;
  newest: boolean;
  isLast: boolean;
  today: string | null;
  onOpen: (mention: ThreadMentionItem) => void;
}) {
  const dotClass = newest
    ? "bg-sage shadow-[0_0_0_3px_rgba(156,197,172,0.18)]"
    : mention.quiet
      ? "bg-white/25"
      : "bg-steel";
  return (
    <button
      type="button"
      onClick={() => onOpen(mention)}
      className="flex w-full gap-3.5 text-left"
    >
      <span className="flex w-3.5 flex-none flex-col items-center">
        <span className={`mt-1 h-2 w-2 flex-none rounded-full ${dotClass}`} />
        <Connector isLast={isLast} />
      </span>
      <span className={`min-w-0 flex-1 ${isLast ? "" : "pb-4"}`}>
        <span className="mb-0.5 flex items-center gap-2">
          <span
            className={`text-[0.6875rem] font-medium ${
              newest ? "text-sage" : "text-ink-400"
            }`}
          >
            {formatMentionDate(mention.mentionDate, today)}
          </span>
          <span className="text-[0.625rem] text-ink-700">
            {sourceLabel(mention)}
          </span>
        </span>
        <span
          className={`block text-[0.78125rem] leading-relaxed ${
            mention.quiet ? "text-ink-500" : "text-ink-300"
          }`}
        >
          {mention.snippet}
        </span>
      </span>
    </button>
  );
}

function CollapsedGroupRow({
  count,
  isLast,
  onExpand,
}: {
  count: number;
  isLast: boolean;
  onExpand: () => void;
}) {
  return (
    <div className="flex w-full gap-3.5 text-left">
      <span className="flex w-3.5 flex-none flex-col items-center">
        <span className="mt-1 h-2 w-2 flex-none rounded-full bg-white/25" />
        <Connector isLast={isLast} />
      </span>
      <button
        type="button"
        onClick={onExpand}
        className={`min-w-0 flex-1 text-left ${isLast ? "" : "pb-4"}`}
      >
        <span className="text-[0.75rem] text-ink-500 hover:text-ink-300">
          …{count} quieter mention{count === 1 ? "" : "s"} collapsed
        </span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// list pane rows
// ---------------------------------------------------------------------------

function ThreadListRow({
  thread,
  selected,
  onSelect,
}: {
  thread: ThreadListItem;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`block w-full rounded-[0.5625rem] border px-3 py-2.5 text-left ${
        selected
          ? "border-sage/40 bg-sage/10"
          : "border-transparent hover:bg-white/4"
      }`}
    >
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium text-ink-200">
          {thread.topic}
        </span>
        {thread.status === "promoted" && (
          <span className="flex flex-none items-center gap-1 rounded-md border border-sage/25 bg-sage/10 px-1.5 py-0.5 text-[0.5625rem] font-medium text-sage">
            <Check className="h-[0.5625rem] w-[0.5625rem]" />
            Promoted
          </span>
        )}
      </span>
      <span className="mt-0.5 block text-[0.6875rem] text-ink-600">
        {mentionSpanLabel(
          thread.mentionCount,
          thread.firstMentionAt,
          thread.lastMentionAt,
        )}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// skeletons
// ---------------------------------------------------------------------------

function PulseBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-[0.5625rem] bg-panel/90 ${className}`} />;
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 p-3">
      <PulseBlock className="h-[3.25rem] w-full" />
      <PulseBlock className="h-[3.25rem] w-full" />
      <PulseBlock className="h-[3.25rem] w-full" />
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="p-5">
      <PulseBlock className="mb-4 h-9 w-full" />
      <div className="flex flex-col gap-4">
        <PulseBlock className="h-12 w-full" />
        <PulseBlock className="h-12 w-full" />
        <PulseBlock className="h-12 w-full" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

export function ThreadsPageClient() {
  const router = useRouter();

  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    setToday(localDateString());
  }, []);

  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [threads, setThreads] = useState<ThreadListItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetailResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Initial load, plus a background (non-forced, self-throttled) scan.
  useEffect(() => {
    let cancelled = false;
    Promise.all([listThreadsAction(), getAiSettingsAction()])
      .then(([items, settings]) => {
        if (cancelled) return;
        setThreads(items);
        setAiConfigured(settings.aiConfigured);
      })
      .catch((err) => console.error("[threads] load failed:", err));

    scanThreadsAction()
      .then((outcome) => {
        if (cancelled || !outcome.scanned || outcome.threads === 0) return;
        return listThreadsAction().then((items) => {
          if (!cancelled) setThreads(items);
        });
      })
      .catch((err) => console.error("[threads] background scan failed:", err));

    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the selection valid as the list changes (initial auto-select, and
  // re-selection if the selected thread is dismissed out from under it).
  useEffect(() => {
    if (threads === null) return;
    setSelectedId((prev) => {
      if (prev && threads.some((t) => t.id === prev)) return prev;
      return threads[0]?.id ?? null;
    });
  }, [threads]);

  // Load the selected thread's timeline.
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setExpandedGroups(new Set());
    getThreadAction(selectedId)
      .then((result) => {
        if (cancelled) return;
        setDetail(result);
        setDetailLoading(false);
      })
      .catch((err) => {
        console.error("[threads] detail load failed:", err);
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const timeline = useMemo(
    () => (detail ? buildTimeline(detail.mentions) : []),
    [detail],
  );
  const flatRows = useMemo(
    () => flattenTimeline(timeline, expandedGroups),
    [timeline, expandedGroups],
  );

  const handleRefresh = async (force: boolean) => {
    setRefreshing(true);
    try {
      await scanThreadsAction(force);
      const items = await listThreadsAction();
      setThreads(items);
    } catch (err) {
      console.error("[threads] refresh failed:", err);
    } finally {
      setRefreshing(false);
    }
  };

  const handlePromote = async () => {
    if (!detail || detail.status === "promoted") return;
    setPromoting(true);
    try {
      const result = await promoteThreadAction(detail.id);
      if (!result) return;
      setDetail((prev) =>
        prev ? { ...prev, status: "promoted", promotedNoteId: result.noteId } : prev,
      );
      setThreads((prev) =>
        prev
          ? prev.map((t) =>
              t.id === detail.id
                ? { ...t, status: "promoted", promotedNoteId: result.noteId }
                : t,
            )
          : prev,
      );
      router.push(`/app/notes/${result.noteId}`);
    } catch (err) {
      console.error("[threads] promote failed:", err);
    } finally {
      setPromoting(false);
    }
  };

  const handleDismiss = (id: string) => {
    const prevThreads = threads;
    setThreads((prev) => (prev ? prev.filter((t) => t.id !== id) : prev));
    dismissThreadAction(id).catch((err) => {
      console.error("[threads] dismiss failed:", err);
      setThreads(prevThreads);
    });
  };

  const goToMention = (mention: ThreadMentionItem) => {
    if (mention.noteDailyDate) {
      router.push(`/app?d=${mention.noteDailyDate}`);
    } else {
      router.push(`/app/notes/${mention.noteId}`);
    }
  };

  const loadingShell = threads === null || aiConfigured === null;

  return (
    <div className="flex h-full min-h-0 flex-col md:pl-[5.75rem]">
      {/* Page header */}
      <div className="flex flex-none flex-wrap items-center gap-3 border-b border-white/7 p-4">
        <span className="text-[1.375rem] font-semibold leading-none text-ink-100">
          Threads
        </span>
        <span className="text-[0.78125rem] text-ink-600">
          topics you keep coming back to — assembled automatically
        </span>
        <button
          type="button"
          disabled={refreshing || loadingShell}
          onClick={() => void handleRefresh(true)}
          className="ml-auto flex flex-none items-center gap-1.5 rounded-lg border border-white/8 bg-white/5 px-3 py-[0.4375rem] text-[0.71875rem] font-medium text-ink-300 hover:bg-white/8 disabled:opacity-50"
        >
          <RefreshCw
            className={`h-[0.6875rem] w-[0.6875rem] text-ink-400 ${
              refreshing ? "animate-spin" : ""
            }`}
          />
          Refresh
        </button>
      </div>

      {loadingShell ? (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="w-full flex-none border-b border-white/7 md:w-[20rem] md:border-b-0 md:border-r">
            <ListSkeleton />
          </div>
          <div className="min-w-0 flex-1">
            <DetailSkeleton />
          </div>
        </div>
      ) : aiConfigured === false ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <GitCommitVertical className="h-9 w-9 text-ink-700" />
          <p className="text-[0.84375rem] font-medium text-ink-300">
            Thread detection needs an API key
          </p>
          <p className="max-w-sm text-[0.75rem] text-ink-600">
            Set ANTHROPIC_API_KEY to let the app notice topics that keep
            coming back across your notes.
          </p>
        </div>
      ) : threads && threads.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <GitCommitVertical className="h-9 w-9 text-ink-700" />
          <p className="text-[0.84375rem] font-medium text-ink-300">
            No threads yet
          </p>
          <p className="max-w-sm text-[0.75rem] text-ink-600">
            They appear when a topic shows up across several notes.
          </p>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void handleRefresh(true)}
            className="mt-2 flex items-center gap-1.5 rounded-lg bg-sage px-3 py-[0.4375rem] text-[0.71875rem] font-semibold text-sage-ink disabled:opacity-60"
          >
            {refreshing ? (
              <Loader2 className="h-3 w-3 animate-spin text-sage-ink" />
            ) : (
              <RefreshCw className="h-3 w-3 text-sage-ink" />
            )}
            Scan now
          </button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* List pane */}
          <div className="w-full flex-none border-b border-white/7 p-2 md:w-[20rem] md:overflow-y-auto md:border-b-0 md:border-r">
            <div className="flex flex-col gap-1">
              {threads?.map((t) => (
                <ThreadListRow
                  key={t.id}
                  thread={t}
                  selected={t.id === selectedId}
                  onSelect={() => setSelectedId(t.id)}
                />
              ))}
            </div>
          </div>

          {/* Detail / timeline pane */}
          <div className="min-w-0 flex-1 md:overflow-y-auto">
            {detailLoading || !detail ? (
              <DetailSkeleton />
            ) : (
              <>
                <div className="flex items-center gap-2.5 border-b border-white/7 px-4 py-3">
                  <GitCommitVertical className="h-[0.9375rem] w-[0.9375rem] flex-none text-steel" />
                  <span className="min-w-0 truncate text-[0.84375rem] font-semibold text-ink-100">
                    {detail.topic}
                  </span>
                  <span className="flex-none text-[0.6875rem] text-ink-600">
                    thread ·{" "}
                    {mentionSpanLabel(
                      detail.mentions.length,
                      detail.mentions[0]?.mentionDate ?? null,
                      detail.mentions[detail.mentions.length - 1]?.mentionDate ??
                        null,
                    )}
                  </span>
                  <span className="ml-auto flex flex-none items-center gap-1.5">
                    {detail.status === "promoted" ? (
                      <Link
                        href={`/app/notes/${detail.promotedNoteId}`}
                        className="flex items-center gap-1.5 rounded-lg border border-sage/25 bg-sage/10 px-2.5 py-[0.4375rem] text-[0.65625rem] font-medium text-sage"
                      >
                        <Check className="h-[0.6875rem] w-[0.6875rem]" />
                        Promoted
                      </Link>
                    ) : (
                      <button
                        type="button"
                        disabled={promoting}
                        onClick={() => void handlePromote()}
                        className="flex items-center gap-1.5 rounded-lg border border-white/8 bg-white/5 px-2.5 py-[0.4375rem] text-[0.65625rem] font-medium text-ink-300 hover:bg-white/8 disabled:opacity-60"
                      >
                        {promoting ? (
                          <Loader2 className="h-[0.6875rem] w-[0.6875rem] animate-spin" />
                        ) : (
                          <FilePlus className="h-[0.6875rem] w-[0.6875rem]" />
                        )}
                        Promote to note
                      </button>
                    )}
                    <button
                      type="button"
                      title="Dismiss thread"
                      aria-label="Dismiss thread"
                      onClick={() => handleDismiss(detail.id)}
                      className="flex h-[1.625rem] w-[1.625rem] flex-none items-center justify-center rounded-md text-ink-600 hover:bg-white/6 hover:text-ink-300"
                    >
                      <X className="h-[0.8125rem] w-[0.8125rem]" />
                    </button>
                  </span>
                </div>

                <div className="flex flex-col p-5">
                  {flatRows.map((row) =>
                    row.type === "group" ? (
                      <CollapsedGroupRow
                        key={row.key}
                        count={row.mentions.length}
                        isLast={row === flatRows[flatRows.length - 1]}
                        onExpand={() =>
                          setExpandedGroups((prev) => {
                            const next = new Set(prev);
                            next.add(row.key);
                            return next;
                          })
                        }
                      />
                    ) : (
                      <MentionRow
                        key={row.mention.id}
                        mention={row.mention}
                        newest={row.newest}
                        isLast={row === flatRows[flatRows.length - 1]}
                        today={today}
                        onOpen={goToMention}
                      />
                    ),
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
