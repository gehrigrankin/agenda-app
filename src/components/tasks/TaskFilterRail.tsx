"use client";

import { useRef, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  CalendarDays,
  CircleDashed,
  CircleDot,
  FileText,
  Layers,
  PenLine,
  Repeat,
  X,
} from "lucide-react";

import { addDays, formatShortDate, parseLocalDate } from "@/lib/dates";
import type { RecurrenceSpec } from "@/lib/recurrence";

/**
 * Left filter rail for the Tasks page — the wide margins on that page turned
 * into a place to *look at* the backlog, not just narrow it.
 *
 * Three controls, deliberately different in kind:
 *
 *  1. **Workload strip** — a 15-bucket bar chart (overdue, then the next 14
 *     days) of open tasks by due day. Click a bar or drag across several to
 *     filter to that window. This is the part a chip row can't do: you see
 *     *where the pile-ups are* and grab them directly, instead of guessing a
 *     date range and checking whether it caught anything.
 *  2. **Lenses** — the five time buckets, each with a live count and a
 *     proportional baseline bar, so the shape of the backlog reads at a glance.
 *  3. **Folders + traits** — the categorical narrowing (which board, and
 *     whether the task recurs / reminds / came from a note).
 *
 * Counts are *faceted*: every group's counts are computed with the other
 * groups' filters applied, so a number never promises rows that a second
 * filter would immediately hide. The strip is the one exception — it ignores
 * the lens, because the lens is a time filter too and the strip is how you
 * pick a different time window.
 *
 * All filtering is client-side over tasks the page already loaded; the rail
 * adds no queries.
 */

export type TaskLens = "all" | "overdue" | "today" | "week" | "later" | "nodate";
export type TaskTrait = "recurring" | "reminder" | "note" | "solo";

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

