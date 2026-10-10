"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CornerDownRight,
  Inbox as InboxIcon,
  RefreshCw,
  X,
} from "lucide-react";

import {
  MOBILE_HEADER_ACTION,
  MobilePageHeader,
} from "@/components/layout/MobilePageHeader";
import { PageLayout } from "@/components/layout/PageLayout";
import { SidebarIconButton } from "@/components/layout/sidebar";

import { createStandaloneTaskAction } from "@/app/app/actions";
import {
  dismissItemAction,
  dismissSamplesAction,
  fileItemAction,
  getInboxAction,
  markItemFiledAction,
  snoozeItemAction,
  type InboxItemResult,
} from "@/app/app/inbox/actions";
import { listPeopleAction } from "@/app/app/people/actions";
import { useOutsideClose } from "@/lib/hooks/use-outside-close";
import { usePersistentState } from "@/lib/hooks/use-persistent-state";
import { useTabletLayout } from "@/lib/hooks/use-tablet-layout";
import {
  inSourceView,
  matchPerson,
  snoozePresets,
  type InboxView,
} from "@/lib/inbox-triage";
import { relativeTime } from "@/lib/relative-time";

import { InboxDetail, defaultChoice, type FileChoice } from "./InboxDetail";
import {
  InboxSourcesSidebar,
  QueueHeader,
  QueueList,
  VIEW_META,
  type ViewCounts,
} from "./InboxSidebars";
import { SOURCE_META, SomewhereElsePicker } from "./inbox-shared";

/**
 * Capture inbox. The real ingestion path is the PWA share target: install the
 * app, then share links/photos/text from any other app and each lands here.
 *
 * md+ (Notes Sidebars design §5f): sidebar 1 = sources + DONE views, sidebar 2
 * (left, beside it) = the triage queue, content = the selected item with a
 * FILE IT card (Accept ↵, Snooze S, ↑/↓ through the queue). Tablets (md–lg or
 * coarse pointers) fold the sources into a dropdown atop the queue (§6f).
 * Below md the original card list is untouched.
 *
 * The old private email address UI was a demo facade and is gone (see
 * src/server/inbox.ts); first-visit sample rows remain but are chipped
 * "sample" and can be cleared in one tap. All data loads client-side; auth is
 * enforced in the server actions.
 */

// ---------------------------------------------------------------------------
// phone card (unchanged phone UI)
// ---------------------------------------------------------------------------

/** The card's meta line: "link · 22 min ago". */
function metaLine(item: InboxItemResult, nowMs: number): string {
  return `${SOURCE_META[item.source].label} · ${relativeTime(item.receivedAt, "short", nowMs)}`;
}

function SourceGlyph({ source }: { source: InboxItemResult["source"] }) {
  const Icon = SOURCE_META[source].Icon;
  if (source === "photo") {
    return (
      <div className="flex h-11 w-11 flex-none items-center justify-center rounded-lg bg-[repeating-linear-gradient(45deg,#1E2123,#1E2123_6px,#202325_6px,#202325_12px)]">
        <Icon className="h-4 w-4 text-ink-600" />
      </div>
    );
  }
  return (
    <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-white/5">
      <Icon className="h-4 w-4 text-ink-400" />
    </div>
  );
}

