"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Compass,
  FileText,
  FolderClock,
  GitMerge,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sprout,
  SquareCheck,
  Trash2,
} from "lucide-react";

import {
  MOBILE_HEADER_ACTION,
  MobilePageHeader,
} from "@/components/layout/MobilePageHeader";
import type { LucideIcon } from "lucide-react";

import {
  acceptSuggestionAction,
  dismissSuggestionAction,
  getLostFoundAction,
  listDismissedSuggestionsAction,
  listSuggestionsAction,
  reopenSuggestionAction,
  sweepAction,
  type DismissedSuggestionItem,
  type GardenerSuggestionItem,
  type LostFoundItems,
} from "@/app/app/gardener/actions";
import { relativeTime } from "@/lib/relative-time";

/**
 * Gardener page — "find what I forgot". The headline content is the live
 * lost & found report: stranded tasks, abandoned drafts, forgotten trash,
 * and folders gone quiet. Every row is read-only resurfacing — a way back
 * to the thing, never an archive/hide action. Below it, a quiet "Tidy"
 * section keeps the one remaining sweep suggestion (merge near-duplicates),
 * with a collapsed "Dismissed" disclosure so any dismissal can be undone.
 *
 * Page shell matches ThreadsPageClient (header bar + full-height body); the
 * body is a centered single column. All data loads client-side; on mount a
 * non-forced sweep runs in the background (self-throttled server-side to
 * once per 7 days) and the tidy list refreshes if it turned up anything new.
 */

// ---------------------------------------------------------------------------
// buttons
// ---------------------------------------------------------------------------

