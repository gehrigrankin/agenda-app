"use client";

import { useEffect, useRef, useState } from "react";
import {
  CornerDownRight,
  Globe,
  Image as ImageIcon,
  Inbox as InboxIcon,
  Loader2,
  Mail,
  MessageSquare,
  RefreshCw,
  X,
} from "lucide-react";

import {
  dismissItemAction,
  dismissSamplesAction,
  fileItemAction,
  getInboxAction,
  listFolderBubblesAction,
  type FolderBubbleOption,
  type InboxItemResult,
} from "@/app/app/inbox/actions";
import { relativeTime } from "@/lib/relative-time";
import { useOutsideClose } from "@/lib/hooks/use-outside-close";

/**
 * Capture inbox. The real ingestion path is the PWA share target: install the
 * app, then share links/photos/text from any other app and each lands here as
 * a card. When an item has a suggested destination the primary button reads
 * "File to <folder>"; either way filing (with an optional folder via the
 * "Somewhere else" picker) is always offered. Leaving a card alone is a fine
 * outcome too — the inbox is a real place, not a nag.
 *
 * The old private email address UI was a demo facade and is gone (see
 * src/server/inbox.ts); first-visit sample rows remain but are chipped
 * "sample" and can be cleared in one tap.
 *
 * All data loads client-side (same pattern as ThreadsPageClient); auth is
 * enforced in the server actions.
 */

// ---------------------------------------------------------------------------
// formatting helpers
// ---------------------------------------------------------------------------

const SOURCE_LABEL: Record<InboxItemResult["source"], string> = {
  email: "email",
  link: "link",
  photo: "photo",
  text: "text",
};

/** The card's meta line: "link · 22 min ago". */
function metaLine(item: InboxItemResult, nowMs: number): string {
  return `${SOURCE_LABEL[item.source]} · ${relativeTime(item.receivedAt, "short", nowMs)}`;
}

// ---------------------------------------------------------------------------
// "Somewhere else" board picker
// ---------------------------------------------------------------------------

function SomewhereElsePicker({
  onPick,
}: {
  onPick: (bubbleId: string | null) => void;
}) {
  const [folders, setFolders] = useState<FolderBubbleOption[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listFolderBubblesAction()
      .then((rows) => {
        if (!cancelled) setFolders(rows);
      })
      .catch((err) => {
        console.error("[inbox] load folders failed:", err);
        if (!cancelled) setFolders([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="relative">
      <div className="absolute left-0 top-full z-40 mt-1 w-56 rounded-lg border border-white/8 bg-card py-1 shadow-xl">
        {folders === null ? (
          <div className="flex items-center justify-center py-3">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-600" />
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onPick(null)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[0.75rem] text-ink-300 hover:bg-white/6"
            >
              Just file it — no folder
            </button>
            {folders.length === 0 ? (
              <div className="px-3 py-2 text-[0.6875rem] italic text-ink-600">
                No folders yet — mark a bubble as a folder in Canvas.
              </div>
            ) : (
              folders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => onPick(f.id)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[0.75rem] text-ink-300 hover:bg-white/6"
                >
                  {f.emoji ? (
                    <span className="w-3.5 flex-none text-center text-[0.6875rem] leading-none">
                      {f.emoji}
                    </span>
                  ) : (
                    <span
                      className="h-2 w-2 flex-none rounded-full"
                      style={{ backgroundColor: f.color ?? "#5c6360" }}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">{f.title}</span>
                </button>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// item card
// ---------------------------------------------------------------------------

function SourceGlyph({ source }: { source: InboxItemResult["source"] }) {
  if (source === "photo") {
    return (
      <div className="flex h-11 w-11 flex-none items-center justify-center rounded-lg bg-[repeating-linear-gradient(45deg,#1E2123,#1E2123_6px,#202325_6px,#202325_12px)]">
        <ImageIcon className="h-4 w-4 text-ink-600" />
      </div>
    );
  }
  const Icon =
    source === "link" ? Globe : source === "text" ? MessageSquare : Mail;
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
                onPick={(bubbleId) => {
                  setPickerOpen(false);
                  onFile(bubbleId);
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// skeleton
// ---------------------------------------------------------------------------

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

export function InboxPageClient() {
  const [items, setItems] = useState<InboxItemResult[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    setNowMs(Date.now());
  }, []);

  const load = () => {
    return getInboxAction().then((result) => {
      setItems(result.items);
    });
  };

  useEffect(() => {
    let cancelled = false;
    load().catch((err) => {
      if (!cancelled) console.error("[inbox] load failed:", err);
    });
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

  const handleFile = (item: InboxItemResult, bubbleId: string | null) => {
    const prevItems = items;
    // Optimistic: the card leaves the list immediately; roll back on failure.
    setItems((prev) => (prev ? prev.filter((i) => i.id !== item.id) : prev));
    fileItemAction(item.id, bubbleId).catch((err) => {
      console.error("[inbox] file failed:", err);
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

  const handleDismissSamples = () => {
    const prevItems = items;
    setItems((prev) => (prev ? prev.filter((i) => !i.isSample) : prev));
    dismissSamplesAction().catch((err) => {
      console.error("[inbox] clear samples failed:", err);
      setItems(prevItems);
    });
  };

  const loadingShell = items === null || nowMs === null;
  const hasSamples = !loadingShell && items.some((i) => i.isSample);

  return (
    <div className="flex h-full min-h-0 flex-col md:pl-[5.75rem]">
      {/* Page header */}
      <div className="flex flex-none flex-wrap items-center gap-3 border-b border-white/7 p-4">
        <InboxIcon className="h-[1.125rem] w-[1.125rem] flex-none text-sage" />
        <div className="min-w-0">
          <span className="text-[1.375rem] font-semibold leading-none text-ink-100">
            Capture inbox
          </span>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.78125rem] text-ink-600">
            <span>{loadingShell ? "…" : items.length} new</span>
            <span>·</span>
            <span>anything shared from your phone lands here</span>
          </div>
        </div>
        <div className="ml-auto flex flex-none items-center gap-2">
          {hasSamples && (
            <button
              type="button"
              onClick={handleDismissSamples}
              className="rounded-lg px-3 py-[0.4375rem] text-[0.71875rem] font-medium text-ink-500 hover:bg-white/5 hover:text-ink-300"
            >
              Clear samples
            </button>
          )}
          <button
            type="button"
            disabled={refreshing || loadingShell}
            onClick={() => void handleRefresh()}
            className="flex items-center gap-1.5 rounded-lg border border-white/8 bg-white/5 px-3 py-[0.4375rem] text-[0.71875rem] font-medium text-ink-300 hover:bg-white/8 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-[0.6875rem] w-[0.6875rem] text-ink-400 ${
                refreshing ? "animate-spin" : ""
              }`}
            />
            Refresh
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loadingShell ? (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-5">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : items.length === 0 ? (
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
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-5">
            {items.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                nowMs={nowMs}
                onFile={(bubbleId) => handleFile(item, bubbleId)}
                onDismiss={() => handleDismiss(item.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
