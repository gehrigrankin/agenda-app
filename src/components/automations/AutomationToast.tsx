"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Wand2 } from "lucide-react";

import { undoAutomationRunAction } from "@/app/app/ai/actions";
import { TASKS_CHANGED_EVENT } from "@/components/layout/NavRail";

/** Same event name use-note-autosave dispatches — literal in both files (no
 * shared constants module for a single string). */
const AUTOMATIONS_RAN_EVENT = "agenda:automations-ran";

export interface AutomationRanDetail {
  runId: string;
  summary: string;
  canUndo: boolean;
}

interface Toast extends AutomationRanDetail {
  undone: boolean;
}

const DISMISS_MS = 8000;

/**
 * Quiet bottom-right confirmations when an automation acts (design 14e: every
 * action visible, every action undoable). Mounted once in AppShell; fed by a
 * window event so the autosave hook doesn't need UI plumbing.
 */
export function AutomationToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = (runId: string) => {
    const timer = timersRef.current.get(runId);
    if (timer) clearTimeout(timer);
    timersRef.current.delete(runId);
    setToasts((prev) => prev.filter((t) => t.runId !== runId));
  };

  useEffect(() => {
    const timers = timersRef.current;
    const onRan = (event: Event) => {
      const detail = (event as CustomEvent<AutomationRanDetail[]>).detail;
      if (!Array.isArray(detail)) return;
      for (const item of detail) {
        if (!item?.runId || !item.summary) continue;
        setToasts((prev) =>
          prev.some((t) => t.runId === item.runId)
            ? prev
            : [...prev, { ...item, undone: false }],
        );
        if (!timers.has(item.runId)) {
          timers.set(
            item.runId,
            setTimeout(() => dismiss(item.runId), DISMISS_MS),
          );
        }
      }
    };
    window.addEventListener(AUTOMATIONS_RAN_EVENT, onRan);
    return () => {
      window.removeEventListener(AUTOMATIONS_RAN_EVENT, onRan);
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const undo = (runId: string) => {
    setToasts((prev) =>
      prev.map((t) => (t.runId === runId ? { ...t, undone: true } : t)),
    );
    undoAutomationRunAction(runId)
      .then(() => {
        window.dispatchEvent(new CustomEvent(TASKS_CHANGED_EVENT));
      })
      .catch(() => {
        // The Automations page still offers undo if this transiently failed.
      })
      .finally(() => {
        const timer = timersRef.current.get(runId);
        if (timer) clearTimeout(timer);
        timersRef.current.set(
          runId,
          setTimeout(() => dismiss(runId), 1500),
        );
      });
  };

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-16 right-4 z-50 flex flex-col items-end gap-2 md:bottom-4">
      {toasts.map((toast) => (
        <div
          key={toast.runId}
          className="animate-pop-in pointer-events-auto flex max-w-[24rem] items-center gap-2.5 rounded-xl border border-white/10 bg-panel px-3 py-2 shadow-2xl"
        >
          {toast.undone ? (
            <Check className="h-3.5 w-3.5 flex-none text-ink-500" />
          ) : (
            <Wand2 className="h-3.5 w-3.5 flex-none text-tan" />
          )}
          <span className="min-w-0 flex-1 truncate text-[0.75rem] text-ink-200">
            {toast.undone ? "Undone" : toast.summary}
          </span>
          {toast.canUndo && !toast.undone && (
            <button
              type="button"
              onClick={() => undo(toast.runId)}
              className="flex-none text-[0.71875rem] font-medium text-ink-400 hover:text-ink-200"
            >
              Undo
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
