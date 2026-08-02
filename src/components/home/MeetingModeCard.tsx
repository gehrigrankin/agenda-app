"use client";

import { useCallback, useEffect, useState, type MutableRefObject } from "react";
import { useUser } from "@clerk/nextjs";
import type { LexicalEditor } from "lexical";
import { $createTextNode, $getRoot } from "lexical";
import { $createHeadingNode } from "@lexical/rich-text";
import {
  CalendarCheck,
  CalendarPlus,
  History,
  PenLine,
  X,
} from "lucide-react";

import {
  declineMeetingAction,
  getTodayMeetingsAction,
  setCalendarUrlAction,
} from "@/app/app/ai/actions";
import type { MeetingAttendee, TodayMeeting } from "@/server/calendar";
import { $createTaskNode } from "@/components/editor/nodes/TaskNode";
import { $createTimedParagraphNode } from "@/components/editor/nodes/TimedParagraphNode";
import { localDayBounds } from "@/lib/dates";

/**
 * Design 14c — meeting mode: when the calendar says you're in a meeting
 * today, the daily note offers a scaffold (attendees, a count of open items
 * carried from the last time you met, an empty paragraph to start typing
 * into). Self-contained: fetches its own data, owns its own sessionStorage
 * flags, and writes into the note only through `editorRef` on explicit user
 * action. Open items are shown as a COUNT line only (their rows live in the
 * tasks widget — CONTEXT.md §product coherence), but "Add to note" still
 * inserts them into the scaffold: that's its job. Availability is reported
 * up to DailyStack via `onStatusChange`; `collapsed` keeps the card mounted
 * (fetching, reporting) while rendering nothing except the connect
 * affordance, which is quiet chrome outside the one-card budget.
 */

const CONNECT_HIDDEN_KEY = "meeting-connect-hidden";
const addedKey = (uid: string) => `meeting-added-${uid}`;

function readSessionFlag(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function setSessionFlag(key: string) {
  try {
    sessionStorage.setItem(key, "1");
  } catch {
    // sessionStorage unavailable — the flag just won't persist for the tab.
  }
}

/** Up to 2 letters from a name, else the email's first letter. */
function attendeeInitials(a: MeetingAttendee): string {
  const name = a.name?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }
  const email = a.email?.trim();
  return email ? email[0].toUpperCase() : "?";
}

function clockParts(iso: string): { time: string; meridiem: "AM" | "PM" } {
  const d = new Date(iso);
  const h24 = d.getHours();
  const m = d.getMinutes();
  const meridiem: "AM" | "PM" = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { time: `${h12}:${String(m).padStart(2, "0")}`, meridiem };
}

/** "2:00 – 2:30 PM · from calendar" (or open-ended: "2:00 PM · from calendar"). */
function formatTimeCaption(startIso: string, endIso: string | null): string {
  const start = clockParts(startIso);
  if (!endIso) return `${start.time} ${start.meridiem} · from calendar`;
  const end = clockParts(endIso);
  const startLabel =
    start.meridiem === end.meridiem
      ? start.time
      : `${start.time} ${start.meridiem}`;
  return `${startLabel} – ${end.time} ${end.meridiem} · from calendar`;
}

/** "2:00 PM" for the heading inserted into the note. */
function formatClockLabel(iso: string): string {
  const { time, meridiem } = clockParts(iso);
  return `${time} ${meridiem}`;
}

