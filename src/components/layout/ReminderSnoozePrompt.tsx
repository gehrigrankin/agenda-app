"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BellRing, X } from "lucide-react";

import { snoozeTaskReminderAction } from "@/app/app/reminders/actions";
import { snoozeUntil, type SnoozeChoice } from "@/lib/reminder-snooze";

const CHOICES: { value: SnoozeChoice; label: string }[] = [
  { value: "10m", label: "10 min" },
  { value: "1h", label: "1 hour" },
  { value: "tonight", label: "Tonight" },
  { value: "tomorrow", label: "Tomorrow" },
];

/** In-app fallback for platforms that omit Web Notification action buttons. */
export function ReminderSnoozePrompt() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const taskId = params.get("snoozeTask");
  const [busy, setBusy] = useState<SnoozeChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!taskId) return null;

  const close = () => {
    const next = new URLSearchParams(params.toString());
    next.delete("snoozeTask");
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`);
  };
  const choose = async (choice: SnoozeChoice) => {
    setBusy(choice);
    setError(null);
    try {
      const ok = await snoozeTaskReminderAction(
        taskId,
        snoozeUntil(choice).toISOString(),
      );
      if (!ok) throw new Error("Task unavailable");
      close();
    } catch {
      setError("Couldn’t snooze this task. It may already be complete.");
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-x-3 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[70] mx-auto max-w-md rounded-2xl border border-white/12 bg-bar p-4 shadow-2xl md:bottom-5">
      <div className="flex items-start gap-3">
        <BellRing className="mt-0.5 h-5 w-5 flex-none text-sage" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink-100">Snooze reminder</p>
          <p className="mt-0.5 text-xs text-ink-500">
            The task’s due date won’t change.
          </p>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Close snooze"
          className="p-1 text-ink-500"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {CHOICES.map((choice) => (
          <button
            key={choice.value}
            type="button"
            disabled={busy !== null}
            onClick={() => void choose(choice.value)}
            className="min-h-11 rounded-xl border border-white/10 bg-white/5 text-sm font-medium text-ink-200 disabled:opacity-50"
          >
            {busy === choice.value ? "Snoozing…" : choice.label}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
