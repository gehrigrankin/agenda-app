"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  FilePlus,
  GitBranch,
  GitCommitVertical,
  Link2,
  Loader2,
  Mic,
  NotebookPen,
  FileText,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  listDismissedThreadsAction,
  reopenThreadAction,
  type DismissedThreadItem,
  type ThreadDetailResult,
  type ThreadListItem,
  type ThreadMentionItem,
} from "@/app/app/ai/actions";
import { toggleTaskAction } from "@/app/app/actions";
import { getThreadContextAction } from "@/app/app/threads/actions";
import { PageLayout, SidebarToggles } from "@/components/layout/PageLayout";
import {
  SIDEBAR_FOCUS,
  SidebarIconButton,
  SidebarRow,
  SidebarSection,
} from "@/components/layout/sidebar";
import { TABLET_QUERY, useMediaQuery } from "@/lib/hooks/use-media-query";
import type { ThreadContext } from "@/server/thread-context";
import {
  dueLabel,
  flattenTimeline,
  buildTimeline,
  formatMentionDate,
  relativeTime,
  threadColorClass,
  type FlatRow,
} from "./thread-utils";

/**
 * Desktop/tablet (md+) Threads page — Notes Sidebars design §5d/§6d:
 * Sidebar 1 lists the threads, the content is the selected thread's vertical
 * timeline (date gutter · dot on a line · a card per mention), and Sidebar 2
 * on the RIGHT is the thread's Context (people, open tasks, suggested notes).
 *
 * Presentational: all thread data, selection and mutations live in
 * ThreadsPageClient and arrive as props; this tree only owns UI state (filter
 * field, Dismissed disclosure, expanded quiet runs, Context data).
 */

export interface ThreadsDesktopProps {
  loading: boolean;
  aiConfigured: boolean | null;
  threads: ThreadListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
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
}

const NO_KEY_HINT = "Set ANTHROPIC_API_KEY to scan for new threads";

export function ThreadsDesktop(props: ThreadsDesktopProps) {
  const {
    loading,
    aiConfigured,
    threads,
    selectedId,
    onSelect,
    refreshing,
    onRefresh,
  } = props;

  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const scanDisabled = refreshing || loading || aiConfigured === false;
  const scanLabel =
    aiConfigured === false ? NO_KEY_HINT : "Scan for new threads";

  const context = useThreadContext(selectedId);
  // On tablets Context is a slide-over opened from the header toggle, so it
  // starts closed there (docked and open on desktop).
  const tablet = useMediaQuery(TABLET_QUERY);

  return (
    <PageLayout
      pageKey="threads"
      sidebar1={{
        label: "Threads",
        defaultWidth: 20,
        minWidth: 15,
        maxWidth: 32,
        actions: (
          <>
            <SidebarIconButton
              icon={refreshing ? Loader2 : RefreshCw}
              label={scanLabel}
              disabled={scanDisabled}
              onClick={onRefresh}
              className={refreshing ? "[&_svg]:animate-spin" : undefined}
            />
            <SidebarIconButton
              icon={Search}
              label="Filter threads"
              pressed={filterOpen}
              active={filterOpen}
              onClick={() => {
                if (filterOpen) setFilter("");
                setFilterOpen(!filterOpen);
              }}
            />
          </>
        ),
        children: (
          <ThreadListPane
            {...props}
            filter={filter}
            setFilter={setFilter}
            filterOpen={filterOpen}
            closeFilter={() => {
              setFilter("");
              setFilterOpen(false);
            }}
            onSelect={onSelect}
          />
        ),
      }}
      sidebar2Position="right"
      sidebar2={{
        label: "Context",
        defaultOpen: !tablet,
        defaultWidth: 21,
        minWidth: 16,
        maxWidth: 32,
        children: (
          <ContextPane
            threadId={selectedId}
            topic={threads.find((t) => t.id === selectedId)?.topic ?? ""}
            context={context}
            today={props.today}
          />
        ),
      }}
    >
      <ThreadContent {...props} voiceNoteIds={context?.voiceNoteIds} />
    </PageLayout>
  );
}

