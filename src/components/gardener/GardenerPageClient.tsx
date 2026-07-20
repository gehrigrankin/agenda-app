"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Check,
  Compass,
  FileText,
  GitMerge,
  Link as LinkIcon,
  Loader2,
  Moon,
  RefreshCw,
  Sprout,
  SquareCheck,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  acceptSuggestionAction,
  dismissSuggestionAction,
  getLostFoundAction,
  listSuggestionsAction,
  sweepAction,
  type GardenerKind,
  type GardenerSuggestionItem,
  type LostFoundItems,
} from "@/app/app/gardener/actions";

/**
 * Gardener page (design 15c): a weekly sweep of the library that finds
 * near-duplicates, stale boards, and notes that quietly answer each other —
 * and proposes one small tidy-up at a time. Every suggestion shows its
 * evidence; nothing merges or archives without the user pressing a button.
 *
 * Page shell matches ThreadsPageClient (header bar + full-height body); the
 * body itself is a centered single column of suggestion cards, like the
 * mockup. All data loads client-side; on mount a non-forced sweep runs in
 * the background (self-throttled server-side to once per 7 days) and the
 * list refreshes if it turned up anything new.
 */

// ---------------------------------------------------------------------------
// per-kind presentation
// ---------------------------------------------------------------------------

const KIND_META: Record<
  GardenerKind,
  {
    Icon: LucideIcon;
    iconClass: string;
    acceptLabel: string;
    acceptVariant: "sage" | "neutral";
    dismissLabel: string;
  }
> = {
  merge_duplicate: {
    Icon: GitMerge,
    iconClass: "text-steel",
    acceptLabel: "Merge — keep newest",
    acceptVariant: "sage",
    dismissLabel: "They're different",
  },
  archive_board: {
    Icon: Moon,
    iconClass: "text-ink-400",
    acceptLabel: "Archive board",
    acceptVariant: "neutral",
    dismissLabel: "Keep it around",
  },
  link_notes: {
    Icon: LinkIcon,
    iconClass: "text-steel",
    acceptLabel: "Link them",
    acceptVariant: "sage",
    dismissLabel: "Skip",
  },
};

// ---------------------------------------------------------------------------
// buttons
// ---------------------------------------------------------------------------

