"use client";

import { useRef, useState } from "react";
import { Bell, FileText, PenLine, Repeat, Star } from "lucide-react";

import { addDays, formatShortDate, parseLocalDate } from "@/lib/dates";
import type { RecurrenceSpec } from "@/lib/recurrence";

/**
 * Task filters shared by the Tasks pages.
 *
 * `TaskFilter` / `matchesTaskFilter` are the one predicate both Tasks layouts
 * run rows through (the phone's folder chip uses `board`). The desktop page's
 * Sidebar 1 hosts the two visual controls exported here:
 *
 *  1. **Workload strip** — a 15-bucket bar chart (overdue, then the next 14
 *     days) of open tasks by due day. Click a bar or drag across several to
 *     pick that window. This is the part a chip row can't do: you see *where
 *     the pile-ups are* and grab them directly.
 *  2. **Trait chips** — the categorical narrowing (important, recurs,
 *     reminds, came from a note, standalone), with faceted counts: a chip's
 *     number is what the list would hold with it on, so it never promises
 *     rows a second filter would hide.
 *
 * All filtering is client-side over tasks the page already loaded.
 */

export type TaskLens =
  | "all"
  | "overdue"
  | "today"
  | "week"
  | "later"
  | "nodate";
export type TaskTrait =
  | "important"
  | "recurring"
  | "reminder"
  | "note"
  | "solo";

/** Inclusive due-day window brushed on the strip. `start: null` means "all
 *  days up to `end`" — the strip's leading overdue bucket has no floor. */
export type DayRange = { start: string | null; end: string };

export type TaskFilter = {
  lens: TaskLens;
  range: DayRange | null;
  board: string | null;
  traits: TaskTrait[];
  /** Tag ids, OR-ed: a task matches if it carries ANY of them. */
  tags: string[];
};

export const EMPTY_TASK_FILTER: TaskFilter = {
  lens: "all",
  range: null,
  board: null,
  traits: [],
  tags: [],
};

export function isFilterActive(f: TaskFilter): boolean {
  return (
    f.lens !== "all" ||
    f.range !== null ||
    f.board !== null ||
    f.traits.length > 0 ||
    f.tags.length > 0
  );
}

/** How many distinct narrowings are on — the badge next to "Filters". */
export function activeFilterCount(f: TaskFilter): number {
  return (
    (f.lens !== "all" ? 1 : 0) +
    (f.range !== null ? 1 : 0) +
    (f.board !== null ? 1 : 0) +
    f.traits.length +
    // Several tags OR-ed together are one narrowing, not several.
    (f.tags.length > 0 ? 1 : 0)
  );
}

/**
 * The shape every task list on the page is normalized to before filtering.
 * `recurring`/`remindAt`/`noteId` are null for rows whose source query didn't
 * carry them; the page fills those in from its other lists where it can.
 */
export type FilterableTask = {
  due: string | null;
  important: boolean;
  boardTitle: string | null;
  recurring: RecurrenceSpec | null;
  remindAt: string | null;
  noteId: string | null;
  tags: { id: string; name: string; color: string | null }[];
};

/** Last day of the "next 7 days" lens (also the strip's first week). */
function weekEndOf(today: string): string {
  return addDays(today, 7);
}

function matchesLens(
  due: string | null,
  lens: TaskLens,
  today: string,
): boolean {
  switch (lens) {
    case "all":
      return true;
    case "overdue":
      return due !== null && due < today;
    case "today":
      return due === today;
    case "week":
      return due !== null && due > today && due <= weekEndOf(today);
    case "later":
      return due !== null && due > weekEndOf(today);
    case "nodate":
      return due === null;
  }
}

/** The single predicate every list on the page runs its rows through. */
export function matchesTaskFilter(
  t: FilterableTask,
  f: TaskFilter,
  today: string,
): boolean {
  if (!matchesLens(t.due, f.lens, today)) return false;
  if (f.range) {
    if (t.due === null) return false;
    if (f.range.start !== null && t.due < f.range.start) return false;
    if (t.due > f.range.end) return false;
  }
  if (f.board !== null && t.boardTitle !== f.board) return false;
  // Tags are OR-ed: two selected tags widen the result, they don't intersect
  // it. AND-ing them empties the list on the second click, which reads as a
  // broken filter rather than a precise one.
  if (f.tags.length > 0 && !t.tags.some((tag) => f.tags.includes(tag.id))) {
    return false;
  }
  for (const trait of f.traits) {
    if (trait === "important" && !t.important) return false;
    if (trait === "recurring" && !t.recurring) return false;
    if (trait === "reminder" && !t.remindAt) return false;
    if (trait === "note" && !t.noteId) return false;
    if (trait === "solo" && t.noteId) return false;
  }
  return true;
}

/** "Aug 11 – Aug 13", or "Aug 11" when the brush covers one day. */
export function describeRange(r: DayRange): string {
  if (r.start === null) return `through ${formatDay(r.end)}`;
  if (r.start === r.end) return formatDay(r.start);
  return `${formatDay(r.start)} – ${formatDay(r.end)}`;
}