// ---------------------------------------------------------------------------
// context data
// ---------------------------------------------------------------------------

export function useThreadContext(
  threadId: string | null,
): ThreadContext | null {
  const [state, setState] = useState<{
    id: string;
    ctx: ThreadContext;
  } | null>(null);
  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    getThreadContextAction(threadId)
      .then((ctx) => {
        if (!cancelled) setState({ id: threadId, ctx });
      })
      .catch((err) => console.error("[threads] context load failed:", err));
    return () => {
      cancelled = true;
    };
  }, [threadId]);
  // Never show another thread's context while this one loads.
  return state && state.id === threadId ? state.ctx : null;
}

// ---------------------------------------------------------------------------
// sidebar 1 — thread list
// ---------------------------------------------------------------------------

function ThreadListPane({
  loading,
  threads,
  selectedId,
  onSelect,
  filter,
  setFilter,
  filterOpen,
  closeFilter,
  dismissedVersion,
  onRestored,
}: ThreadsDesktopProps & {
  filter: string;
  setFilter: (v: string) => void;
  filterOpen: boolean;
  closeFilter: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  // Relative times need "now" on the client only (threads load client-side).
  const [now] = useState(() => Date.now());

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q
      ? threads.filter((t) => t.topic.toLowerCase().includes(q))
      : threads;
  }, [threads, filter]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const idx = visible.findIndex((t) => t.id === selectedId);
    const next = visible[idx + (e.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    onSelect(next.id);
    const buttons = listRef.current?.querySelectorAll("button");
    buttons?.[visible.indexOf(next)]?.focus();
  };

  return (
    <>
      {filterOpen && (
        <div className="flex-none border-b border-white/6 p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-ink-500" />
            <input
              type="text"
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") closeFilter();
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  listRef.current?.querySelector("button")?.focus();
                }
              }}
              placeholder="Filter threads"
              aria-label="Filter threads"
              className="h-8 w-full rounded-md border border-white/8 bg-white/4 pr-7 pl-8 text-[0.8125rem] text-ink-100 placeholder:text-ink-500 touch:h-11 focus-visible:outline-2 focus-visible:outline-sage/70"
            />
            {filter && (
              <button
                type="button"
                aria-label="Clear filter"
                onClick={() => setFilter("")}
                className="absolute top-1/2 right-1 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-ink-500 hover:text-ink-200"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
        {loading ? (
          <div className="flex flex-col gap-px p-2" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-[2.75rem] animate-pulse rounded-md bg-white/4"
              />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className="px-4 py-4 text-[0.8125rem] text-ink-500">
            {threads.length === 0
              ? "No threads yet."
              : `No threads match “${filter.trim()}”.`}
          </p>
        ) : (
          <div
            ref={listRef}
            role="group"
            aria-label="Threads"
            onKeyDown={onKeyDown}
          >
            {visible.map((t) => (
              <SidebarRow
                key={t.id}
                active={t.id === selectedId}
                onClick={() => onSelect(t.id)}
                iconNode={
                  <GitBranch
                    className={`h-4 w-4 flex-none ${threadColorClass(t.id)}`}
                  />
                }
                label={t.topic}
                sublabel={
                  t.status === "promoted"
                    ? `Promoted · ${t.mentionCount} ${t.mentionCount === 1 ? "mention" : "mentions"}`
                    : `${t.mentionCount} ${t.mentionCount === 1 ? "mention" : "mentions"}`
                }
                trailing={
                  <span className="flex-none self-start pt-1 text-[0.75rem] text-ink-500 tabular-nums">
                    {relativeTime(t.lastMentionAt, now)}
                  </span>
                }
              />
            ))}
          </div>
        )}
      </div>

      <DismissedSection refreshKey={dismissedVersion} onRestored={onRestored} />
    </>
  );
}

function DismissedSection({
  refreshKey,
  onRestored,
}: {
  refreshKey: number;
  onRestored: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<DismissedThreadItem[] | null>(null);
  const [restoring, setRestoring] = useState<Set<string>>(new Set());

  // Lazy: nothing loads until open; refetch when a dismissal lands.
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

  return (
    <div className="flex max-h-[40%] flex-none flex-col border-t border-white/6">
      <SidebarSection
        label="Dismissed"
        count={open && items ? items.length : undefined}
        open={open}
        onOpenChange={setOpen}
        grow
      >
        {items === null ? (
          <div className="mx-3 mb-2 h-8 animate-pulse rounded-md bg-white/4" />
        ) : items.length === 0 ? (
          <p className="px-4 pb-3 text-[0.8125rem] text-ink-500">
            Nothing dismissed lately.
          </p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="flex min-h-[2.3rem] items-center gap-2 pr-2 pl-4 touch:min-h-[3.4rem]"
            >
              <span className="min-w-0 flex-1 truncate text-[0.875rem] text-ink-500">
                {item.topic}
              </span>
              <button
                type="button"
                aria-label={`Reopen thread ${item.topic}`}
                title="Reopen"
                disabled={restoring.has(item.id)}
                onClick={() => restore(item.id)}
                className={`flex h-7 w-7 flex-none items-center justify-center rounded-md text-ink-500 hover:bg-white/6 hover:text-ink-200 disabled:opacity-50 touch:h-11 touch:w-11 ${SIDEBAR_FOCUS}`}
              >
                {restoring.has(item.id) ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          ))
        )}
      </SidebarSection>
    </div>
  );
}

// ---------------------------------------------------------------------------
// content — header + timeline
// ---------------------------------------------------------------------------

function ThreadContent({
  loading,
  aiConfigured,
  threads,
  detail,
  detailLoading,
  today,
  refreshing,
  onRefresh,
  promoting,
  onPromote,
  onDismiss,
  voiceNoteIds,
}: ThreadsDesktopProps & { voiceNoteIds: string[] | undefined }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  // A different thread starts with its quiet runs collapsed again.
  const detailId = detail?.id;
  useEffect(() => setExpanded(new Set()), [detailId]);

  const rows = useMemo(
    () =>
      detail ? flattenTimeline(buildTimeline(detail.mentions), expanded) : [],
    [detail, expanded],
  );
  const voiceSet = useMemo(() => new Set(voiceNoteIds ?? []), [voiceNoteIds]);

  const copyLink = async () => {
    if (!detail) return;
    try {
      const url = `${window.location.origin}/app/threads?t=${detail.id}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (err) {
      console.error("[threads] copy link failed:", err);
    }
  };

  const first = detail?.mentions[0]?.mentionDate ?? null;
  const subline = detail
    ? [
        first ? `started ${formatMentionDate(first, today)}` : null,
        `${detail.mentions.length} ${detail.mentions.length === 1 ? "mention" : "mentions"}`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  const showNotice = !loading && aiConfigured === false && threads.length > 0;
  const empty = !loading && threads.length === 0;

  return (
    <>
      <header className="flex h-[3.25rem] flex-none items-center gap-2 border-b border-white/6 pr-2 pl-4 touch:h-[3.75rem]">
        <SidebarToggles />
        <div className="min-w-0 flex-1">
          {detail ? (
            <>
              <h1 className="truncate text-[1.125rem] leading-tight font-semibold text-ink-100">
                {detail.topic}
              </h1>
              <p className="truncate text-[0.75rem] leading-tight text-ink-500">
                {subline}
              </p>
            </>
          ) : (
            <h1 className="truncate text-[1.125rem] leading-tight font-semibold text-ink-100">
              Threads
            </h1>
          )}
        </div>
        {detail && (
          <div className="flex flex-none items-center gap-0.5">
            {detail.status === "promoted" ? (
              <Link
                href={`/app/notes/${detail.promotedNoteId}`}
                className={`mr-1 flex h-7 items-center gap-1.5 rounded-md border border-sage/25 bg-sage/10 px-2.5 text-[0.75rem] font-medium text-sage touch:h-11 ${SIDEBAR_FOCUS}`}
              >
                <Check className="h-3.5 w-3.5" />
                Promoted
              </Link>
            ) : (
              <button
                type="button"
                disabled={promoting}
                onClick={onPromote}
                className={`mr-1 flex h-7 items-center gap-1.5 rounded-md border border-white/8 bg-white/5 px-2.5 text-[0.75rem] font-medium text-ink-300 hover:bg-white/8 disabled:opacity-60 touch:h-11 ${SIDEBAR_FOCUS}`}
              >
                {promoting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FilePlus className="h-3.5 w-3.5" />
                )}
                Promote to note
              </button>
            )}
            <SidebarIconButton
              icon={X}
              label="Dismiss thread"
              onClick={() => onDismiss(detail.id)}
            />
            <SidebarIconButton
              icon={copied ? Check : Link2}
              label={copied ? "Link copied" : "Copy link to thread"}
              active={copied}
              onClick={() => void copyLink()}
            />
          </div>
        )}
        <SidebarToggles side="right" />
      </header>

      {showNotice && (
        <div className="flex flex-none items-center gap-2 border-b border-white/6 bg-white/3 px-4 py-2">
          <GitCommitVertical className="h-3.5 w-3.5 flex-none text-ink-500" />
          <p className="text-[0.75rem] text-ink-500">
            New scans need ANTHROPIC_API_KEY — showing threads already found.
          </p>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
        {loading || (detailLoading && !detail) ? (
          <TimelineSkeleton />
        ) : empty ? (
          <EmptyState
            aiConfigured={aiConfigured}
            refreshing={refreshing}
            onRefresh={onRefresh}
          />
        ) : !detail ? (
          detailLoading ? (
            <TimelineSkeleton />
          ) : (
            <p className="p-6 text-[0.8125rem] text-ink-500">
              Pick a thread to see its timeline.
            </p>
          )
        ) : (
          <ol
            className={`mx-auto flex max-w-[60rem] flex-col px-5 py-5 ${
              detailLoading ? "opacity-60" : ""
            }`}
          >
            {rows.map((row, i) => (
              <TimelineRow
                key={row.type === "group" ? row.key : row.mention.id}
                row={row}
                last={i === rows.length - 1}
                today={today}
                voiceSet={voiceSet}
                onExpand={(key) =>
                  setExpanded((prev) => new Set(prev).add(key))
                }
              />
            ))}
          </ol>
        )}
      </div>
    </>
  );
}

function EmptyState({
  aiConfigured,
  refreshing,
  onRefresh,
}: {
  aiConfigured: boolean | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const noKey = aiConfigured === false;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <GitCommitVertical className="h-9 w-9 text-ink-700" />
      <p className="text-[0.9rem] font-medium text-ink-300">
        {noKey ? "Thread detection needs an API key" : "No threads yet"}
      </p>
      <p className="max-w-sm text-[0.8125rem] text-ink-500">
        {noKey
          ? "Set ANTHROPIC_API_KEY to let the app notice topics that keep coming back across your notes."
          : "They appear when a topic shows up across several notes."}
      </p>
      {!noKey && (
        <button
          type="button"
          disabled={refreshing}
          onClick={onRefresh}
          className={`mt-2 flex h-8 items-center gap-1.5 rounded-lg bg-sage px-3.5 text-[0.8125rem] font-semibold text-sage-ink disabled:opacity-60 touch:h-11 ${SIDEBAR_FOCUS}`}
        >
          {refreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Scan now
        </button>
      )}
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div
      className="mx-auto flex max-w-[60rem] flex-col gap-3 px-5 py-5"
      aria-hidden
    >
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-[4.5rem] animate-pulse rounded-lg bg-panel/90"
        />
      ))}
    </div>
  );
}

export const KIND: Record<
  "note" | "daily" | "voice",
  { icon: LucideIcon; label: string }
> = {
  note: { icon: FileText, label: "Note" },
  daily: { icon: NotebookPen, label: "Daily note" },
  voice: { icon: Mic, label: "Voice memo" },
};

export function mentionKind(m: ThreadMentionItem, voiceSet: Set<string>) {
  return m.noteDailyDate ? "daily" : voiceSet.has(m.noteId) ? "voice" : "note";
}

export function mentionHref(m: ThreadMentionItem): string {
  return m.noteDailyDate
    ? `/app?d=${m.noteDailyDate}`
    : `/app/notes/${m.noteId}`;
}

/** One timeline entry: date gutter | dot on the vertical line | card. */
function TimelineRow({
  row,
  last,
  today,
  voiceSet,
  onExpand,
}: {
  row: FlatRow;
  last: boolean;
  today: string | null;
  voiceSet: Set<string>;
  onExpand: (key: string) => void;
}) {
  const isGroup = row.type === "group";
  const mention = row.type === "mention" ? row.mention : row.mentions[0];
  const newest = row.type === "mention" && row.newest;
  const quiet = row.type === "mention" && row.mention.quiet;

  return (
    <li className="flex gap-3">
      <span
        className={`w-[4.25rem] flex-none pt-[0.8rem] text-right text-[0.75rem] tabular-nums ${
          newest ? "text-sage" : "text-ink-500"
        }`}
      >
        {isGroup ? "" : formatMentionDate(mention.mentionDate, today)}
      </span>
      <span className="relative flex w-3 flex-none justify-center" aria-hidden>
        {!last && (
          <span className="absolute top-[1.1rem] -bottom-0 w-[1.5px] bg-white/10" />
        )}
        <span
          className={`relative mt-[0.95rem] h-2.5 w-2.5 flex-none rounded-full border-[1.5px] ${
            newest
              ? "border-sage bg-sage shadow-[0_0_0_3px_rgba(156,197,172,0.18)]"
              : isGroup || quiet
                ? "border-white/25 bg-canvas"
                : "border-steel bg-canvas"
          }`}
        />
      </span>
      <div className={`min-w-0 flex-1 ${last ? "" : "pb-2.5"}`}>
        {row.type === "group" ? (
          <button
            type="button"
            onClick={() => onExpand(row.key)}
            className={`flex min-h-[2.25rem] w-full items-center rounded-lg border border-dashed border-white/10 px-3.5 text-left text-[0.8125rem] text-ink-500 hover:border-white/20 hover:text-ink-300 touch:min-h-11 ${SIDEBAR_FOCUS}`}
          >
            …{row.mentions.length} quieter mention
            {row.mentions.length === 1 ? "" : "s"} collapsed
          </button>
        ) : (
          <MentionCard
            mention={row.mention}
            kind={mentionKind(row.mention, voiceSet)}
          />
        )}
      </div>
    </li>
  );
}

function MentionCard({
  mention,
  kind,
}: {
  mention: ThreadMentionItem;
  kind: "note" | "daily" | "voice";
}) {
  const { icon: Icon, label } = KIND[kind];
  return (
    <Link
      href={mentionHref(mention)}
      className={`block rounded-lg border border-white/7 bg-panel px-3.5 py-2.5 transition-colors hover:border-white/14 hover:bg-white/4 ${SIDEBAR_FOCUS}`}
    >
      <span className="flex items-center gap-2">
        <Icon
          className={`h-3.5 w-3.5 flex-none ${mention.quiet ? "text-ink-600" : "text-ink-400"}`}
          aria-hidden
        />
        <span
          className={`min-w-0 truncate text-[0.9375rem] font-medium ${
            mention.quiet ? "text-ink-300" : "text-ink-100"
          }`}
        >
          {mention.noteTitle || "Untitled"}
        </span>
      </span>
      <span className="mt-1 block truncate text-[0.8125rem] text-ink-400">
        <span className="text-ink-500">{label}</span>
        {mention.snippet ? ` · ${mention.snippet}` : ""}
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// sidebar 2 — Context
// ---------------------------------------------------------------------------

function ContextPane({
  threadId,
  topic,
  context,
  today,
}: {
  threadId: string | null;
  topic: string;
  context: ThreadContext | null;
  today: string | null;
}) {
  const [done, setDone] = useState<Record<string, boolean>>({});

  // Checked-off tasks belong to the thread they were checked in.
  useEffect(() => setDone({}), [threadId]);

  if (!threadId) {
    return (
      <p className="px-4 py-4 text-[0.8125rem] text-ink-500">
        Select a thread to see who and what it touches.
      </p>
    );
  }
  if (!context) {
    return (
      <div className="flex flex-col gap-2 p-3" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-8 animate-pulse rounded-md bg-white/4" />
        ))}
      </div>
    );
  }

  const toggle = (id: string, next: boolean) => {
    setDone((prev) => ({ ...prev, [id]: next }));
    toggleTaskAction(id, next).catch((err) => {
      console.error("[threads] toggle task failed:", err);
      setDone((prev) => ({ ...prev, [id]: !next }));
    });
  };
  const openCount = context.tasks.filter((t) => !done[t.id]).length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pb-4">
      <SidebarSection
        label="People"
        count={context.people.length || undefined}
        storageKey="threads.people"
      >
        {context.people.length === 0 ? (
          <Muted>No one named in this thread.</Muted>
        ) : (
          context.people.map((p) => (
            <div
              key={p.id}
              className="flex min-h-[2.3rem] items-center gap-2.5 pr-3 pl-4 touch:min-h-[3.4rem]"
            >
              <span
                aria-hidden
                className="flex h-[1.5rem] w-[1.5rem] flex-none items-center justify-center rounded-full bg-white/10 text-[0.6875rem] font-medium text-ink-300"
              >
                {p.name.trim().charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-[0.875rem] text-ink-200">
                {p.name}
              </span>
            </div>
          ))
        )}
      </SidebarSection>

      <SidebarSection
        label="Open tasks"
        count={context.tasks.length > 0 ? openCount : undefined}
        storageKey="threads.tasks"
      >
        {context.tasks.length === 0 ? (
          <Muted>No open tasks in these notes.</Muted>
        ) : (
          context.tasks.map((t) => {
            const checked = !!done[t.id];
            const due = dueLabel(t.dueAt, today);
            return (
              <div
                key={t.id}
                className="flex min-h-[2.3rem] items-center gap-1 pr-3 pl-2 hover:bg-white/4 touch:min-h-[3.4rem]"
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  aria-label={`${checked ? "Reopen" : "Complete"} ${t.title}`}
                  onClick={() => toggle(t.id, !checked)}
                  className={`flex h-7 w-7 flex-none items-center justify-center rounded-md touch:h-11 touch:w-11 ${SIDEBAR_FOCUS}`}
                >
                  <span
                    className={`flex h-[1.0625rem] w-[1.0625rem] items-center justify-center rounded-[0.3rem] border ${
                      checked
                        ? "border-sage bg-sage text-sage-ink"
                        : "border-white/25"
                    }`}
                  >
                    {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                </button>
                <span
                  className={`min-w-0 flex-1 truncate text-[0.875rem] ${
                    checked ? "text-ink-500 line-through" : "text-ink-200"
                  }`}
                >
                  {t.title}
                </span>
                {due.text && (
                  <span
                    className={`flex-none text-[0.75rem] tabular-nums ${
                      due.overdue ? "text-area-coral" : "text-ink-500"
                    }`}
                  >
                    {due.text}
                  </span>
                )}
              </div>
            );
          })
        )}
      </SidebarSection>

      <SidebarSection
        label="Suggested"
        count={context.suggested.length || undefined}
        storageKey="threads.suggested"
      >
        {context.suggested.length === 0 ? (
          <Muted>Nothing else mentions “{topic}”.</Muted>
        ) : (
          <div className="flex flex-col gap-2 px-3 pb-1">
            {context.suggested.map((s) => (
              <Link
                key={s.noteId}
                href={
                  s.dailyDate
                    ? `/app?d=${s.dailyDate}`
                    : `/app/notes/${s.noteId}`
                }
                className={`block rounded-lg border border-dashed border-white/12 px-3 py-2.5 text-[0.8125rem] leading-snug text-ink-400 hover:border-white/24 hover:text-ink-200 ${SIDEBAR_FOCUS}`}
              >
                “{s.title || "Untitled"}” mentions {topic} —{" "}
                <span className="text-sage">open</span>
              </Link>
            ))}
          </div>
        )}
      </SidebarSection>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="px-4 pb-2 text-[0.8125rem] text-ink-500">{children}</p>;
}
