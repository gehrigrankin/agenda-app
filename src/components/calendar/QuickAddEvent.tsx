"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";

import { createEventAction } from "@/app/app/calendar/actions";
import { addDays, formatShortDate } from "@/lib/dates";
import { useOutsideClose } from "@/lib/hooks/use-outside-close";
import { parseQuickEvent } from "@/lib/quick-event";
import { formatTimeShort } from "@/lib/recurrence";

import { minutesToHHMM } from "./calendar-items";

/**
 * The one-line natural-language event input ("coffee w/ Sam fri 3pm").
 * Collapsed it's the design's dashed "Add event" row; expanded it parses on
 * every keystroke via lib/quick-event and previews the date/time it read.
 * When the text names no day, the event lands on `fallbackDay`; when it
 * names no time, a slot click's `defaultStartMin`/`defaultEndMin` apply (the
 * desktop time grid opens it on the clicked slot), else it's all-day.
 */
export function QuickAddEvent({
  expanded,
  fallbackDay,
  today,
  onOpen,
  onClose,
  onCreated,
  defaultStartMin = null,
  defaultEndMin = null,
  placeholder = "coffee w/ Sam fri 3pm",
}: {
  expanded: boolean;
  fallbackDay: string;
  today: string;
  onOpen?: () => void;
  onClose: () => void;
  onCreated: () => void;
  defaultStartMin?: number | null;
  defaultEndMin?: number | null;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  /** Optional inclusive last day — the multi-day half the text parser has no
   * phrase for. Empty = single-day, which is every event until you say so. */
  const [endDate, setEndDate] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  // Escape always closes; a stray outside press only closes an EMPTY bar —
  // same rule as the note composer, since half-typed text is work.
  useOutsideClose(expanded, boxRef, (via) => {
    if (via === "escape" || !value.trim()) onClose();
  });

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-2 rounded-xl border border-dashed border-white/16 px-3 py-[0.6875rem] text-left hover:border-sage/50 hover:bg-sage/5"
      >
        <Plus className="h-3.5 w-3.5 flex-none text-ink-400" />
        <span className="truncate text-[0.78125rem] text-ink-400">
          Add event — try &ldquo;coffee w/ Sam fri 3pm&rdquo;
        </span>
      </button>
    );
  }

  const parsed = value.trim() ? parseQuickEvent(value, today) : null;
  // No time typed: fall back to the slot the composer was opened on.
  const parse =
    parsed && parsed.startMin === null && defaultStartMin !== null
      ? {
          ...parsed,
          startMin: defaultStartMin,
          endMin: defaultEndMin ?? Math.min(1440, defaultStartMin + 60),
        }
      : parsed;
  const startDay = parse?.date ?? fallbackDay;
  // An end on or before the start isn't a span (the server agrees, and drops
  // it) — treat it as unset here so the preview never promises one.
  const spanEnd = endDate && endDate > startDay ? endDate : null;
  const preview = parse
    ? `${formatShortDate(startDay)}${
        spanEnd ? ` – ${formatShortDate(spanEnd)}` : ""
      }${
        parse.startMin !== null
          ? ` · ${formatTimeShort(minutesToHHMM(parse.startMin))}${
              parse.endMin !== null
                ? ` – ${formatTimeShort(minutesToHHMM(parse.endMin))}`
                : ""
            }`
          : " · all day"
      }`
    : "type an event — a day and time in plain words works";

  const submit = async () => {
    if (!parse || saving) return;
    setSaving(true);
    try {
      await createEventAction({
        title: parse.title,
        date: startDay,
        endDate: spanEnd,
        startMin: parse.startMin,
        endMin: parse.endMin,
      });
      setValue("");
      setEndDate("");
      onCreated();
      onClose();
    } catch (err) {
      console.error("[calendar] create event failed:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      ref={boxRef}
      className="rounded-xl border-[1.5px] border-dashed border-sage/50 bg-sage/5 px-3 py-2"
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        disabled={saving}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        className="w-full bg-transparent text-[0.875rem] text-ink-100 placeholder:text-ink-600 focus:outline-none"
      />
      {/* The one picker on this surface: multi-day is a date, not a phrase —
          "through friday" reads fine but guesses wrong often enough that the
          span would be a lie. Native date input, so phones get their own. */}
      <label className="mt-1 flex items-center gap-1.5 text-[0.6875rem] text-ink-500">
        Ends
        <input
          type="date"
          value={endDate}
          min={addDays(startDay, 1)}
          disabled={saving}
          onChange={(e) => setEndDate(e.target.value)}
          className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[0.6875rem] text-ink-200 focus:outline-none focus:ring-1 focus:ring-sage/40"
        />
        {endDate && (
          <button
            type="button"
            onClick={() => setEndDate("")}
            className="rounded px-1 text-[0.6875rem] text-ink-500 hover:bg-white/6 hover:text-ink-300"
          >
            clear
          </button>
        )}
      </label>
      <div className="mt-0.5 flex items-center gap-2">
        <span
          className={`min-w-0 flex-1 truncate text-[0.6875rem] ${
            parse ? "text-sage" : "text-ink-600"
          }`}
        >
          {preview}
        </span>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!parse || saving}
          className="flex-none rounded-md bg-sage/16 px-2 py-0.5 text-[0.6875rem] font-semibold text-sage disabled:opacity-40"
        >
          {saving ? "Adding…" : "Add ↵"}
        </button>
      </div>
    </div>
  );
}