function AcceptButton({
  variant,
  label,
  busy,
  onClick,
}: {
  variant: "sage" | "neutral";
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  const cls =
    variant === "sage"
      ? "bg-sage text-sage-ink hover:bg-sage/90"
      : "bg-white/10 text-ink-100 hover:bg-white/14";
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-[0.4375rem] text-[0.71875rem] font-semibold disabled:opacity-60 ${cls}`}
    >
      {busy ? (
        <Loader2 className="h-3 w-3 flex-none animate-spin" />
      ) : (
        <Check className="h-3 w-3 flex-none" />
      )}
      {label}
    </button>
  );
}

function GhostButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg border border-white/8 bg-white/5 px-3 py-[0.4375rem] text-[0.71875rem] font-medium text-ink-300 hover:bg-white/8"
    >
      {label}
    </button>
  );
}

function DismissButton({
  label,
  busy,
  onClick,
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="ml-auto flex-none text-[0.71875rem] font-medium text-ink-600 hover:text-ink-300 disabled:opacity-60"
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// suggestion card
// ---------------------------------------------------------------------------

function SuggestionCard({
  suggestion,
  busy,
  onAccept,
  onDismiss,
}: {
  suggestion: GardenerSuggestionItem;
  busy: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const [sideBySide, setSideBySide] = useState(false);
  const meta = KIND_META[suggestion.kind];

  return (
    <div className="rounded-[0.875rem] border border-white/8 bg-white/2 p-4">
      <div className="flex items-start gap-3">
        <meta.Icon className={`mt-0.5 h-4 w-4 flex-none ${meta.iconClass}`} />
        <div className="min-w-0 flex-1">
          <p className="text-[0.8125rem] leading-snug text-ink-100">
            {suggestion.title}
          </p>
          {suggestion.detail && (
            <p className="mt-1 text-[0.71875rem] text-ink-600">
              {suggestion.detail}
            </p>
          )}

          {sideBySide && suggestion.kind === "merge_duplicate" && (
            <div className="mt-2 flex flex-col gap-1 rounded-lg border border-white/6 bg-white/3 p-2">
              {suggestion.notes.map((n) => (
                <Link
                  key={n.id}
                  href={`/app/notes/${n.id}`}
                  className="truncate text-[0.71875rem] text-steel hover:underline"
                >
                  Open &quot;{n.title || "Untitled"}&quot;
                </Link>
              ))}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <AcceptButton
              variant={meta.acceptVariant}
              label={meta.acceptLabel}
              busy={busy}
              onClick={onAccept}
            />
            {suggestion.kind === "merge_duplicate" && (
              <GhostButton
                label="Show side by side"
                onClick={() => setSideBySide((v) => !v)}
              />
            )}
            <DismissButton
              label={meta.dismissLabel}
              busy={busy}
              onClick={onDismiss}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// lost & found — the live "what fell through the cracks?" report. Read-only:
// every row is just a way back to the thing (note, tasks page, trash).
// ---------------------------------------------------------------------------

/** "3 weeks ago" for an ISO timestamp — coarse on purpose. */
function agoLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

function LostFoundGroup({
  Icon,
  label,
  children,
}: {
  Icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[0.875rem] border border-white/8 bg-white/2 p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 flex-none text-steel" />
        <span className="text-[0.71875rem] font-semibold uppercase tracking-wide text-ink-400">
          {label}
        </span>
      </div>
      <div className="mt-2 flex flex-col gap-1">{children}</div>
    </div>
  );
}

function LostFoundRow({
  href,
  title,
  detail,
}: {
  href: string;
  title: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-baseline gap-2 rounded-lg px-2 py-1.5 hover:bg-white/4"
    >
      <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink-200 group-hover:text-ink-100">
        {title || "Untitled"}
      </span>
      <span className="flex-none text-[0.6875rem] text-ink-600">{detail}</span>
    </Link>
  );
}

function LostFoundSection({ report }: { report: LostFoundItems | null }) {
  const empty =
    report !== null &&
    report.strandedTasks.length === 0 &&
    report.abandonedDrafts.length === 0 &&
    report.agingTrash.length === 0;

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 px-1">
        <Compass className="h-4 w-4 flex-none text-sage" />
        <span className="text-[0.9375rem] font-semibold text-ink-100">
          Lost &amp; found
        </span>
        <span className="text-[0.71875rem] text-ink-600">
          things that slipped through the cracks
        </span>
      </div>

      <div className="mt-3 flex flex-col gap-3">
        {report === null ? (
          <PulseBlock className="h-20 w-full" />
        ) : empty ? (
          <p className="px-1 text-[0.75rem] text-ink-600">
            Nothing lost — no stranded tasks, no cold drafts, nothing
            forgotten in trash.
          </p>
        ) : (
          <>
            {report.strandedTasks.length > 0 && (
              <LostFoundGroup
                Icon={SquareCheck}
                label={`Tasks nothing will resurface · ${report.strandedTasks.length}`}
              >
                {report.strandedTasks.map((t) => (
                  <LostFoundRow
                    key={t.id}
                    href={t.noteId ? `/app/notes/${t.noteId}` : "/app/tasks"}
                    title={t.title}
                    detail={
                      t.noteTitle
                        ? `in "${t.noteTitle}" · ${agoLabel(t.createdAt)}`
                        : `no note · ${agoLabel(t.createdAt)}`
                    }
                  />
                ))}
              </LostFoundGroup>
            )}
            {report.abandonedDrafts.length > 0 && (
              <LostFoundGroup
                Icon={FileText}
                label={`Drafts gone cold · ${report.abandonedDrafts.length}`}
              >
                {report.abandonedDrafts.map((n) => (
                  <LostFoundRow
                    key={n.id}
                    href={`/app/notes/${n.id}`}
                    title={n.title}
                    detail={`${n.chars === 0 ? "empty" : "barely started"} · ${agoLabel(n.updatedAt)}`}
                  />
                ))}
              </LostFoundGroup>
            )}
            {report.agingTrash.length > 0 && (
              <LostFoundGroup
                Icon={Trash2}
                label={`Forgotten in trash · ${report.agingTrash.length}`}
              >
                {report.agingTrash.map((n) => (
                  <LostFoundRow
                    key={n.id}
                    href="/app/trash"
                    title={n.title}
                    detail={`trashed ${agoLabel(n.deletedAt)}`}
                  />
                ))}
              </LostFoundGroup>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// skeleton + empty state
// ---------------------------------------------------------------------------

function PulseBlock({ className }: { className: string }) {
  return (
    <div className={`animate-pulse rounded-[0.875rem] bg-panel/90 ${className}`} />
  );
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

export function GardenerPageClient() {
  const [suggestions, setSuggestions] = useState<GardenerSuggestionItem[] | null>(
    null,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [lostFound, setLostFound] = useState<LostFoundItems | null>(null);

  // Initial load, plus a background (non-forced, self-throttled) sweep.
  useEffect(() => {
    let cancelled = false;
    listSuggestionsAction()
      .then((items) => {
        if (!cancelled) setSuggestions(items);
      })
      .catch((err) => console.error("[gardener] load failed:", err));

    getLostFoundAction()
      .then((report) => {
        if (!cancelled) setLostFound(report);
      })
      .catch((err) => console.error("[gardener] lost & found failed:", err));

    sweepAction()
      .then((outcome) => {
        if (cancelled || !outcome.scanned || outcome.created === 0) return;
        return listSuggestionsAction().then((items) => {
          if (!cancelled) setSuggestions(items);
        });
      })
      .catch((err) => console.error("[gardener] background sweep failed:", err));

    return () => {
      cancelled = true;
    };
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await sweepAction(true);
      const items = await listSuggestionsAction();
      setSuggestions(items);
    } catch (err) {
      console.error("[gardener] refresh failed:", err);
    } finally {
      setRefreshing(false);
    }
  };

  const runPending = (id: string, fn: () => Promise<boolean>) => {
    setPendingIds((prev) => new Set(prev).add(id));
    fn()
      .then((ok) => {
        if (ok) {
          setSuggestions((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
        }
      })
      .catch((err) => console.error("[gardener] action failed:", err))
      .finally(() => {
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      });
  };

  const loading = suggestions === null;
  const count = suggestions?.length ?? 0;
  // Rough "2 min of tidying" estimate — not a real timer, just a friendly
  // sense of scale matching the mockup's copy.
  const estMinutes = count === 0 ? 0 : Math.max(1, Math.round(count * 0.67));

  return (
    <div className="flex h-full min-h-0 flex-col md:pl-[5.75rem]">
      {/* Page header */}
      <div className="flex flex-none flex-wrap items-center gap-3 border-b border-white/7 p-4">
        <Sprout className="h-[1.125rem] w-[1.125rem] flex-none text-sage" />
        <span className="text-[1.375rem] font-semibold leading-none text-ink-100">
          Gardener
        </span>
        <span className="text-[0.78125rem] text-ink-600">
          {loading
            ? "checking your library…"
            : count === 0
              ? "nothing to prune this week"
              : `${count} suggestion${count === 1 ? "" : "s"} this week · ${estMinutes} min of tidying`}
        </span>
        <button
          type="button"
          disabled={refreshing || loading}
          onClick={() => void handleRefresh()}
          className="ml-auto flex flex-none items-center gap-1.5 rounded-lg border border-white/8 bg-white/5 px-3 py-[0.4375rem] text-[0.71875rem] font-medium text-ink-300 hover:bg-white/8 disabled:opacity-50"
        >
          <RefreshCw
            className={`h-[0.6875rem] w-[0.6875rem] text-ink-400 ${
              refreshing ? "animate-spin" : ""
            }`}
          />
          Run sweep
        </button>
      </div>

      {/* Body — centered single column of suggestion cards */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-3">
          {loading ? (
            <>
              <PulseBlock className="h-24 w-full" />
              <PulseBlock className="h-24 w-full" />
              <PulseBlock className="h-24 w-full" />
            </>
          ) : count === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <Sprout className="h-9 w-9 text-ink-700" />
              <p className="text-[0.84375rem] font-medium text-ink-300">
                All tidy — nothing to prune
              </p>
              <p className="max-w-sm text-[0.75rem] text-ink-600">
                Gardener sweeps your library weekly and only speaks up when it
                finds a duplicate, a stale board, or notes that answer each
                other.
              </p>
              <button
                type="button"
                disabled={refreshing}
                onClick={() => void handleRefresh()}
                className="mt-2 flex items-center gap-1.5 rounded-lg bg-sage px-3 py-[0.4375rem] text-[0.71875rem] font-semibold text-sage-ink disabled:opacity-60"
              >
                {refreshing ? (
                  <Loader2 className="h-3 w-3 animate-spin text-sage-ink" />
                ) : (
                  <RefreshCw className="h-3 w-3 text-sage-ink" />
                )}
                Sweep now
              </button>
            </div>
          ) : (
            suggestions?.map((s) => (
              <SuggestionCard
                key={s.id}
                suggestion={s}
                busy={pendingIds.has(s.id)}
                onAccept={() => runPending(s.id, () => acceptSuggestionAction(s.id))}
                onDismiss={() => runPending(s.id, () => dismissSuggestionAction(s.id))}
              />
            ))
          )}

          <LostFoundSection report={lostFound} />
        </div>
      </div>
    </div>
  );
}