function ItemCard({
  item,
  nowMs,
  onFile,
  onDismiss,
}: {
  item: InboxItemResult;
  nowMs: number;
  onFile: (bubbleId: string | null) => void;
  onDismiss: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  // The action row holds both the "Somewhere else" trigger and the picker, so
  // the press that closes the picker isn't read as an outside click.
  const actionsRef = useRef<HTMLDivElement | null>(null);
  useOutsideClose(pickerOpen, actionsRef, () => setPickerOpen(false));

  return (
    <div className="rounded-3xl border border-white/7 bg-panel/90 p-4">
      <div className="flex items-start gap-3">
        <SourceGlyph source={item.source} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <span className="min-w-0 flex-1 text-[0.875rem] font-medium leading-snug text-ink-100">
              {item.title}
              {item.isSample && (
                <span className="ml-2 inline-block rounded border border-white/10 px-1.5 py-px align-middle text-[0.59375rem] font-medium uppercase tracking-wide text-ink-600">
                  sample
                </span>
              )}
            </span>
            <button
              type="button"
              title="Dismiss"
              aria-label="Dismiss"
              onClick={onDismiss}
              className="flex h-5 w-5 flex-none items-center justify-center rounded-md text-ink-700 hover:bg-white/6 hover:text-ink-400"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="mt-0.5 text-[0.71875rem] text-ink-600">
            {metaLine(item, nowMs)}
          </div>
          {item.excerpt && (
            <div className="mt-2 text-[0.78125rem] italic text-ink-400">
              &ldquo;{item.excerpt}&rdquo;
            </div>
          )}
          {item.attachmentUrl && (
            // Plain <img>, deliberately not next/image — same-origin
            // attachment route (/api/uploads/[id]), same rationale as the
            // editor's ImageNode.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.attachmentUrl}
              alt={item.title}
              loading="lazy"
              className="mt-2 max-h-48 max-w-full rounded-lg border border-white/10 object-contain"
            />
          )}
          {/* Filing is always offered — a suggestion just names the button. */}
          <div
            ref={actionsRef}
            className="relative mt-3 flex flex-wrap items-center gap-2"
          >
            <button
              type="button"
              onClick={() => onFile(item.suggestedBubbleId)}
              className="flex items-center gap-1.5 rounded-lg bg-sage px-3 py-1.5 text-[0.75rem] font-semibold text-sage-ink hover:brightness-105"
            >
              <CornerDownRight className="h-3.5 w-3.5" />
              {item.suggestionLabel ?? "File as note"}
            </button>
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              className="rounded-lg border border-white/8 px-3 py-1.5 text-[0.75rem] text-ink-400 hover:bg-white/5"
            >
              Somewhere else
            </button>
            {item.suggestionReason && (
              <span className="ml-auto flex-none text-[0.6875rem] text-ink-700">
                suggested — {item.suggestionReason}
              </span>
            )}
            {pickerOpen && (
              <SomewhereElsePicker
                onPick={(folder) => {
                  setPickerOpen(false);
                  onFile(folder?.id ?? null);
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-3xl border border-white/7 bg-panel/90 p-4">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 flex-none rounded-lg bg-white/5" />
        <div className="min-w-0 flex-1">
          <div className="h-3.5 w-2/3 rounded bg-white/6" />
          <div className="mt-2 h-2.5 w-1/3 rounded bg-white/5" />
          <div className="mt-3 h-7 w-40 rounded-lg bg-white/5" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

type Sort = "newest" | "oldest";
const isSort = (v: unknown): v is Sort => v === "newest" || v === "oldest";

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function InboxPageClient() {
  const tablet = useTabletLayout();
  const [items, setItems] = useState<InboxItemResult[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [view, setView] = useState<InboxView>("all");
  const [sort, setSort] = usePersistentState<Sort>(
    "agenda.inbox.sort",
    "newest",
    isSort,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [choiceState, setChoiceState] = useState<{
    id: string;
    choice: FileChoice;
  } | null>(null);
  const [people, setPeople] = useState<Array<{ id: string; name: string }>>([]);

  // "Now" lives in state (hydration-safe) and ticks, so a snooze that expires
  // while the page is open puts the item back in the queue by itself.
  useEffect(() => {
    setNowMs(Date.now());
    const t = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const load = () =>
    getInboxAction(new Date(startOfLocalDay(Date.now())).toISOString()).then(
      (result) => {
        setItems(result.items);
      },
    );

  useEffect(() => {
    let cancelled = false;
    load().catch((err) => {
      if (!cancelled) console.error("[inbox] load failed:", err);
    });
    // Contacts power the "a person you know" chip; best-effort.
    listPeopleAction()
      .then((rows) => {
        if (!cancelled)
          setPeople(rows.map((p) => ({ id: p.id, name: p.name })));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } catch (err) {
      console.error("[inbox] refresh failed:", err);
    } finally {
      setRefreshing(false);
    }
  };

  // --- derived lists --------------------------------------------------------

  const lists = useMemo(() => {
    if (items === null || nowMs === null) return null;
    const dayStart = startOfLocalDay(nowMs);
    const triage: InboxItemResult[] = [];
    const snoozed: InboxItemResult[] = [];
    const filed: InboxItemResult[] = [];
    for (const it of items) {
      if (it.status === "filed") {
        if (it.filedAt && Date.parse(it.filedAt) >= dayStart) filed.push(it);
      } else if (it.status === "new") {
        if (it.snoozedUntil && Date.parse(it.snoozedUntil) > nowMs) {
          snoozed.push(it);
        } else {
          triage.push(it);
        }
      }
    }
    const order = (a: InboxItemResult, b: InboxItemResult) =>
      sort === "newest"
        ? Date.parse(b.receivedAt) - Date.parse(a.receivedAt)
        : Date.parse(a.receivedAt) - Date.parse(b.receivedAt);
    triage.sort(order);
    snoozed.sort(order);
    filed.sort(order);
    const counts: ViewCounts = {
      all: triage.length,
      email: 0,
      voice: 0,
      clips: 0,
      shared: 0,
      filed: filed.length,
      snoozed: snoozed.length,
    };
    for (const v of ["email", "voice", "clips", "shared"] as const) {
      counts[v] = triage.filter((i) => inSourceView(i.source, v)).length;
    }
    return { triage, snoozed, filed, counts };
  }, [items, nowMs, sort]);

  const mode: "triage" | "snoozed" | "filed" =
    view === "filed" ? "filed" : view === "snoozed" ? "snoozed" : "triage";
  const queue: InboxItemResult[] = useMemo(() => {
    if (!lists) return [];
    if (view === "filed") return lists.filed;
    if (view === "snoozed") return lists.snoozed;
    return lists.triage.filter((i) => inSourceView(i.source, view));
  }, [lists, view]);

  const selected = queue.find((i) => i.id === selectedId) ?? queue[0] ?? null;
  const choice: FileChoice =
    selected && choiceState?.id === selected.id
      ? choiceState.choice
      : selected
        ? defaultChoice(selected)
        : { kind: "note" };
  const person = selected
    ? matchPerson(`${selected.title} ${selected.excerpt ?? ""}`, people)
    : null;

  // --- actions (optimistic; roll back on failure) ---------------------------

  const patch = (id: string, p: Partial<InboxItemResult>) =>
    setItems((prev) =>
      prev ? prev.map((i) => (i.id === id ? { ...i, ...p } : i)) : prev,
    );

  /** Select the neighbour of `id` — called as the item leaves the queue. */
  const advance = (id: string) => {
    const idx = queue.findIndex((i) => i.id === id);
    if (idx === -1) return;
    setSelectedId((queue[idx + 1] ?? queue[idx - 1] ?? null)?.id ?? null);
  };

  const fileTo = (item: InboxItemResult, bubbleId: string | null) => {
    const prevItems = items;
    patch(item.id, {
      status: "filed",
      filedAt: new Date().toISOString(),
      snoozedUntil: null,
    });
    fileItemAction(item.id, bubbleId)
      .then((r) => {
        if (r) patch(item.id, { filedNoteId: r.noteId });
      })
      .catch((err) => {
        console.error("[inbox] file failed:", err);
        setItems(prevItems);
      });
  };

  const makeTask = (item: InboxItemResult) => {
    const prevItems = items;
    patch(item.id, {
      status: "filed",
      filedAt: new Date().toISOString(),
      snoozedUntil: null,
    });
    // Undated: it lands in the task inbox for triage there.
    createStandaloneTaskAction(item.title, null)
      .then(() => markItemFiledAction(item.id))
      .catch((err) => {
        console.error("[inbox] make task failed:", err);
        setItems(prevItems);
      });
  };

  const handleDismiss = (id: string) => {
    const prevItems = items;
    setItems((prev) => (prev ? prev.filter((i) => i.id !== id) : prev));
    dismissItemAction(id).catch((err) => {
      console.error("[inbox] dismiss failed:", err);
      setItems(prevItems);
    });
  };

  const handleSnooze = (item: InboxItemResult, until: Date | null) => {
    const prevItems = items;
    patch(item.id, { snoozedUntil: until ? until.toISOString() : null });
    snoozeItemAction(item.id, until ? until.toISOString() : null).catch(
      (err) => {
        console.error("[inbox] snooze failed:", err);
        setItems(prevItems);
      },
    );
  };

  const handleDismissSamples = () => {
    const prevItems = items;
    setItems((prev) => (prev ? prev.filter((i) => !i.isSample) : prev));
    dismissSamplesAction().catch((err) => {
      console.error("[inbox] clear samples failed:", err);
      setItems(prevItems);
    });
  };

  const accept = () => {
    if (!selected || mode === "filed") return;
    const item = selected;
    advance(item.id);
    if (choice.kind === "task") makeTask(item);
    else if (choice.kind === "folder") fileTo(item, choice.bubbleId);
    else if (choice.kind === "suggested") fileTo(item, item.suggestedBubbleId);
    else fileTo(item, null);
  };

  const snoozeTo = (until: Date) => {
    if (!selected || mode !== "triage") return;
    advance(selected.id);
    handleSnooze(selected, until);
  };

  const unsnooze = () => {
    if (!selected || mode !== "snoozed") return;
    advance(selected.id);
    handleSnooze(selected, null);
  };

  const move = (delta: 1 | -1) => {
    if (queue.length === 0) return;
    const idx = selected ? queue.indexOf(selected) : -1;
    const next = queue[Math.min(queue.length - 1, Math.max(0, idx + delta))];
    if (next) setSelectedId(next.id);
  };

  // --- keyboard: ↑/↓ move, Enter accepts, S snoozes -------------------------

  const latest = useRef({ accept, snoozeTo, move, now: nowMs });
  latest.current = { accept, snoozeTo, move, now: nowMs };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (!window.matchMedia("(min-width: 768px)").matches) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      )
        return;
      const h = latest.current;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (t?.closest('[role="separator"],[role="menu"]')) return;
        e.preventDefault();
        h.move(e.key === "ArrowDown" ? 1 : -1);
      } else if (e.key === "Enter") {
        // A focused button/link keeps its own Enter.
        if (t?.closest("button,a,[role='menuitem']")) return;
        e.preventDefault();
        h.accept();
      } else if ((e.key === "s" || e.key === "S") && h.now !== null) {
        if (t?.closest("[role='menu']")) return;
        e.preventDefault();
        h.snoozeTo(snoozePresets(new Date(h.now))[1].until);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // --- render ---------------------------------------------------------------

  const loadingShell = lists === null || nowMs === null;
  const now = nowMs === null ? null : new Date(nowMs);
  const hasSamples = !loadingShell && items!.some((i) => i.isSample);
  const counts = lists?.counts ?? {
    all: 0,
    email: 0,
    voice: 0,
    clips: 0,
    shared: 0,
    filed: 0,
    snoozed: 0,
  };
  const phoneItems = lists?.triage ?? [];

  const queueHeader = (
    <QueueHeader
      count={queue.length}
      view={view}
      sort={sort}
      onSort={() => setSort(sort === "newest" ? "oldest" : "newest")}
      tablet={tablet}
      counts={counts}
      onView={(v) => {
        setView(v);
        setSelectedId(null);
      }}
    />
  );
  const queueList = (
    <QueueList
      items={loadingShell ? null : queue}
      now={now}
      selectedId={selected?.id ?? null}
      onSelect={setSelectedId}
      empty={VIEW_META[view].empty}
    />
  );

  return (
    <div className="h-full min-h-0">
      {/* ------------------------------ phone ------------------------------ */}
      <div className="flex h-full min-h-0 flex-col md:hidden">
        <MobilePageHeader
          title="Inbox"
          subtitle={
            loadingShell ? "Checking captures…" : `${phoneItems.length} new`
          }
          trailing={
            <button
              type="button"
              aria-label="Refresh inbox"
              disabled={refreshing || loadingShell}
              onClick={() => void handleRefresh()}
              className={MOBILE_HEADER_ACTION}
            >
              <RefreshCw
                className={`h-[1.125rem] w-[1.125rem] ${refreshing ? "animate-spin" : ""}`}
              />
            </button>
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
          {loadingShell ? (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-2.5 px-3 py-3">
              <CardSkeleton />
              <CardSkeleton />
              <CardSkeleton />
            </div>
          ) : phoneItems.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <InboxIcon className="h-9 w-9 text-ink-700" />
              <p className="text-[0.84375rem] font-medium text-ink-300">
                Inbox zero
              </p>
              <p className="max-w-sm text-[0.75rem] text-ink-600">
                Install the app, then share links, photos, and text from any
                other app — they land straight here, ready to file as notes.
              </p>
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-2.5 px-3 py-3">
              {hasSamples && (
                <button
                  type="button"
                  onClick={handleDismissSamples}
                  className="self-end rounded-lg px-3 py-1.5 text-[0.71875rem] font-medium text-ink-500 hover:bg-white/5 hover:text-ink-300"
                >
                  Clear samples
                </button>
              )}
              {phoneItems.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  nowMs={nowMs!}
                  onFile={(bubbleId) => fileTo(item, bubbleId)}
                  onDismiss={() => handleDismiss(item.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ------------------------- tablet / desktop ------------------------ */}
      <div className="hidden h-full min-h-0 md:block">
        <PageLayout
          pageKey="inbox"
          sidebar2Position="left"
          sidebar1={
            tablet
              ? {
                  label: "Inbox",
                  header: queueHeader,
                  defaultWidth: 23,
                  minWidth: 17,
                  maxWidth: 34,
                  children: queueList,
                }
              : {
                  label: "Inbox",
                  defaultWidth: 16,
                  minWidth: 12,
                  maxWidth: 24,
                  children: (
                    <InboxSourcesSidebar
                      view={view}
                      counts={counts}
                      onView={(v) => {
                        setView(v);
                        setSelectedId(null);
                      }}
                    />
                  ),
                }
          }
          sidebar2={
            tablet
              ? undefined
              : {
                  label: "Triage queue",
                  header: queueHeader,
                  defaultWidth: 22,
                  minWidth: 16,
                  maxWidth: 34,
                  children: queueList,
                }
          }
        >
          <InboxDetail
            key={selected?.id ?? "none"}
            item={loadingShell ? null : selected}
            mode={mode}
            now={now}
            choice={choice}
            onChoice={(c) =>
              selected && setChoiceState({ id: selected.id, choice: c })
            }
            person={person}
            onAccept={accept}
            onSnooze={snoozeTo}
            onUnsnooze={unsnooze}
            onDismiss={() => {
              if (!selected) return;
              advance(selected.id);
              handleDismiss(selected.id);
            }}
            headerTrailing={
              <div className="flex flex-none items-center gap-1">
                {hasSamples && (
                  <button
                    type="button"
                    onClick={handleDismissSamples}
                    className="rounded-lg px-3 py-1.5 text-[0.8125rem] font-medium text-ink-500 hover:bg-white/5 hover:text-ink-300 touch:min-h-11"
                  >
                    Clear samples
                  </button>
                )}
                <SidebarIconButton
                  icon={RefreshCw}
                  label="Refresh inbox"
                  disabled={refreshing || loadingShell}
                  onClick={() => void handleRefresh()}
                  className={refreshing ? "[&>svg]:animate-spin" : ""}
                />
              </div>
            }
            emptyHint={!loadingShell && mode === "triage" && view === "all"}
            emptyTitle={loadingShell ? "Inbox" : VIEW_META[view].empty}
            emptyText={
              loadingShell ? "Checking captures…" : VIEW_META[view].empty
            }
          />
        </PageLayout>
      </div>
    </div>
  );
}