function formatDay(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Single-letter weekday under a strip bar. */
function weekdayLetter(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString("en-US", {
    weekday: "narrow",
  });
}

const STRIP_DAYS = 14;
/** Bucket 0 is "overdue"; buckets 1..STRIP_DAYS are today + n-1. */
const BUCKETS = STRIP_DAYS + 1;

const TRAITS: { id: TaskTrait; label: string; Icon: typeof Repeat }[] = [
  { id: "important", label: "Important", Icon: Star },
  { id: "recurring", label: "Recurring", Icon: Repeat },
  { id: "reminder", label: "Reminder", Icon: Bell },
  { id: "note", label: "From a note", Icon: FileText },
  { id: "solo", label: "Standalone", Icon: PenLine },
];

/** Selecting one of these deselects the other — they're complements. */
const OPPOSITE: Partial<Record<TaskTrait, TaskTrait>> = {
  note: "solo",
  solo: "note",
};

/**
 * The workload strip. `tasks` are the open tasks to chart (the caller applies
 * any categorical filters first); `range` is the brushed window, if any.
 * The overdue bucket's range has no floor (`start: null`).
 */
export function WorkloadStrip({
  tasks,
  today,
  range,
  onRangeChange,
}: {
  tasks: FilterableTask[];
  today: string;
  range: DayRange | null;
  onRangeChange: (next: DayRange | null) => void;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  /** Bucket the current drag started on, or null when not dragging. */
  const dragStart = useRef<number | null>(null);
  /** The drag began on the sole selected bucket, so a *tap* (press and
   *  release without leaving it) clears the brush — but dragging off it
   *  widens the selection instead. Deciding on release rather than on press
   *  is what makes "grab the selected day and pull" work. */
  const tapClears = useRef(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const days: string[] = today
    ? Array.from({ length: STRIP_DAYS }, (_, i) => addDays(today, i))
    : [];

  const bucketCounts = Array.from(
    { length: BUCKETS },
    (_, i) =>
      tasks.filter((t) =>
        t.due === null
          ? false
          : i === 0
            ? t.due < today
            : t.due === days[i - 1],
      ).length,
  );
  // The overdue pile is unbounded and routinely dwarfs a single day — scaling
  // the chart to it would flatten the 14-day runway the chart exists to show.
  // Days set the scale; the overdue bar just pegs at full height.
  const dayMax = Math.max(1, ...bucketCounts.slice(1));

  const bucketDay = (i: number) => (i === 0 ? null : days[i - 1]);
  const rangeFor = (a: number, b: number): DayRange => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return {
      start: bucketDay(lo),
      end: hi === 0 ? addDays(today, -1) : days[hi - 1],
    };
  };
  const sameRange = (a: DayRange | null, b: DayRange) =>
    a !== null && a.start === b.start && a.end === b.end;

  /** A bucket is lit when the active brush covers its day. */
  const bucketSelected = (i: number) => {
    if (!range) return false;
    if (i === 0) return range.start === null;
    const d = days[i - 1];
    return (range.start === null || d >= range.start) && d <= range.end;
  };

  const indexAt = (clientX: number): number | null => {
    const el = stripRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return null;
    const i = Math.floor(((clientX - rect.left) / rect.width) * BUCKETS);
    return Math.min(BUCKETS - 1, Math.max(0, i));
  };

  /** Select just this bucket, or clear when it's already the sole selection. */
  const toggleBucket = (i: number) => {
    if (sameRange(range, rangeFor(i, i))) onRangeChange(null);
    else onRangeChange(rangeFor(i, i));
  };

  const brushedCount = range
    ? tasks.filter((t) =>
        matchesTaskFilter(t, { ...EMPTY_TASK_FILTER, range }, today),
      ).length
    : 0;

  return (
    <div className="px-4 pb-3">
      <div
        ref={stripRef}
        onPointerDown={(e) => {
          const i = indexAt(e.clientX);
          if (i === null) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          dragStart.current = i;
          setDragging(true);
          tapClears.current = sameRange(range, rangeFor(i, i));
          if (!tapClears.current) onRangeChange(rangeFor(i, i));
        }}
        onPointerMove={(e) => {
          const i = indexAt(e.clientX);
          if (i === null) return;
          setHovered(i);
          if (dragStart.current === null) return;
          // Leaving the bucket turns a would-be clearing tap into a drag.
          if (i !== dragStart.current) tapClears.current = false;
          onRangeChange(rangeFor(dragStart.current, i));
        }}
        onPointerUp={() => {
          if (dragStart.current !== null && tapClears.current) {
            onRangeChange(null);
          }
          dragStart.current = null;
          tapClears.current = false;
          setDragging(false);
        }}
        onPointerCancel={() => {
          dragStart.current = null;
          tapClears.current = false;
          setDragging(false);
        }}
        onPointerLeave={() => setHovered(null)}
        className="flex h-[3.25rem] cursor-crosshair touch-none items-end gap-[0.1875rem] select-none"
      >
        {bucketCounts.map((count, i) => {
          const selected = bucketSelected(i);
          const day = bucketDay(i);
          const isToday = i === 1;
          const label =
            i === 0
              ? `Overdue — ${count} task${count === 1 ? "" : "s"}`
              : `${formatShortDate(day!)} — ${count} task${count === 1 ? "" : "s"}`;
          return (
            <button
              key={i}
              type="button"
              aria-label={label}
              aria-pressed={selected}
              title={label}
              // Pointer input is handled by the container (so a drag can
              // cross bars); this fires only for keyboard and AT clicks,
              // which report detail 0.
              onClick={(e) => {
                if (e.detail === 0) toggleBucket(i);
              }}
              className={`group flex h-full flex-1 flex-col justify-end focus-visible:outline-2 focus-visible:outline-sage/70 ${
                i === 0 ? "border-r border-white/10 pr-[0.1875rem]" : ""
              }`}
            >
              {/* Explicit track height — the container's 3.25rem minus the
                  weekday label's 0.5625rem and its 0.25rem gap. The bar's
                  percentage has to resolve against the track alone, or the
                  tallest quarter of the scale all clips to the same height. */}
              <span className="flex h-[2.4375rem] w-full items-end">
                <span
                  className={`w-full rounded-[0.125rem] transition-colors ${
                    count === 0
                      ? selected
                        ? "bg-sage/30"
                        : "bg-white/8"
                      : selected
                        ? i === 0
                          ? "bg-[#D9938A]"
                          : "bg-sage"
                        : i === 0
                          ? "bg-[#D9938A]/45 group-hover:bg-[#D9938A]/75"
                          : "bg-ink-700 group-hover:bg-ink-500"
                  }`}
                  // The visibility floor is a fixed 3px, not a percentage: a
                  // percentage floor would swallow the 1-vs-2-task difference
                  // as soon as one day got busy enough to raise `dayMax`.
                  style={{
                    height:
                      count === 0
                        ? "0.125rem"
                        : `max(0.1875rem, ${Math.min(100, (count / dayMax) * 100)}%)`,
                  }}
                />
              </span>
              <span
                className={`mt-1 text-[0.5625rem] leading-none ${
                  selected
                    ? "text-sage"
                    : i === 0
                      ? "text-[#D9938A]"
                      : isToday
                        ? "font-semibold text-sage"
                        : "text-ink-600"
                }`}
              >
                {i === 0 ? "!" : weekdayLetter(day!)}
              </span>
            </button>
          );
        })}
      </div>
      {/* Hover wins over the active brush so you can peek at another day's
          count without clearing — except mid-drag, where the range being
          drawn is the thing you're looking at. */}
      <p className="mt-1.5 text-[0.6875rem] leading-tight text-ink-600">
        {range && (hovered === null || dragging) ? (
          <span className="text-sage">
            {describeRange(range)} · {brushedCount} task
            {brushedCount === 1 ? "" : "s"}
          </span>
        ) : hovered !== null ? (
          <>
            {hovered === 0 ? "Overdue" : formatDay(days[hovered - 1])} ·{" "}
            {bucketCounts[hovered]} task
            {bucketCounts[hovered] === 1 ? "" : "s"}
          </>
        ) : days.length > 0 ? (
          `${formatDay(days[0])} – ${formatDay(days[13])} · drag to brush`
        ) : (
          "drag to brush"
        )}
      </p>
    </div>
  );
}

/**
 * Trait chips with faceted counts over `tasks` (the rows the current list
 * would show before traits apply).
 */
export function TraitChips({
  tasks,
  today,
  traits,
  onChange,
}: {
  tasks: FilterableTask[];
  today: string;
  traits: TaskTrait[];
  onChange: (next: TaskTrait[]) => void;
}) {
  const countWith = (next: TaskTrait[]) =>
    tasks.filter((t) =>
      matchesTaskFilter(t, { ...EMPTY_TASK_FILTER, traits: next }, today),
    ).length;

  const toggle = (id: TaskTrait) => {
    const on = traits.includes(id);
    const opposite = OPPOSITE[id];
    onChange(
      on
        ? traits.filter((t) => t !== id)
        : [...traits.filter((t) => t !== opposite), id],
    );
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {TRAITS.map(({ id, label, Icon }) => {
        const selected = traits.includes(id);
        const count = countWith(
          selected ? traits : [...traits.filter((t) => t !== OPPOSITE[id]), id],
        );
        return (
          <button
            key={id}
            type="button"
            aria-pressed={selected}
            disabled={!selected && count === 0}
            onClick={() => toggle(id)}
            className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[0.75rem] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-sage/70 touch:min-h-11 touch:px-3 ${
              selected
                ? "border-sage/35 bg-sage/16 text-sage"
                : count === 0
                  ? "cursor-default border-dashed border-white/8 bg-transparent text-ink-500"
                  : "cursor-pointer border-white/10 bg-white/3 text-ink-400 hover:bg-white/6 hover:text-ink-200"
            }`}
          >
            <Icon className="h-[0.75rem] w-[0.75rem]" />
            {label}
            <span className="tabular-nums opacity-70">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
