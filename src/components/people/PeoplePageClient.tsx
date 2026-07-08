"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Users,
  X,
} from "lucide-react";

import {
  addCommitmentAction,
  createPersonAction,
  deleteCommitmentAction,
  deletePersonAction,
  getPersonAction,
  listPeopleAction,
  refreshPeopleAction,
  toggleCommitmentAction,
  type PersonCommitmentItem,
  type PersonDetailResult,
  type PersonListItem,
  type PersonMentionItem,
} from "@/app/app/people/actions";
import { PersonHoverCard } from "@/components/people/PersonHoverCard";
import { localDateString } from "@/lib/dates";

/**
 * People page (design 15a, extended into contacts): every person you mention
 * gets a page. Add contacts yourself, or let the (optional) AI scan discover
 * them; either way, mentioning a name in any note links that note into the
 * person's timeline — the full passage, not just the title, read like a thread.
 * Owe/owed commitments are extracted by the AI scan when a key is configured.
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

function sourceLabel(mention: PersonMentionItem): string {
  return mention.noteDailyDate ? "daily note" : mention.noteTitle || "Untitled";
}

// ---------------------------------------------------------------------------
// add-a-person input
// ---------------------------------------------------------------------------

function NewPersonInput({
  onCreate,
  autoFocus,
}: {
  onCreate: (name: string) => Promise<void>;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const name = value.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await onCreate(name);
      setValue("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-[0.625rem] border border-white/8 bg-input px-2.5 py-2">
      <Plus className="h-3.5 w-3.5 flex-none text-ink-600" />
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder="Add a person…"
        className="min-w-0 flex-1 bg-transparent text-[0.78125rem] text-ink-100 outline-none placeholder:text-ink-600"
      />
      {busy && <Loader2 className="h-3.5 w-3.5 flex-none animate-spin text-ink-500" />}
    </div>
  );
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
              ` · last seen ${formatTalkedDate(person.lastMentionedAt, today)}`}
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
  onDelete,
}: {
  commitment: PersonCommitmentItem;
  onToggle: (id: string, resolved: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const resolved = Boolean(commitment.resolvedAt);
  return (
    <div
      className={`group flex items-start gap-2.5 rounded-lg border px-2.5 py-2 ${
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
      <button
        type="button"
        aria-label="Remove"
        onClick={() => onDelete(commitment.id)}
        className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded text-ink-700 opacity-0 hover:text-ink-300 group-hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

/** One "you owe / they owe" column with an inline add row — manual, no AI. */
function OweSection({
  title,
  icon: Icon,
  colorClass,
  items,
  onToggle,
  onDelete,
  onAdd,
}: {
  title: string;
  icon: typeof ArrowUpRight;
  colorClass: string;
  items: PersonCommitmentItem[];
  onToggle: (id: string, resolved: boolean) => void;
  onDelete: (id: string) => void;
  onAdd: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const submit = () => {
    const t = draft.trim();
    if (!t) return;
    onAdd(t);
    setDraft("");
  };
  return (
    <div className="min-w-0 flex-1">
      <div
        className={`flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide ${colorClass}`}
      >
        <Icon className="h-3 w-3" />
        {title}
      </div>
      <div className="mt-2.5 flex flex-col gap-1.5">
        {items.map((c) => (
          <CommitmentRow
            key={c.id}
            commitment={c}
            onToggle={onToggle}
            onDelete={onDelete}
          />
        ))}
        <div className="flex items-center gap-2 rounded-lg border border-white/6 bg-input px-2.5 py-1.5">
          <Plus className="h-3 w-3 flex-none text-ink-700" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Add an item…"
            className="min-w-0 flex-1 bg-transparent text-[0.75rem] text-ink-100 outline-none placeholder:text-ink-700"
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// detail pane — mention timeline (thread-like)
// ---------------------------------------------------------------------------

function MentionTimelineRow({
  mention,
  isLast,
  today,
  onOpen,
}: {
  mention: PersonMentionItem;
  isLast: boolean;
  today: string | null;
  onOpen: (mention: PersonMentionItem) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(mention)}
      className="flex w-full gap-3.5 text-left"
    >
      <span className="flex w-3.5 flex-none flex-col items-center">
        <span className="mt-1 h-2 w-2 flex-none rounded-full bg-steel" />
        {!isLast && <span className="w-[1.5px] flex-1 bg-white/9" />}
      </span>
      <span className={`min-w-0 flex-1 ${isLast ? "" : "pb-4"}`}>
        <span className="mb-0.5 flex items-center gap-2">
          <span className="text-[0.6875rem] font-medium text-ink-400">
            {formatTalkedDate(mention.mentionDate, today)}
          </span>
          <span className="truncate text-[0.625rem] text-ink-700">
            {sourceLabel(mention)}
          </span>
        </span>
        <span className="block text-[0.78125rem] leading-relaxed text-ink-300">
          &ldquo;{mention.snippet}&rdquo;
        </span>
      </span>
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

  const [people, setPeople] = useState<PersonListItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PersonDetailResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Bumped after a scan so the open person's timeline reloads.
  const [detailKey, setDetailKey] = useState(0);
  const didInitialScan = useRef(false);

  const reloadPeople = () =>
    listPeopleAction()
      .then(setPeople)
      .catch((err) => console.error("[people] list load failed:", err));

  // Initial load, plus a background name-match sweep (and AI scan if a key is
  // set) so timelines are fresh without the user asking.
  useEffect(() => {
    let cancelled = false;
    listPeopleAction()
      .then((items) => {
        if (!cancelled) setPeople(items);
      })
      .catch((err) => console.error("[people] load failed:", err));

    if (!didInitialScan.current) {
      didInitialScan.current = true;
      refreshPeopleAction()
        .then(() => {
          if (cancelled) return;
          setDetailKey((k) => k + 1);
          return reloadPeople();
        })
        .catch((err) => console.error("[people] background scan failed:", err));
    }
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

  // Load the selected person's page (re-runs when a scan bumps detailKey).
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
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
  }, [selectedId, detailKey]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshPeopleAction();
      await reloadPeople();
      setDetailKey((k) => k + 1);
    } catch (err) {
      console.error("[people] refresh failed:", err);
    } finally {
      setRefreshing(false);
    }
  };

  const handleAddCommitment = (
    direction: "you_owe" | "they_owe",
    text: string,
  ) => {
    if (!detail) return;
    const personId = detail.id;
    addCommitmentAction(personId, direction, text)
      .then((created) => {
        if (!created) return;
        setDetail((prev) => {
          if (!prev || prev.id !== personId) return prev;
          const key = direction === "you_owe" ? "youOwe" : "theyOwe";
          // Skip if the dedupe returned an item already shown.
          if (prev[key].some((c) => c.id === created.id)) return prev;
          return { ...prev, [key]: [...prev[key], created] };
        });
      })
      .catch((err) => console.error("[people] add commitment failed:", err));
  };

  const handleDeleteCommitment = (id: string) => {
    const prevDetail = detail;
    setDetail((prev) =>
      prev
        ? {
            ...prev,
            youOwe: prev.youOwe.filter((c) => c.id !== id),
            theyOwe: prev.theyOwe.filter((c) => c.id !== id),
          }
        : prev,
    );
    deleteCommitmentAction(id).catch((err) => {
      console.error("[people] delete commitment failed:", err);
      setDetail(prevDetail);
    });
  };

  const handleCreate = async (name: string) => {
    try {
      const created = await createPersonAction(name);
      if (!created) return;
      await reloadPeople();
      setSelectedId(created.id);
      setDetailKey((k) => k + 1);
    } catch (err) {
      console.error("[people] create failed:", err);
    }
  };

  const handleDelete = (id: string) => {
    const prev = people;
    setPeople((list) => (list ? list.filter((p) => p.id !== id) : list));
    if (selectedId === id) setSelectedId(null);
    deletePersonAction(id).catch((err) => {
      console.error("[people] delete failed:", err);
      setPeople(prev);
    });
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

  const loadingShell = people === null;

  return (
    <div className="flex h-full min-h-0 flex-col md:pl-[5.75rem]">
      {/* Page header */}
      <div className="flex flex-none flex-wrap items-center gap-3 border-b border-white/7 p-4">
        <span className="text-[1.375rem] font-semibold leading-none text-ink-100">
          People
        </span>
        <span className="text-[0.78125rem] text-ink-600">
          your contacts — mention a name in a note and it joins their timeline
        </span>
        <button
          type="button"
          disabled={refreshing || loadingShell}
          onClick={() => void handleRefresh()}
          className="ml-auto flex flex-none items-center gap-1.5 rounded-lg border border-white/8 bg-white/5 px-3 py-[0.4375rem] text-[0.71875rem] font-medium text-ink-300 hover:bg-white/8 disabled:opacity-50"
        >
          <RefreshCw
            className={`h-[0.6875rem] w-[0.6875rem] text-ink-400 ${
              refreshing ? "animate-spin" : ""
            }`}
          />
          Rescan
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
      ) : people && people.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <Users className="h-9 w-9 text-ink-700" />
          <p className="text-[0.84375rem] font-medium text-ink-300">
            No people yet
          </p>
          <p className="max-w-sm text-[0.75rem] text-ink-600">
            Add a contact — then every note that mentions their name builds their
            timeline automatically.
          </p>
          <div className="mt-1 w-full max-w-xs">
            <NewPersonInput onCreate={handleCreate} autoFocus />
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* List pane */}
          <div className="flex w-full flex-none flex-col gap-2 border-b border-white/7 p-2 md:w-[20rem] md:overflow-y-auto md:border-b-0 md:border-r">
            <NewPersonInput onCreate={handleCreate} />
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
                      {detail.mentionCount} mention
                      {detail.mentionCount === 1 ? "" : "s"}
                      {detail.lastMentionedAt &&
                        ` · last seen ${formatTalkedDate(detail.lastMentionedAt, today)}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${detail.name}`}
                    title="Remove contact"
                    onClick={() => handleDelete(detail.id)}
                    className="flex h-[1.625rem] w-[1.625rem] flex-none items-center justify-center rounded-md text-ink-600 hover:bg-white/6 hover:text-[#D9938A]"
                  >
                    <Trash2 className="h-[0.8125rem] w-[0.8125rem]" />
                  </button>
                </div>

                <div className="flex flex-col gap-5 p-5">
                  {/* Owe / owed — manual, no AI */}
                  <div className="flex flex-col gap-5 rounded-xl border border-white/8 bg-white/[0.02] p-4 sm:flex-row">
                    <OweSection
                      title={`YOU OWE ${detail.name.toUpperCase()}`}
                      icon={ArrowUpRight}
                      colorClass="text-[#D9938A]"
                      items={detail.youOwe}
                      onToggle={handleToggleCommitment}
                      onDelete={handleDeleteCommitment}
                      onAdd={(t) => handleAddCommitment("you_owe", t)}
                    />
                    <OweSection
                      title={`${detail.name.toUpperCase()} OWES YOU`}
                      icon={ArrowDownLeft}
                      colorClass="text-sage"
                      items={detail.theyOwe}
                      onToggle={handleToggleCommitment}
                      onDelete={handleDeleteCommitment}
                      onAdd={(t) => handleAddCommitment("they_owe", t)}
                    />
                  </div>

                  {/* Mentions timeline — every note, read like a thread */}
                  <div>
                    <div className="mb-3 flex items-center gap-2">
                      <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-600">
                        Mentions
                      </span>
                      <span className="text-[0.625rem] text-ink-700">
                        {detail.mentions.length} note
                        {detail.mentions.length === 1 ? "" : "s"} mention{" "}
                        {detail.name}
                      </span>
                    </div>
                    {detail.mentions.length === 0 ? (
                      <p className="text-[0.78125rem] text-ink-600">
                        No mentions yet — write &ldquo;{detail.name}&rdquo; in a
                        note, then Rescan.
                      </p>
                    ) : (
                      <div className="flex flex-col">
                        {detail.mentions.map((m, i) => (
                          <MentionTimelineRow
                            key={m.id}
                            mention={m}
                            isLast={i === detail.mentions.length - 1}
                            today={today}
                            onOpen={goToMention}
                          />
                        ))}
                      </div>
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
