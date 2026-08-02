"use client";

import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";

import {
  getAiSettingsAction,
  setCalendarUrlAction,
} from "@/app/app/ai/actions";

/**
 * Settings row for the ICS calendar feed that powers Meeting Mode's
 * scaffolds and the calendar's imported events. Previously this URL could
 * only be set from a dismissible home-page card (MeetingModeCard's
 * ConnectAffordance) — once dismissed there was no way back in. This row is
 * the permanent connect/disconnect surface; the home card still offers a
 * quick first-connect shortcut.
 */

/** Middle-truncate a long URL so it fits a single settings row. */
function truncateUrl(url: string): string {
  if (url.length <= 46) return url;
  return `${url.slice(0, 28)}…${url.slice(-14)}`;
}

export function CalendarFeedRow() {
  // undefined = loading, null = not connected, string = connected URL.
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAiSettingsAction()
      .then((settings) => {
        if (!cancelled) setUrl(settings.calendarIcsUrl);
      })
      .catch((err) => {
        console.error("[settings] calendar feed load failed:", err);
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      await setCalendarUrlAction(trimmed);
      setUrl(trimmed);
      setDraft("");
    } catch {
      setError("Couldn't save that link");
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    setSaving(true);
    setError(null);
    try {
      await setCalendarUrlAction(null);
      setUrl(null);
    } catch {
      setError("Couldn't disconnect");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-[3.25rem] flex-col gap-2 border-t border-white/6 px-3.5 py-3">
      <div className="flex items-center gap-3">
        <CalendarDays className="h-[1.0625rem] w-[1.0625rem] flex-none text-ink-400" />
        <span className="flex-1 text-[0.875rem] font-medium text-ink-200">
          Calendar feed
        </span>
        {url === undefined ? (
          <span className="text-xs text-ink-600">Loading…</span>
        ) : url ? (
          <span className="truncate text-xs text-ink-500">
            {truncateUrl(url)}
          </span>
        ) : (
          <span className="text-xs text-ink-600">Not connected</span>
        )}
      </div>

      {url === undefined ? null : url ? (
        <div className="flex items-center gap-2 pl-[1.8125rem]">
          <button
            type="button"
            onClick={() => void disconnect()}
            disabled={saving}
            className="flex-none rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[0.71875rem] font-medium text-ink-300 hover:bg-white/8 disabled:opacity-50"
          >
            {saving ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 pl-[1.8125rem]">
          <input
            type="url"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="paste your calendar's ICS / webcal link"
            className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-[0.75rem] text-ink-200 placeholder:text-ink-600 focus:outline-none focus:ring-1 focus:ring-sage/40"
          />
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !draft.trim()}
            className="flex-none rounded-md bg-sage px-2.5 py-1.5 text-[0.71875rem] font-semibold text-sage-ink disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {error && (
            <span className="text-[0.65625rem] text-[#D9938A]">{error}</span>
          )}
        </div>
      )}
    </div>
  );
}
