"use client";

import { AlertCircle, Check, Loader2, RefreshCw } from "lucide-react";

import type { SaveStatus } from "@/lib/hooks/use-note-autosave";

/**
 * The save indicator and its failure banner, shared by every surface that
 * autosaves a note (full note editor, daily jot, inline card editor).
 *
 * The old indicator said "save failed" and stopped there — no reason, no way
 * back, on a surface whose entire job is holding words the user just typed.
 * These two pieces split that: the chip stays small enough to live in a header
 * and says whether a retry is already coming, and the banner states the actual
 * reason and the one button that helps (retry, or reload for a tab the server
 * has moved past). The banner is deliberately NOT dismissible: an unsaved
 * document is not a notification.
 */

export function SaveStatusChip({
  status,
  compact = false,
}: {
  status: SaveStatus;
  /** Smaller type, for the daily jot header and inline card editors. */
  compact?: boolean;
}) {
  const { state, failure, retrying, retryNow } = status;
  if (state === "idle") return null;

  const size = compact ? "h-[0.6875rem] w-[0.6875rem]" : "h-3 w-3";
  const text = compact ? "text-[0.65625rem]" : "text-xs";

  if (state === "saving") {
    return (
      <span className={`flex items-center gap-1.5 text-ink-600 ${text}`}>
        <Loader2 className={`${size} animate-spin`} />
        {compact ? "saving…" : "Saving…"}
      </span>
    );
  }

  if (state === "saved") {
    return (
      <span className={`flex items-center gap-1.5 text-ink-600 ${text}`}>
        <Check className={`${size} text-sage`} />
        {compact ? "saved" : "Saved"}
      </span>
    );
  }

  const needsReload = failure?.needsReload ?? false;
  return (
    <span className={`flex items-center gap-1.5 ${text}`}>
      <span
        className="flex items-center gap-1 text-red-400"
        title={failure?.message}
      >
        <AlertCircle className={size} />
        {retrying ? "save failed — retrying" : "save failed"}
      </span>
      <button
        type="button"
        onClick={needsReload ? () => window.location.reload() : retryNow}
        title={failure?.message}
        // pointer-events-auto: inline surfaces let clicks fall through the
        // status line to the text under it, but this button must stay live.
        className="pointer-events-auto rounded-md bg-red-500/12 px-1.5 py-0.5 font-medium text-red-300 hover:bg-red-500/20 hover:text-red-200"
      >
        {needsReload ? "Reload" : "Retry"}
      </button>
    </span>
  );
}

/**
 * The reason, in full, where the user can read it without hovering anything.
 * Renders nothing until a save actually fails.
 */
export function SaveFailureBanner({ status }: { status: SaveStatus }) {
  const { state, failure, retrying, retryNow } = status;
  if (state !== "error" || !failure) return null;

  const needsReload = failure.needsReload;
  return (
    <div
      role="status"
      className="flex flex-none items-center gap-2 border-b border-red-500/25 bg-red-500/8 px-4 py-2"
    >
      <AlertCircle className="h-3.5 w-3.5 flex-none text-red-400" />
      <span className="min-w-0 flex-1 text-[0.75rem] text-ink-300">
        {failure.message}
        {retrying && (
          <span className="text-ink-500"> Retrying automatically…</span>
        )}
      </span>
      <button
        type="button"
        onClick={needsReload ? () => window.location.reload() : retryNow}
        className="flex flex-none items-center gap-1 rounded-md bg-red-500/20 px-2 py-1 text-[0.6875rem] font-medium text-red-200 hover:bg-red-500/30"
      >
        {!needsReload && <RefreshCw className="h-3 w-3" />}
        {needsReload ? "Reload the page" : "Retry now"}
      </button>
    </div>
  );
}