/** "YYYY-MM-DD" -> "Jun 24" */
function formatLastMet(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** The instant the meeting stops counting as "current" — its end, or +30m if open-ended. */
function meetingEndMs(m: TodayMeeting): number {
  if (m.endIso) return new Date(m.endIso).getTime();
  return new Date(m.startIso).getTime() + 30 * 60_000;
}

function ConnectAffordance({ onConnected }: { onConnected: () => void }) {
  const [hidden, setHidden] = useState(() => readSessionFlag(CONNECT_HIDDEN_KEY));
  const [expanded, setExpanded] = useState(false);
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (hidden) return null;

  const hide = () => {
    setSessionFlag(CONNECT_HIDDEN_KEY);
    setHidden(true);
  };

  const save = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      await setCalendarUrlAction(trimmed);
      onConnected();
    } catch {
      setError("Couldn't save that link");
      setSaving(false);
      return;
    }
    setSaving(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 px-1 py-1">
      <CalendarPlus className="h-3 w-3 flex-none text-ink-500" />
      <span className="text-[0.6875rem] text-ink-500">
        Connect your calendar for meeting scaffolds
      </span>
      {!expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex-none text-[0.6875rem] font-medium text-ink-400 hover:text-ink-300"
        >
          Add ICS link
        </button>
      ) : (
        <>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="paste your calendar's ICS / webcal link"
            className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[0.6875rem] text-ink-200 placeholder:text-ink-600 focus:outline-none focus:ring-1 focus:ring-sage/40"
          />
          <button
            type="button"
            onClick={save}
            disabled={saving || !url.trim()}
            className="flex-none rounded-md bg-sage px-2 py-1 text-[0.6875rem] font-semibold text-sage-ink disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {error && (
            <span className="text-[0.625rem] text-[#D9938A]">{error}</span>
          )}
        </>
      )}
      <button
        type="button"
        onClick={hide}
        className="ml-auto flex-none text-[0.625rem] text-ink-600 hover:text-ink-400"
      >
        hide
      </button>
    </div>
  );
}

