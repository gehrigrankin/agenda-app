"use client";

import { useEffect, useState } from "react";
import {
  CornerDownRight,
  Check,
  Copy,
  Globe,
  Image as ImageIcon,
  Inbox as InboxIcon,
  Loader2,
  Mail,
  RefreshCw,
  X,
} from "lucide-react";

import {
  dismissItemAction,
  fileItemAction,
  getInboxAction,
  listFolderBubblesAction,
  type FolderBubbleOption,
  type InboxItemResult,
} from "@/app/app/inbox/actions";

/**
 * Capture inbox (design 16c): "forward anything" — every account gets a
 * private address (shown in the header as a copyable chip); whatever lands
 * there shows up here as a card with a suggested destination already worked
 * out. "File to …" accepts in one tap; "Somewhere else" opens a small board
 * picker; leaving a card alone is a fine outcome too — the inbox is a real
 * place, not a nag.
 *
 * All data loads client-side (same pattern as ThreadsPageClient); auth is
 * enforced in the server actions.
 */

// ---------------------------------------------------------------------------
// formatting helpers
// ---------------------------------------------------------------------------

const NO_SUGGESTION_SUFFIX = "no suggestion yet — stays here until you decide";

/** "22 min ago" / "3 hrs ago" / "2 days ago" — coarse, no dependency needed. */
function relativeTime(iso: string, nowMs: number): string {
  const ms = Math.max(0, nowMs - new Date(iso).getTime());
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** "8:14 PM" */
function formatClockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The card's meta line, source-specific like the mockup ("email · 22 min
 * ago", "link · shared from phone", "texted 8:14 PM …"). When the item has
 * no suggestion, the "stays here until you decide" clause folds into this
 * same line instead of a separate row.
 */
function metaLine(item: InboxItemResult, nowMs: number): string {
  const hasSuggestion = Boolean(item.suggestionLabel);
  if (item.source === "photo" || item.source === "text") {
    const time = formatClockTime(item.receivedAt);
    return hasSuggestion
      ? `texted ${time}`
      : `texted ${time} · ${NO_SUGGESTION_SUFFIX}`;
  }
  if (item.source === "link") {
    return hasSuggestion
      ? "link · shared from phone"
      : `link · shared from phone · ${NO_SUGGESTION_SUFFIX}`;
  }
  const rel = relativeTime(item.receivedAt, nowMs);
  return hasSuggestion ? `email · ${rel}` : `email · ${rel} · ${NO_SUGGESTION_SUFFIX}`;
}

// ---------------------------------------------------------------------------
// "Somewhere else" board picker
// ---------------------------------------------------------------------------

function SomewhereElsePicker({
  onPick,
  onClose,
}: {
  onPick: (bubbleId: string | null) => void;
  onClose: () => void;
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
      {/* Backdrop: click anywhere outside to close. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-30 cursor-default"
      />
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
              Just file it — no board
            </button>
            {folders.length === 0 ? (
              <div className="px-3 py-2 text-[0.6875rem] italic text-ink-600">
                No boards yet — mark a bubble as a folder in the Bubble map.
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
  const Icon = source === "link" ? Globe : Mail;
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
  const hasSuggestion = Boolean(item.suggestionLabel);

  return (
    <div className="rounded-[0.875rem] border border-white/7 bg-panel/90 p-4">
      <div className="flex items-start gap-3">
        <SourceGlyph source={item.source} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <span className="min-w-0 flex-1 text-[0.875rem] font-medium leading-snug text-ink-100">
              {item.title}
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
          {hasSuggestion && (
            <div className="relative mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onFile(item.suggestedBubbleId)}
                className="flex items-center gap-1.5 rounded-lg bg-sage px-3 py-1.5 text-[0.75rem] font-semibold text-sage-ink hover:brightness-105"
              >
                <CornerDownRight className="h-3.5 w-3.5" />
                {item.suggestionLabel}
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
                  onClose={() => setPickerOpen(false)}
                />
              )}
            </div>
          )}
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
    <div className="animate-pulse rounded-[0.875rem] border border-white/7 bg-panel/90 p-4">
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
  const [address, setAddress] = useState<string | null>(null);
  const [items, setItems] = useState<InboxItemResult[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    setNowMs(Date.now());
  }, []);

  const load = () => {
    return getInboxAction().then((result) => {
      setAddress(result.address);
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

  const handleCopy = () => {
    if (!address || !navigator.clipboard) return;
    navigator.clipboard
      .writeText(address)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch((err) => console.error("[inbox] copy failed:", err));
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

  const loadingShell = items === null || address === null || nowMs === null;

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
            <span>via</span>
            {address ? (
              <button
                type="button"
                onClick={handleCopy}
                title="Copy address"
                className="inline-flex items-center gap-1.5 rounded-md bg-input px-2 py-0.5 font-mono text-[0.71875rem] text-ink-300 hover:bg-white/8"
              >
                {address}
                {copied ? (
                  <Check className="h-3 w-3 text-sage" />
                ) : (
                  <Copy className="h-3 w-3 text-ink-600" />
                )}
              </button>
            ) : (
              <span className="text-ink-700">…</span>
            )}
          </div>
        </div>
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
          Refresh
        </button>
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
              Forward anything to{" "}
              <span className="font-mono text-ink-400">{address}</span> and it
              lands here with a suggested destination worked out.
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
