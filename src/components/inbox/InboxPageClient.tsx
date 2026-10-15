"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

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
import { usePersistentState } from "@/lib/hooks/use-persistent-state";
import { useTabletLayout } from "@/lib/hooks/use-tablet-layout";
import {
  inSourceView,
  matchPerson,
  snoozePresets,
  type InboxView,
} from "@/lib/inbox-triage";

import { usePhoneParam } from "@/components/phone/use-phone-param";
import { InboxDetail, defaultChoice, type FileChoice } from "./InboxDetail";
import { InboxPhone } from "./InboxPhone";
import {
  InboxSourcesSidebar,
  QueueHeader,
  QueueList,
  VIEW_META,
  type ViewCounts,
} from "./InboxSidebars";

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

  // --- phone: the open item (?item=) ----------------------------------------

  const {
    id: phoneOpenId,
    open: openPhoneItem,
    close: closePhoneItem,
  } = usePhoneParam("item");
  const phoneItem =
    phoneOpenId && items
      ? (items.find((i) => i.id === phoneOpenId) ?? null)
      : null;
  const phoneMode: "triage" | "snoozed" | "filed" = !phoneItem
    ? "triage"
    : phoneItem.status === "filed"
      ? "filed"
      : phoneItem.snoozedUntil &&
          nowMs !== null &&
          Date.parse(phoneItem.snoozedUntil) > nowMs
        ? "snoozed"
        : "triage";
  const phoneChoice: FileChoice =
    phoneItem && choiceState?.id === phoneItem.id
      ? choiceState.choice
      : phoneItem
        ? defaultChoice(phoneItem)
        : { kind: "note" };
  const phonePerson = phoneItem
    ? matchPerson(`${phoneItem.title} ${phoneItem.excerpt ?? ""}`, people)
    : null;

  // An open item that no longer exists (dismissed, bad link) → the list.
  useEffect(() => {
    if (items && phoneOpenId && !items.some((i) => i.id === phoneOpenId)) {
      closePhoneItem();
    }
  }, [items, phoneOpenId, closePhoneItem]);

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
      <InboxPhone
        items={loadingShell ? null : queue}
        loading={loadingShell}
        view={view}
        onView={(v) => {
          setView(v);
          setSelectedId(null);
        }}
        counts={counts}
        sort={sort}
        onSort={() => setSort(sort === "newest" ? "oldest" : "newest")}
        now={now}
        refreshing={refreshing}
        onRefresh={() => void handleRefresh()}
        hasSamples={hasSamples}
        onClearSamples={handleDismissSamples}
        onFile={(item) => fileTo(item, item.suggestedBubbleId)}
        onSnooze={handleSnooze}
        openId={phoneOpenId}
        onOpen={openPhoneItem}
        onBack={closePhoneItem}
        detail={
          <InboxDetail
            key={phoneItem?.id ?? "none"}
            item={loadingShell ? null : phoneItem}
            mode={phoneMode}
            now={now}
            choice={phoneChoice}
            onChoice={(c) =>
              phoneItem && setChoiceState({ id: phoneItem.id, choice: c })
            }
            person={phonePerson}
            onAccept={() => {
              if (!phoneItem || phoneMode === "filed") return;
              if (phoneChoice.kind === "task") makeTask(phoneItem);
              else if (phoneChoice.kind === "folder")
                fileTo(phoneItem, phoneChoice.bubbleId);
              else if (phoneChoice.kind === "suggested")
                fileTo(phoneItem, phoneItem.suggestedBubbleId);
              else fileTo(phoneItem, null);
              closePhoneItem();
            }}
            onSnooze={(until) => {
              if (!phoneItem || phoneMode !== "triage") return;
              handleSnooze(phoneItem, until);
              closePhoneItem();
            }}
            onUnsnooze={() => {
              if (!phoneItem || phoneMode !== "snoozed") return;
              handleSnooze(phoneItem, null);
              closePhoneItem();
            }}
            onDismiss={() => {
              if (!phoneItem) return;
              handleDismiss(phoneItem.id);
              closePhoneItem();
            }}
            emptyTitle="Inbox"
            emptyText={loadingShell ? "Checking captures…" : "Item not found"}
          />
        }
      />

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
