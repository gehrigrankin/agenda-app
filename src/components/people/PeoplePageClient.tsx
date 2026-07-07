"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Loader2,
  RefreshCw,
  Users,
} from "lucide-react";

import {
  getPeopleAiSettingsAction,
  getPersonAction,
  listPeopleAction,
  scanPeopleAction,
  toggleCommitmentAction,
  type PersonCommitmentItem,
  type PersonDetailResult,
  type PersonListItem,
  type PersonMentionItem,
} from "@/app/app/people/actions";
import { PersonHoverCard } from "@/components/people/PersonHoverCard";
import { localDateString } from "@/lib/dates";

/**
 * People page (design 15a): every person you mention gets a page the app
 * maintains for you — when you last talked, what you owe them, what they owe
 * you, every mention in context. The user never creates or files these
 * themselves. Left column lists detected people; the main panel renders the
 * selected person's owe/owed columns plus their recent mentions.
 *
 * All data loads client-side. On mount a non-forced scan runs in the
 * background (it self-throttles server-side to once per 6h) and the list is
 * refreshed if it turned up anything new.
 */

// ---------------------------------------------------------------------------
// formatting helpers
// ---------------------------------------------------------------------------

/** "Today" for the local calendar day, else "Tue, Jul 8" (+ year if not current). */
function formatTalkedDate(iso: string, todayStr: string | null): string {
  const d = new Date(iso);
  if (todayStr && localDateString(d) === todayStr) return "Today";
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
  };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("en-US", opts);
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

// ---------------------------------------------------------------------------
// list pane rows
// ---------------------------------------------------------------------------