function AcceptButton({
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
      className="flex items-center gap-1.5 rounded-lg bg-sage px-3 py-[0.4375rem] text-[0.71875rem] font-semibold text-sage-ink hover:bg-sage/90 disabled:opacity-60"
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
// tidy suggestion card (merge_duplicate is the only kind left)
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

  return (
    <div className="rounded-3xl border border-white/8 bg-white/2 p-4">
      <div className="flex items-start gap-3">
        <GitMerge className="mt-0.5 h-4 w-4 flex-none text-steel" />
        <div className="min-w-0 flex-1">
          <p className="text-[0.8125rem] leading-snug text-ink-100">
            {suggestion.title}
          </p>
          {suggestion.detail && (
            <p className="mt-1 text-[0.71875rem] text-ink-600">
              {suggestion.detail}
            </p>
          )}

          {sideBySide && (
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
              label="Merge — keep newest"
              busy={busy}
              onClick={onAccept}
            />
            <GhostButton
              label="Show side by side"
              onClick={() => setSideBySide((v) => !v)}
            />
            <DismissButton
              label="They're different"
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
// lost & found — the primary content: the live "what did I forget?" report.
// Read-only: every row is just a way back to the thing (note, tasks page,
// trash, folder). Resurfacing, never archiving.
// ---------------------------------------------------------------------------

/** "3 weeks ago" for an ISO timestamp — coarse on purpose. */
function agoLabel(iso: string): string {
  return relativeTime(iso, "coarse");
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
    <div className="rounded-3xl border border-white/8 bg-white/2 p-4">
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
      {/* Shrinkable + truncate: detail embeds note titles that can be long. */}
      <span className="min-w-0 shrink truncate text-[0.6875rem] text-ink-600">
        {detail}
      </span>
    </Link>
  );
}

function lostFoundCount(report: LostFoundItems): number {
  return (
    report.strandedTasks.length +
    report.abandonedDrafts.length +
    report.agingTrash.length +
    report.staleFolders.length
  );
}

function LostFoundSection({ report }: { report: LostFoundItems | null }) {
  const empty = report !== null && lostFoundCount(report) === 0;

  return (
    <div>
      <div className="flex items-center gap-2 px-1">
        <Compass className="h-4 w-4 flex-none text-sage" />
        <span className="text-[0.9375rem] font-semibold text-ink-100">
          What did I forget?
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
            Nothing lost — no stranded tasks, no cold drafts, no quiet
            folders, nothing forgotten in trash.
          </p>
        ) : (
          <>
            {report.strandedTasks.length > 0 && (
              <LostFoundGroup
                Icon={SquareCheck}
                label={`Tasks with no date or plan · ${report.strandedTasks.length}`}
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
            {report.staleFolders.length > 0 && (
              <LostFoundGroup
                Icon={FolderClock}
                label={`Folders gone quiet · ${report.staleFolders.length}`}
              >
                {report.staleFolders.map((f) => (
                  <LostFoundRow
                    key={f.id}
                    href={`/app/notes?f=${f.id}`}
                    title={f.title}
                    detail={`${f.noteCount} note${f.noteCount === 1 ? "" : "s"} · last touched ${agoLabel(f.lastTouched)}`}
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
// dismissed disclosure — every dismissal is reversible
// ---------------------------------------------------------------------------

function DismissedDisclosure({
  refreshKey,
  onRestored,
}: {
  /** Bumped by the parent whenever a new dismissal lands, so an open
   * disclosure refetches instead of showing a stale list. */
  refreshKey: number;
  /** Called after a successful restore so the open list can refresh. */
  onRestored: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<DismissedSuggestionItem[] | null>(null);
  const [restoringIds, setRestoringIds] = useState<Set<string>>(new Set());

  // Lazy: nothing loads until the disclosure is open; refetches on new
  // dismissals (refreshKey) so freshly dismissed rows appear immediately.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listDismissedSuggestionsAction()
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((err) => console.error("[gardener] dismissed load failed:", err));
    return () => {
      cancelled = true;
    };
  }, [open, refreshKey]);

  const handleRestore = (id: string) => {
    setRestoringIds((prev) => new Set(prev).add(id));
    reopenSuggestionAction(id)
      .then((ok) => {
        if (ok) {
          setItems((prev) => (prev ? prev.filter((i) => i.id !== id) : prev));
          onRestored();
        }
      })
      .catch((err) => console.error("[gardener] restore failed:", err))
      .finally(() => {
        setRestoringIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      });
  };

  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className="mt-1 px-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[0.71875rem] font-medium text-ink-600 hover:text-ink-300"
      >
        <Chevron className="h-3 w-3 flex-none" />
        Dismissed
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-1">
          {items === null ? (
            <PulseBlock className="h-8 w-full" />
          ) : items.length === 0 ? (
            <p className="px-2 text-[0.71875rem] text-ink-600">
              Nothing dismissed lately.
            </p>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/4"
              >
                <span className="min-w-0 flex-1 truncate text-[0.78125rem] text-ink-400">
                  {item.title}
                </span>
                <button
                  type="button"
                  disabled={restoringIds.has(item.id)}
                  onClick={() => handleRestore(item.id)}
                  className="flex flex-none items-center gap-1 text-[0.6875rem] font-medium text-ink-600 hover:text-ink-300 disabled:opacity-60"
                >
                  {restoringIds.has(item.id) ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3 w-3" />
                  )}
                  Restore
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// skeleton
// ---------------------------------------------------------------------------

function PulseBlock({ className }: { className: string }) {
  return (
    <div className={`animate-pulse rounded-3xl bg-panel/90 ${className}`} />
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
  const [dismissedVersion, setDismissedVersion] = useState(0);

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

  const refreshSuggestions = () => {
    listSuggestionsAction()
      .then(setSuggestions)
      .catch((err) => console.error("[gardener] reload failed:", err));
  };

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

  const tidyLoading = suggestions === null;
  const tidyCount = suggestions?.length ?? 0;
  const foundCount = lostFound === null ? null : lostFoundCount(lostFound);

  return (
    <div className="flex h-full min-h-0 flex-col md:pl-[5.75rem]">
      <MobilePageHeader
        title="Garden"
        subtitle={
          foundCount === null
            ? "Checking what slipped through…"
            : foundCount === 0
              ? "Nothing forgotten"
              : `${foundCount} to revisit`
        }
        trailing={
          <button
            type="button"
            aria-label="Run garden sweep"
            disabled={refreshing || tidyLoading}
            onClick={() => void handleRefresh()}
            className={MOBILE_HEADER_ACTION}
          >
            <RefreshCw
              className={`h-[1.125rem] w-[1.125rem] ${refreshing ? "animate-spin" : ""}`}
            />
          </button>
        }
      />
      {/* Page header — the mission is resurfacing, not tidying. */}
      <div className="hidden flex-none flex-wrap items-center gap-3 border-b border-white/7 p-4 md:flex">
        <Sprout className="h-[1.125rem] w-[1.125rem] flex-none text-sage" />
        <span className="text-[1.375rem] font-semibold leading-none text-ink-100">
          Gardener
        </span>
        <span className="text-[0.78125rem] text-ink-600">
          {foundCount === null
            ? "checking what slipped through…"
            : foundCount === 0
              ? "nothing forgotten right now"
              : `${foundCount} forgotten thing${foundCount === 1 ? "" : "s"} to revisit`}
        </span>
        <button
          type="button"
          disabled={refreshing || tidyLoading}
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

      {/* Body — lost & found first (the headline), then the quiet Tidy tail */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 py-3 md:p-4">
        <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-3">
          <LostFoundSection report={lostFound} />

          {/* Tidy — the minor secondary section */}
          <div className="mt-6">
            <div className="flex items-center gap-2 px-1">
              <GitMerge className="h-3.5 w-3.5 flex-none text-ink-400" />
              <span className="text-[0.8125rem] font-semibold text-ink-300">
                Tidy
              </span>
              <span className="text-[0.71875rem] text-ink-600">
                {tidyLoading
                  ? "sweeping…"
                  : tidyCount === 0
                    ? "nothing to prune this week"
                    : `${tidyCount} small tidy-up${tidyCount === 1 ? "" : "s"}`}
              </span>
            </div>

            <div className="mt-3 flex flex-col gap-3">
              {tidyLoading ? (
                <PulseBlock className="h-24 w-full" />
              ) : tidyCount === 0 ? (
                <p className="px-1 text-[0.75rem] text-ink-600">
                  All tidy — the weekly sweep found no duplicate notes.
                </p>
              ) : (
                suggestions?.map((s) => (
                  <SuggestionCard
                    key={s.id}
                    suggestion={s}
                    busy={pendingIds.has(s.id)}
                    onAccept={() =>
                      runPending(s.id, () => acceptSuggestionAction(s.id))
                    }
                    onDismiss={() =>
                      runPending(s.id, async () => {
                        const ok = await dismissSuggestionAction(s.id);
                        if (ok) setDismissedVersion((v) => v + 1);
                        return ok;
                      })
                    }
                  />
                ))
              )}
            </div>

            <DismissedDisclosure
              refreshKey={dismissedVersion}
              onRestored={refreshSuggestions}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