function matchesLens(due: string | null, lens: TaskLens, today: string): boolean {
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

const GROUP_LABEL =
  "mb-2 text-[0.625rem] font-medium uppercase tracking-[0.11em] text-ink-600";

const LENSES: {
  id: TaskLens;
  label: string;
  Icon: typeof Layers;
  tone: string;
}[] = [
  { id: "all", label: "Everything", Icon: Layers, tone: "text-ink-400" },
  { id: "overdue", label: "Overdue", Icon: AlertTriangle, tone: "text-[#D9938A]" },
  { id: "today", label: "Today", Icon: CircleDot, tone: "text-sage" },
  { id: "week", label: "Next 7 days", Icon: CalendarDays, tone: "text-ink-400" },
  { id: "later", label: "Later", Icon: CalendarClock, tone: "text-ink-400" },
  { id: "nodate", label: "No date", Icon: CircleDashed, tone: "text-ink-500" },
];

const TRAITS: { id: TaskTrait; label: string; Icon: typeof Repeat }[] = [
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

export function TaskFilterRail({
  tasks,
  boards,
  today,
  filter,
  onChange,
  loading,
}: {
  /** Every open task, deduped — due ∪ upcoming ∪ unscheduled. */
  tasks: FilterableTask[];
  boards: { title: string; color: string | null }[];
  today: string;
  filter: TaskFilter;
  onChange: (next: TaskFilter) => void;
  loading: boolean;
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

  const days: string[] = today
    ? Array.from({ length: STRIP_DAYS }, (_, i) => addDays(today, i))
    : [];

  /** Counts for one group are computed with the *other* groups applied. */
  const countWith = (override: Partial<TaskFilter>) =>
    tasks.filter((t) => matchesTaskFilter(t, { ...filter, ...override }, today))
      .length;

  const lensCounts = LENSES.map((l) => countWith({ lens: l.id }));
  const lensMax = Math.max(1, ...lensCounts.slice(1));

  // Tags in play, derived from the loaded tasks rather than passed in: a tag
  // carried by nothing open has nothing to filter to, so it doesn't earn a
  // chip here (it's still offered in the row picker).
  const tagOptions: FilterableTask["tags"] = [];
  const seenTags = new Set<string>();
  for (const t of tasks) {
    for (const tag of t.tags) {
      if (!seenTags.has(tag.id)) {
        seenTags.add(tag.id);
        tagOptions.push(tag);
      }
    }
  }
  tagOptions.sort((a, b) => a.name.localeCompare(b.name));

  // The strip is a time picker, so it ignores the page's other time filters
  // (lens + the existing brush) and shows the full 15-bucket shape under the
  // categorical ones — otherwise brushing a day would flatten the chart you
  // brushed it on.
  const stripBase = tasks.filter((t) =>
    matchesTaskFilter(
      t,
      {
        lens: "all",
        range: null,
        board: filter.board,
        traits: filter.traits,
        tags: filter.tags,
      },
      today,
    ),
  );
  const bucketCounts = Array.from({ length: BUCKETS }, (_, i) =>
    stripBase.filter((t) =>
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
    const r = filter.range;
    if (!r) return false;
    if (i === 0) return r.start === null;
    const d = days[i - 1];
    return (r.start === null || d >= r.start) && d <= r.end;
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
    if (sameRange(filter.range, rangeFor(i, i))) onChange({ ...filter, range: null });
    else onChange({ ...filter, lens: "all", range: rangeFor(i, i) });
  };

  const toggleTrait = (id: TaskTrait) => {
    const on = filter.traits.includes(id);
    const opposite = OPPOSITE[id];
    const traits = on
      ? filter.traits.filter((t) => t !== id)
      : [...filter.traits.filter((t) => t !== opposite), id];
    onChange({ ...filter, traits });
  };

  const active = isFilterActive(filter);
  const activeCount = activeFilterCount(filter);
  const brushedCount = filter.range
    ? tasks.filter((t) => matchesTaskFilter(t, filter, today)).length
    : 0;

  if (loading) return <RailSkeleton />;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-[0.625rem] font-medium uppercase tracking-[0.11em] text-ink-500">
          Filters
        </span>
        {activeCount > 0 && (
          <span className="rounded-full bg-sage/16 px-1.5 py-px text-[0.625rem] font-semibold text-sage">
            {activeCount}
          </span>
        )}
        {active && (
          <button
            type="button"
            onClick={() => onChange(EMPTY_TASK_FILTER)}
            className="ml-auto flex items-center gap-0.5 text-[0.65625rem] font-medium text-ink-500 hover:text-ink-200"
          >
            Clear
            <X className="h-2.5 w-2.5" />
          </button>
        )}
      </div>

      {/* ── Workload strip ─────────────────────────────────────────────── */}
      <div>
        <div className={GROUP_LABEL}>Workload</div>
        <div
          ref={stripRef}
          onPointerDown={(e) => {
            const i = indexAt(e.clientX);
            if (i === null) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            dragStart.current = i;
            tapClears.current = sameRange(filter.range, rangeFor(i, i));
            if (!tapClears.current) {
              onChange({ ...filter, lens: "all", range: rangeFor(i, i) });
            }
          }}
          onPointerMove={(e) => {
            const i = indexAt(e.clientX);
            if (i === null) return;
            setHovered(i);
            if (dragStart.current === null) return;
            // Leaving the bucket turns a would-be clearing tap into a drag.
            if (i !== dragStart.current) tapClears.current = false;
            onChange({
              ...filter,
              lens: "all",
              range: rangeFor(dragStart.current, i),
            });
          }}
          onPointerUp={() => {
            if (dragStart.current !== null && tapClears.current) {
              onChange({ ...filter, range: null });
            }
            dragStart.current = null;
            tapClears.current = false;
          }}
          onPointerCancel={() => {
            dragStart.current = null;
            tapClears.current = false;
          }}
          onPointerLeave={() => setHovered(null)}
          className="flex h-[3.25rem] cursor-crosshair items-end gap-[0.1875rem] touch-none select-none"
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
                className={`group flex h-full flex-1 flex-col justify-end ${
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
        <p className="mt-1.5 text-[0.625rem] leading-tight text-ink-600">
          {filter.range && (hovered === null || dragStart.current !== null) ? (
            <span className="text-sage">
              {describeRange(filter.range)} · {brushedCount} task
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

      {/* ── Lenses ─────────────────────────────────────────────────────── */}
      <div>
        <div className={GROUP_LABEL}>When</div>
        <div className="flex flex-col gap-px">
          {LENSES.map(({ id, label, Icon, tone }, i) => {
            const count = lensCounts[i];
            const selected = filter.lens === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  onChange({
                    ...filter,
                    lens: id,
                    // The lens and the brush are both time filters — picking
                    // one replaces the other rather than stacking.
                    range: null,
                  })
                }
                className={`relative flex items-center gap-2 overflow-hidden rounded-lg px-2 py-[0.375rem] text-left ${
                  selected ? "bg-sage/12" : "hover:bg-white/4"
                }`}
              >
                {/* Proportional bar — the shape of the backlog. Deliberately a
                    baseline rule rather than a filled block: a full-width fill
                    on the biggest bucket reads as "selected" and out-shouts
                    the row that actually is. */}
                {id !== "all" && count > 0 && (
                  <span
                    aria-hidden
                    className={`absolute bottom-0 left-0 h-[0.09375rem] rounded-full ${
                      selected ? "bg-sage/70" : "bg-white/12"
                    }`}
                    style={{ width: `${(count / lensMax) * 100}%` }}
                  />
                )}
                <Icon
                  className={`relative h-3 w-3 flex-none ${
                    selected ? "text-sage" : tone
                  }`}
                />
                <span
                  className={`relative min-w-0 flex-1 truncate text-[0.75rem] ${
                    selected ? "font-medium text-sage" : "text-ink-300"
                  }`}
                >
                  {label}
                </span>
                <span
                  className={`relative flex-none text-[0.6875rem] tabular-nums ${
                    selected ? "text-sage" : count === 0 ? "text-ink-700" : "text-ink-500"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Folders ────────────────────────────────────────────────────── */}
      {boards.length > 0 && (
        <div>
          <div className={GROUP_LABEL}>Folders</div>
          <div className="flex flex-col gap-px">
            {boards.map((board) => {
              const count = countWith({ board: board.title });
              const selected = filter.board === board.title;
              return (
                <button
                  key={board.title}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    onChange({
                      ...filter,
                      board: selected ? null : board.title,
                    })
                  }
                  className={`flex items-center gap-2 rounded-lg px-2 py-[0.375rem] text-left ${
                    selected ? "bg-sage/12" : "hover:bg-white/4"
                  }`}
                >
                  <span
                    className="h-1.5 w-1.5 flex-none rounded-full"
                    style={{ background: board.color ?? "#9CC5AC" }}
                  />
                  <span
                    className={`min-w-0 flex-1 truncate text-[0.75rem] ${
                      selected ? "font-medium text-sage" : "text-ink-300"
                    }`}
                  >
                    {board.title}
                  </span>
                  <span
                    className={`flex-none text-[0.6875rem] tabular-nums ${
                      selected ? "text-sage" : count === 0 ? "text-ink-700" : "text-ink-500"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Tags ───────────────────────────────────────────────────────── */}
      {tagOptions.length > 0 && (
        <div>
          <div className="mb-2 flex items-baseline gap-1.5">
            <span className="text-[0.625rem] font-medium uppercase tracking-[0.11em] text-ink-600">
              Tags
            </span>
            {filter.tags.length > 1 && (
              <span className="text-[0.5625rem] lowercase tracking-normal text-ink-700">
                any of {filter.tags.length}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tagOptions.map((tag) => {
              const on = filter.tags.includes(tag.id);
              // OR semantics, so a tag's count is what IT would add — the
              // other selected tags aren't a precondition for it.
              const count = countWith({ tags: [tag.id] });
              return (
                <button
                  key={tag.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    onChange({
                      ...filter,
                      tags: on
                        ? filter.tags.filter((id) => id !== tag.id)
                        : [...filter.tags, tag.id],
                    })
                  }
                  className={`flex max-w-full items-center gap-1 rounded-full border px-2 py-1 text-[0.6875rem] font-medium transition-colors ${
                    on
                      ? "border-sage/35 bg-sage/16 text-[#B7D8C4]"
                      : "cursor-pointer border-white/10 bg-white/3 text-ink-400 hover:bg-white/6 hover:text-ink-200"
                  }`}
                  style={!on && tag.color ? { color: tag.color } : undefined}
                >
                  <span className="min-w-0 truncate">
                    <span className="opacity-60">#</span>
                    {tag.name}
                  </span>
                  <span className="tabular-nums opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Traits ─────────────────────────────────────────────────────── */}
      <div>
        <div className={GROUP_LABEL}>Traits</div>
        <div className="flex flex-wrap gap-1.5">
          {TRAITS.map(({ id, label, Icon }) => {
            const selected = filter.traits.includes(id);
            const count = countWith({
              traits: selected
                ? filter.traits
                : [...filter.traits.filter((t) => t !== OPPOSITE[id]), id],
            });
            return (
              <button
                key={id}
                type="button"
                aria-pressed={selected}
                disabled={!selected && count === 0}
                onClick={() => toggleTrait(id)}
                className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[0.6875rem] font-medium transition-colors ${
                  selected
                    ? "border-sage/35 bg-sage/16 text-[#B7D8C4]"
                    : count === 0
                      ? "cursor-default border-dashed border-white/8 bg-transparent text-ink-500"
                      : "cursor-pointer border-white/10 bg-white/3 text-ink-400 hover:bg-white/6 hover:text-ink-200"
                }`}
              >
                <Icon className="h-[0.6875rem] w-[0.6875rem]" />
                {label}
                <span className="tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Rail placeholder while the page's five list queries are in flight. */
function RailSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-4">
      <div className="h-2.5 w-14 rounded bg-white/6" />
      <div className="flex h-[3.25rem] items-end gap-[0.1875rem]">
        {[38, 62, 24, 80, 46, 30, 18, 55, 70, 26, 42, 34, 60, 22, 48].map(
          (h, i) => (
            <div
              key={i}
              className="flex-1 rounded-[0.125rem] bg-white/6"
              style={{ height: `${h}%` }}
            />
          ),
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-6 rounded-lg bg-white/5" />
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-6 w-20 rounded-full bg-white/5" />
        ))}
      </div>
    </div>
  );
}
