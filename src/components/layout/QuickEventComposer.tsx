"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Loader2, X } from "lucide-react";

import { createEventAction } from "@/app/app/calendar/actions";
import { localDateString } from "@/lib/dates";

/**
 * Mini calendar-event composer for the create menu: title + day + optional
 * start time. It writes through `createEventAction` — the same quick-add
 * layer /app/calendar uses — so an event added from the rail is the same row
 * the calendar edits. Deliberately a structured form rather than the
 * calendar's natural-language line: the menu has no month grid behind it to
 * confirm what the parser read, and a guessed day is worse than a picked one.
 *
 * No time = all-day, matching the calendar's own null `startMin`. The end
 * stays null rather than inventing an hour: a duration nobody typed would
 * show up as a block on the timeline.
 *
 * Dismissal contract (the parent enforces the outside-click half via
 * `dirtyRef`): once a title is typed, only X or Escape discards the draft.
 */
export function QuickEventComposer({
  dirtyRef,
  onClose,
}: {
  /** Parent-owned flag: true while the composer holds a typed title. */
  dirtyRef: React.MutableRefObject<boolean>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  // Today is client-local; this composer only ever renders after a click, so
  // reading the clock in the initializer can't desync an SSR pass.
  const [date, setDate] = useState(() => localDateString());
  const [time, setTime] = useState("");
  const [isCreating, startCreate] = useTransition();
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const onTitleChange = (next: string) => {
    setTitle(next);
    dirtyRef.current = next.trim().length > 0;
  };

  const create = () => {
    const safeTitle = title.trim();
    if (isCreating || !safeTitle || !date) return;
    startCreate(async () => {
      try {
        await createEventAction({
          title: safeTitle,
          date,
          startMin: hhmmToMinutes(time),
          endMin: null,
        });
        // /app/calendar refetches its own range on mount, but server-rendered
        // surfaces (home's day card) only update on a refresh.
        router.refresh();
        onClose();
      } catch (err) {
        console.error("[quick-event] create failed:", err);
        // Leave the draft intact so the user can retry.
      }
    });
  };

  const FIELD =
    "w-full rounded-md border border-white/10 bg-input px-2 py-1 text-[0.75rem] text-ink-100 outline-none disabled:opacity-60";

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 pb-1">
        <CalendarPlus className="h-3.5 w-3.5 flex-none text-sage" />
        <span className="min-w-0 flex-1 truncate text-[0.65625rem] font-medium uppercase tracking-wide text-ink-500">
          New event
        </span>
        <button
          type="button"
          aria-label="Discard"
          title="Discard"
          onClick={onClose}
          className="flex h-[1.375rem] w-[1.375rem] flex-none items-center justify-center rounded-md hover:bg-white/6"
        >
          <X className="h-3 w-3 text-ink-400" />
        </button>
      </div>

      <input
        ref={titleRef}
        value={title}
        disabled={isCreating}
        onChange={(e) => onTitleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") create();
        }}
        placeholder="Event title…"
        className="w-full border-b border-sage/50 bg-transparent px-0.5 py-1 text-[0.8125rem] font-medium text-ink-100 outline-none placeholder:text-ink-600 disabled:opacity-60"
      />

      <div className="flex items-end gap-2 pt-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[0.59375rem] uppercase tracking-wide text-ink-500">
            Day
          </span>
          <input
            type="date"
            value={date}
            disabled={isCreating}
            onChange={(e) => setDate(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
            className={FIELD}
          />
        </label>
        <label className="flex w-[6.5rem] flex-none flex-col gap-1">
          <span className="text-[0.59375rem] uppercase tracking-wide text-ink-500">
            Time (optional)
          </span>
          <input
            type="time"
            value={time}
            disabled={isCreating}
            onChange={(e) => setTime(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
            className={FIELD}
          />
        </label>
      </div>

      <div className="flex items-center gap-2 border-t border-white/7 pt-1.5 mt-2">
        <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-ink-600">
          {time ? "Starts at the time you picked" : "All day"}
        </span>
        <button
          type="button"
          disabled={isCreating || !title.trim()}
          onClick={create}
          className="flex flex-none items-center gap-1.5 rounded-lg bg-sage/16 px-3 py-1.5 text-[0.75rem] font-semibold text-sage hover:bg-sage/24 disabled:opacity-60"
        >
          {isCreating && <Loader2 className="h-3 w-3 animate-spin" />}
          Create
        </button>
      </div>
    </div>
  );
}

/** "HH:MM" (what <input type="time"> yields) → minutes past midnight. */
function hhmmToMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}