function PersonListRow({
  person,
  selected,
  onSelect,
  today,
}: {
  person: PersonListItem;
  selected: boolean;
  onSelect: () => void;
  today: string | null;
}) {
  return (
    <PersonHoverCard personId={person.id} className="block w-full">
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full items-center gap-2.5 rounded-[0.625rem] border px-3 py-2.5 text-left ${
          selected ? "border-sage/40 bg-sage/10" : "border-transparent hover:bg-white/4"
        }`}
      >
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-white/8 text-[0.75rem] font-semibold text-ink-200">
          {initial(person.name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.8125rem] font-medium text-ink-200">
            {person.name}
          </span>
          <span className="block truncate text-[0.6875rem] text-ink-600">
            {person.mentionCount} mention{person.mentionCount === 1 ? "" : "s"}
            {person.lastMentionedAt &&
              ` · last talked ${formatTalkedDate(person.lastMentionedAt, today)}`}
          </span>
        </span>
      </button>
    </PersonHoverCard>
  );
}

// ---------------------------------------------------------------------------
// detail pane — owe / owed columns
// ---------------------------------------------------------------------------

function CommitmentRow({
  commitment,
  onToggle,
}: {
  commitment: PersonCommitmentItem;
  onToggle: (id: string, resolved: boolean) => void;
}) {
  const resolved = Boolean(commitment.resolvedAt);
  return (
    <div
      className={`flex items-start gap-2.5 rounded-lg border px-2.5 py-2 ${
        resolved ? "border-white/6 opacity-50" : "border-white/8 bg-white/[0.03]"
      }`}
    >
      <button
        type="button"
        aria-label={resolved ? "Mark unresolved" : "Mark resolved"}
        onClick={() => onToggle(commitment.id, !resolved)}
        className={`mt-0.5 flex h-[0.9375rem] w-[0.9375rem] flex-none items-center justify-center rounded-[0.25rem] border-[1.5px] ${
          resolved ? "border-sage bg-sage" : "border-white/25 hover:bg-white/10"
        }`}
      >
        {resolved && <Check className="h-2.5 w-2.5 text-sage-ink" />}
      </button>
      <div className="min-w-0 flex-1">
        <p
          className={`text-[0.78125rem] ${
            resolved ? "text-ink-600 line-through" : "text-ink-200"
          }`}
        >
          {commitment.text}
        </p>
        {commitment.contextLabel && (
          <p className="mt-0.5 text-[0.625rem] text-ink-600">
            {commitment.contextLabel}
          </p>
        )}
      </div>
    </div>
  );
}

function OweSection({
  title,
  icon: Icon,
  colorClass,
  items,
  onToggle,
}: {
  title: string;
  icon: typeof ArrowUpRight;
  colorClass: string;
  items: PersonCommitmentItem[];
  onToggle: (id: string, resolved: boolean) => void;
}) {
  return (
    <div className="mb-6 last:mb-0">
      <div
        className={`flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide ${colorClass}`}
      >
        <Icon className="h-3 w-3" />
        {title}
      </div>
      <div className="mt-2.5 flex flex-col gap-1.5">
        {items.length === 0 ? (
          <p className="text-[0.75rem] text-ink-600">Nothing here.</p>
        ) : (
          items.map((c) => (
            <CommitmentRow key={c.id} commitment={c} onToggle={onToggle} />
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// detail pane — recent mentions column
// ---------------------------------------------------------------------------

const VISIBLE_MENTIONS = 6;

function MentionLine({
  mention,
  today,
  onOpen,
}: {
  mention: PersonMentionItem;
  today: string | null;
  onOpen: (mention: PersonMentionItem) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(mention)}
      className="block w-full text-left"
    >
      <p className="text-[0.625rem] text-ink-600">
        {formatTalkedDate(mention.mentionDate, today)}
      </p>
      <p className="mt-0.5 text-[0.75rem] leading-relaxed text-ink-300">
        &ldquo;{mention.snippet}&rdquo;
      </p>
    </button>
  );
}

// ---------------------------------------------------------------------------
// skeletons
// ---------------------------------------------------------------------------

function PulseBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-[0.625rem] bg-panel/90 ${className}`} />;
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

export function PeoplePageClient() {
  const router = useRouter();

  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    setToday(localDateString());
  }, []);

  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [people, setPeople] = useState<PersonListItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PersonDetailResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showAllMentions, setShowAllMentions] = useState(false);

  // Initial load, plus a background (non-forced, self-throttled) scan.
  useEffect(() => {
    let cancelled = false;
    Promise.all([listPeopleAction(), getPeopleAiSettingsAction()])
      .then(([items, settings]) => {
        if (cancelled) return;
        setPeople(items);
        setAiConfigured(settings.aiConfigured);
      })
      .catch((err) => console.error("[people] load failed:", err));

    scanPeopleAction()
      .then((outcome) => {
        if (cancelled || !outcome.scanned || outcome.people === 0) return;
        return listPeopleAction().then((items) => {
          if (!cancelled) setPeople(items);
        });
      })
      .catch((err) => console.error("[people] background scan failed:", err));

    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the selection valid as the list changes (initial auto-select).
  useEffect(() => {
    if (people === null) return;
    setSelectedId((prev) => {
      if (prev && people.some((p) => p.id === prev)) return prev;
      return people[0]?.id ?? null;
    });
  }, [people]);

  // Load the selected person's page.
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setShowAllMentions(false);
    getPersonAction(selectedId)
      .then((result) => {
        if (cancelled) return;
        setDetail(result);
        setDetailLoading(false);
      })
      .catch((err) => {
        console.error("[people] detail load failed:", err);
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const handleRefresh = async (force: boolean) => {
    setRefreshing(true);
    try {
      await scanPeopleAction(force);
      const items = await listPeopleAction();
      setPeople(items);
    } catch (err) {
      console.error("[people] refresh failed:", err);
    } finally {
      setRefreshing(false);
    }
  };

  const handleToggleCommitment = (id: string, resolved: boolean) => {
    const prevDetail = detail;
    setDetail((prev) => {
      if (!prev) return prev;
      const patch = (c: PersonCommitmentItem) =>
        c.id === id
          ? { ...c, resolvedAt: resolved ? new Date().toISOString() : null }
          : c;
      return {
        ...prev,
        youOwe: prev.youOwe.map(patch),
        theyOwe: prev.theyOwe.map(patch),
      };
    });
    toggleCommitmentAction(id, resolved).catch((err) => {
      console.error("[people] toggle commitment failed:", err);
      setDetail(prevDetail);
    });
  };

  const goToMention = (mention: PersonMentionItem) => {
    if (mention.noteDailyDate) {
      router.push(`/app?d=${mention.noteDailyDate}`);
    } else {
      router.push(`/app/notes/${mention.noteId}`);
    }
  };

  const loadingShell = people === null || aiConfigured === null;
  const visibleMentions =
    detail && !showAllMentions ? detail.mentions.slice(0, VISIBLE_MENTIONS) : detail?.mentions ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col md:pl-[5.75rem]">
      {/* Page header */}
      <div className="flex flex-none flex-wrap items-center gap-3 border-b border-white/7 p-4">
        <span className="text-[1.375rem] font-semibold leading-none text-ink-100">
          People
        </span>
        <span className="text-[0.78125rem] text-ink-600">
          auto-maintained pages for everyone you mention
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
          <Users className="h-9 w-9 text-ink-700" />
          <p className="text-[0.84375rem] font-medium text-ink-300">
            People pages need an API key
          </p>
          <p className="max-w-sm text-[0.75rem] text-ink-600">
            Set ANTHROPIC_API_KEY to let the app notice who you mention and
            keep a page for them automatically.
          </p>
        </div>
      ) : people && people.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <Users className="h-9 w-9 text-ink-700" />
          <p className="text-[0.84375rem] font-medium text-ink-300">
            No people yet
          </p>
          <p className="max-w-sm text-[0.75rem] text-ink-600">
            Pages appear here as soon as you mention someone by name in a
            note.
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
              {people?.map((p) => (
                <PersonListRow
                  key={p.id}
                  person={p}
                  selected={p.id === selectedId}
                  onSelect={() => setSelectedId(p.id)}
                  today={today}
                />
              ))}
            </div>
          </div>

          {/* Detail pane */}
          <div className="min-w-0 flex-1 md:overflow-y-auto">
            {detailLoading || !detail ? (
              <DetailSkeleton />
            ) : (
              <>
                <div className="flex items-center gap-3 border-b border-white/7 px-4 py-3.5">
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-sage/15 text-[0.9375rem] font-semibold text-sage">
                    {initial(detail.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.9375rem] font-semibold text-ink-100">
                      {detail.name}
                    </p>
                    <p className="truncate text-[0.6875rem] text-ink-600">
                      auto-maintained · {detail.mentionCount} mention
                      {detail.mentionCount === 1 ? "" : "s"}
                      {detail.lastMentionedAt &&
                        ` · last talked ${formatTalkedDate(detail.lastMentionedAt, today)}`}
                    </p>
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
                  {/* Left: owe / owed */}
                  <div className="min-w-0 flex-1 p-5">
                    <OweSection
                      title={`YOU OWE ${detail.name.toUpperCase()}`}
                      icon={ArrowUpRight}
                      colorClass="text-[#D9938A]"
                      items={detail.youOwe}
                      onToggle={handleToggleCommitment}
                    />
                    <OweSection
                      title={`${detail.name.toUpperCase()} OWES YOU`}
                      icon={ArrowDownLeft}
                      colorClass="text-sage"
                      items={detail.theyOwe}
                      onToggle={handleToggleCommitment}
                    />
                  </div>

                  {/* Right: recent mentions */}
                  <div className="w-full flex-none border-t border-white/7 bg-bar p-4 lg:w-[280px] lg:overflow-y-auto lg:border-t-0 lg:border-l">
                    <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-600">
                      Recent mentions
                    </p>
                    <div className="mt-2.5 flex flex-col gap-3">
                      {visibleMentions.length === 0 ? (
                        <p className="text-[0.75rem] text-ink-600">
                          No mentions yet.
                        </p>
                      ) : (
                        visibleMentions.map((m) => (
                          <MentionLine
                            key={m.id}
                            mention={m}
                            today={today}
                            onOpen={goToMention}
                          />
                        ))
                      )}
                    </div>
                    {detail.mentions.length > VISIBLE_MENTIONS && (
                      <button
                        type="button"
                        onClick={() => setShowAllMentions((v) => !v)}
                        className="mt-3 text-[0.6875rem] font-medium text-steel hover:underline"
                      >
                        {showAllMentions
                          ? "Show fewer"
                          : `All ${detail.mentions.length} mentions →`}
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