export function MeetingModeCard({
  isToday,
  dateStr,
  todayNoteId,
  editorRef,
  collapsed = false,
  onStatusChange,
}: {
  isToday: boolean;
  dateStr: string | null;
  todayNoteId: string | null;
  editorRef: MutableRefObject<LexicalEditor | null>;
  /** Stay mounted (fetch + report) but render nothing card-shaped. */
  collapsed?: boolean;
  /** null while loading; true when a meeting scaffold is offerable. */
  onStatusChange?: (available: boolean | null) => void;
}) {
  const { user } = useUser();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [meetings, setMeetings] = useState<TodayMeeting[] | null>(null);
  const [decliningUid, setDecliningUid] = useState<string | null>(null);
  // Only ever bumped to force a re-render after an "add to note" flips a
  // sessionStorage flag — the flag itself, not this counter, is what matters.
  const [, forceRecheck] = useState(0);

  const load = useCallback(() => {
    if (!dateStr) return;
    const { start, end } = localDayBounds(dateStr);
    getTodayMeetingsAction(start.toISOString(), end.toISOString(), todayNoteId)
      .then((res) => {
        setConfigured(res.configured);
        setMeetings(res.meetings);
      })
      .catch((err) => {
        console.error("[meeting-mode] load failed:", err);
        // Resolve as "no meetings" so the coordinator's digest row settles
        // instead of waiting forever on this card.
        setConfigured(null);
        setMeetings([]);
      });
  }, [dateStr, todayNoteId]);

  useEffect(() => {
    if (isToday && dateStr) load();
  }, [isToday, dateStr, load]);

  const now = Date.now();
  const candidates = (meetings ?? [])
    .filter((m) => meetingEndMs(m) > now)
    .filter((m) => !readSessionFlag(addedKey(m.uid)))
    .sort((a, b) => a.startIso.localeCompare(b.startIso));

  const available: boolean | null =
    !isToday || !dateStr || configured === false
      ? false
      : meetings === null
        ? null
        : candidates.length > 0;
  useEffect(() => {
    onStatusChange?.(available);
  }, [available, onStatusChange]);

  if (!isToday || !dateStr) return null;

  // Not configured: the connect affordance is quiet chrome, not a card — it
  // renders regardless of the slot (the card reported unavailable above).
  if (configured === false) {
    return <ConnectAffordance onConnected={load} />;
  }

  // Loading (no skeleton — stay quiet), collapsed to a digest chip, or
  // nothing current to scaffold.
  if (collapsed || candidates.length === 0) return null;

  const meeting = candidates[0];
  const moreCount = candidates.length - 1;
  const youInitial = (user?.firstName?.[0] ?? user?.fullName?.[0] ?? "Y").toUpperCase();

  const decline = async (uid: string) => {
    setDecliningUid(uid);
    setMeetings((prev) => (prev ? prev.filter((m) => m.uid !== uid) : prev));
    try {
      await declineMeetingAction(uid);
    } catch (err) {
      console.error("[meeting-mode] decline failed:", err);
    } finally {
      setDecliningUid(null);
    }
  };

  const addToNote = () => {
    const editor = editorRef.current;
    if (!editor || !todayNoteId) return;
    editor.update(() => {
      const root = $getRoot();
      const heading = $createHeadingNode("h3");
      heading.append(
        $createTextNode(`${meeting.title} — ${formatClockLabel(meeting.startIso)}`),
      );
      root.append(heading);
      for (const item of meeting.openItems) {
        root.append($createTaskNode({ taskId: item.taskId, title: item.title }));
      }
      const trailing = $createTimedParagraphNode();
      root.append(trailing);
      trailing.select();
    });
    setSessionFlag(addedKey(meeting.uid));
    editor.focus();
    forceRecheck((v) => v + 1);
  };

  const canAddToNote = Boolean(editorRef.current) && Boolean(todayNoteId);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="overflow-hidden rounded-[0.8125rem] border border-steel/28 bg-steel/5">
        <div className="flex items-center gap-2 border-b border-steel/15 px-4 py-3">
          <CalendarCheck className="h-3.5 w-3.5 flex-none text-steel" />
          <span className="truncate text-[0.8125rem] font-semibold text-ink-100">
            {meeting.title}
          </span>
          <span className="truncate text-[0.6875rem] text-ink-600">
            {formatTimeCaption(meeting.startIso, meeting.endIso)}
          </span>
          <span className="ml-auto flex flex-none items-center">
            {meeting.attendees.slice(0, 3).map((a, i) => (
              <span
                key={i}
                className={`flex h-[1.375rem] w-[1.375rem] flex-none items-center justify-center rounded-full bg-[#2a2e30] text-[0.59375rem] font-semibold text-ink-300 ${
                  i > 0 ? "-ml-2" : ""
                }`}
              >
                {attendeeInitials(a)}
              </span>
            ))}
            <span
              className={`flex h-[1.375rem] w-[1.375rem] flex-none items-center justify-center rounded-full bg-sage text-[0.59375rem] font-semibold text-sage-ink ${
                meeting.attendees.length > 0 ? "-ml-2" : ""
              }`}
            >
              {youInitial}
            </span>
            <button
              type="button"
              onClick={addToNote}
              disabled={!canAddToNote}
              className="ml-3 flex-none text-[0.71875rem] font-semibold text-sage hover:text-sage/80 disabled:opacity-40"
            >
              Add to note
            </button>
            <button
              type="button"
              onClick={() => decline(meeting.uid)}
              disabled={decliningUid === meeting.uid}
              title="Not for this meeting"
              className="ml-2 flex-none text-ink-600 hover:text-ink-400 disabled:opacity-40"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>

        {/* Count only — the rows' one home is the tasks widget's CARRIED
            OVER section. "Add to note" still inserts these items. */}
        {meeting.openItems.length > 0 && (
          <div className="flex items-center gap-1.5 px-4 pt-3">
            <History className="h-[0.6875rem] w-[0.6875rem] flex-none text-ink-400" />
            <span className="min-w-0 truncate text-[0.6875rem] text-ink-400">
              {meeting.openItems.length} still open from your last{" "}
              {meeting.title}
              {meeting.lastMetDate
                ? ` · ${formatLastMet(meeting.lastMetDate)}`
                : ""}
              <span className="text-ink-600"> — Add to note includes them</span>
            </span>
          </div>
        )}

        <div className="flex items-center gap-1.5 px-4 pb-3 pt-2">
          <PenLine className="h-[0.6875rem] w-[0.6875rem] flex-none text-ink-400" />
          <span className="text-[0.625rem] font-medium text-ink-400">
            notes — lines starting with @ become action items
          </span>
        </div>
      </div>
      {moreCount > 0 && (
        <div className="px-1 text-[0.65625rem] text-ink-600">
          +{moreCount} more today
        </div>
      )}
    </div>
  );
}
