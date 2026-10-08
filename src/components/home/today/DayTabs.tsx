"use client";

import { DOW_LETTER, dayOfMonth, dayRel } from "@/lib/agenda-today";

import type { DayView } from "./useTodayAgenda";

export type DayDot = "late" | "due" | "open" | null;

/** The dot under a day tab: carried work, work still due, or today's open. */
export function dayDot(view: DayView | null): DayDot {
  if (!view) return null;
  const open = view.tasks.some((t) => !t.done);
  if (view.rel === "past") return view.tasks.some((t) => t.carried && !t.done) ? "late" : null;
  if (view.rel === "future") return open ? "due" : null;
  return open ? "open" : null;
}

/**
 * One printed day tab (M / 9 / dot). Used seven across on phone, and stacked
 * as the folded week strip on tablet/desktop.
 */
export function DayTab({
  date,
  today,
  index,
  selected,
  dot,
  onSelect,
  narrow = false,
}: {
  date: string;
  today: string;
  index: number;
  selected: boolean;
  dot: DayDot;
  onSelect: () => void;
  narrow?: boolean;
}) {
  const rel = dayRel(date, today);
  const isToday = rel === "today";
  const weekend = index >= 5;

  let box: string;
  let letter: string;
  let num: string;
  if (selected) {
    box = isToday ? "bg-sage border border-transparent" : "bg-ink-100 border border-transparent";
    letter = "text-sage-ink";
    num = "text-sage-ink font-bold";
  } else if (isToday) {
    box = "bg-sage/6 border-[1.5px] border-sage";
    letter = "text-sage";
    num = "text-sage font-semibold";
  } else if (rel === "past") {
    box = "bg-white/2 border border-transparent";
    letter = "text-ink-700";
    num = "text-ink-600 font-medium";
  } else {
    box = "bg-white/4 border border-white/7";
    letter = "text-ink-500";
    num = `${weekend ? "text-ink-350" : "text-ink-200"} font-medium`;
  }

  const dotColor =
    dot === "late"
      ? "bg-overdue"
      : dot === "due"
        ? "bg-steel"
        : dot === "open"
          ? selected
            ? "bg-sage-ink"
            : "bg-sage"
          : "bg-transparent";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={date}
      className={`flex h-[3.375rem] flex-col items-center justify-center gap-1 rounded-[0.625rem] ${box} ${
        narrow ? "w-[2.875rem] flex-none" : "min-w-0"
      }`}
    >
      <span className={`font-mono text-[0.625rem] font-semibold leading-none ${letter}`}>
        {DOW_LETTER[index]}
      </span>
      <span className={`text-[0.9375rem] leading-none ${num}`}>{dayOfMonth(date)}</span>
      <span aria-hidden className={`h-1 w-1 rounded-sm ${dotColor}`} />
    </button>
  );
}
