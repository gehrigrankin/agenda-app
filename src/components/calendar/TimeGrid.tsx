"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { FileText } from "lucide-react";
import Link from "next/link";

import type { CalendarRangeTask } from "@/app/app/calendar/actions";
import {
  hhmmToMin,
  hourLabel,
  layoutOverlaps,
  layoutStripBars,
  snapMinutes,
} from "@/lib/calendar-grid";
import { parseLocalDate } from "@/lib/dates";
import type { RangeCalendarEvent } from "@/server/calendar";
import type { UserEvent } from "@/server/events";

import {
  ICS_COLOR,
  OWN_EVENT_COLOR,
  TASK_DRAG_TYPE,
  icsSpanKey,
  icsTimedKey,
  icsWindow,
  isSpanned,
  timeRangeLabel,
  tintStyle,
  type CalendarSelection,
} from "./calendar-items";

/**
 * Day/Week time grid for the desktop/tablet Calendar (design §5c/§6c): a
 * sticky header row of day names, an all-day strip (multi-day spans, all-day
 * events, untimed tasks), then a 24h body with an hour gutter. Timed items
 * are absolutely placed by percent-of-day and share a column side by side
 * when they overlap (lib/calendar-grid layoutOverlaps). The body is one
 * scroll container that opens at ~7:30.
 *
 * Interactions: click an item → select (the page opens the EVENT sidebar);
 * click an empty slot → `onSlot` (the page opens the new-event composer
 * there); drop a task chip on a slot → scheduled at that time, on the strip
 * or a day header → that day with no time. While a task is "armed"
 * (tap-to-place, for touch and keyboard), a slot/strip click places it
 * instead.
 */

/** Hour height in rem (13px root → ~49px). */
export const HOUR_REM = 3.75;
const DAY_REM = HOUR_REM * 24;
const MAX_STRIP_TASKS = 3;
const SCROLL_TO_MIN = 7.5 * 60;

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface GridComposer {
  date: string;
  startMin: number;
}

interface TimedEntry {
  key: string;
  start: number;
  end: number;
  title: string;
  color: string;
  kind: "event" | "ics" | "task";
  select: CalendarSelection;
  completed?: boolean;
}

export function TimeGrid({
  days,
  today,
  nowMin,
  events,
  ics,
  tasks,
  noteDays,
  colorOf,
  selectedKey,
  armedTitle,
  dragging,
  composer,
  composerNode,
  onSelect,
  onSlot,
  onPlace,
  onOpenDay,
}: {
  days: string[];
  today: string | null;
  nowMin: number;
  events: UserEvent[];
  ics: RangeCalendarEvent[];
  tasks: CalendarRangeTask[];
  noteDays: Set<string>;
  colorOf: (tagId: string | null) => string | null;
  /** Key of the selected item (u:/i:/t: prefixed) for the highlight. */
  selectedKey: string | null;
  /** Set while a task is armed for tap-to-place. */
  armedTitle: string | null;
  /** A task chip is being dragged (shows the strip as a drop target). */
  dragging: boolean;
  composer: GridComposer | null;
  /** The composer UI, positioned by the grid next to its slot. */
  composerNode: React.ReactNode;
  onSelect: (sel: CalendarSelection) => void;
  /** Empty slot clicked (snapped to the half hour). */
  onSlot: (date: string, startMin: number) => void;
  /** Place a task: dropped/armed onto a day (`startMin` null = no time). */
  onPlace: (
    taskId: string | null,
    date: string,
    startMin: number | null,
  ) => void;
  onOpenDay: (date: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dropPreview, setDropPreview] = useState<{
    date: string;
    min: number;
  } | null>(null);

  // Open at ~7:30 (design: 8a at the top with a little lead-in). Once per
  // mount — paging weeks keeps wherever the user scrolled to.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const rem =
      parseFloat(getComputedStyle(document.documentElement).fontSize) || 13;
    el.scrollTop = (SCROLL_TO_MIN / 60) * HOUR_REM * rem;
  }, []);

  const cols = `3.5rem repeat(${days.length}, minmax(0, 1fr))`;
  const daySet = useMemo(() => new Set(days), [days]);

  // --- All-day strip ---------------------------------------------------------
  const strip = useMemo(() => {
    const items: {
      key: string;
      start: string;
      end: string;
      title: string;
      color: string;
      select: CalendarSelection;
    }[] = [];
    const seen = new Set<string>();
    for (const e of events) {
      if (!isSpanned(e) && e.startMin !== null) continue;
      items.push({
        key: `u:${e.id}`,
        start: e.localDate,
        end: e.endLocalDate ?? e.localDate,
        title: e.title,
        color: colorOf(e.tagId) ?? OWN_EVENT_COLOR,
        select: { kind: "event", id: e.id, snapshot: e },
      });
    }
    for (const e of ics) {
      if (!e.allDay && !isSpanned(e)) continue;
      const key = icsSpanKey(e);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        key,
        start: e.spanStart,
        end: e.spanEnd,
        title: e.title,
        color: ICS_COLOR,
        select: { kind: "ics", key, event: e },
      });
    }
    const bars = layoutStripBars(items, days);
    const byKey = new Map(items.map((it) => [it.key, it]));
    const lanes = bars.reduce((n, b) => Math.max(n, b.lane + 1), 0);
    const untimedTasks = new Map<string, CalendarRangeTask[]>();
    for (const t of tasks) {
      if (!daySet.has(t.due) || hhmmToMin(t.remindAt) !== null) continue;
      const list = untimedTasks.get(t.due);
      if (list) list.push(t);
      else untimedTasks.set(t.due, [t]);
    }
    return { bars, byKey, lanes, untimedTasks };
  }, [events, ics, tasks, days, daySet, colorOf]);

  const stripHasContent = strip.lanes > 0 || strip.untimedTasks.size > 0;
  const showStrip = stripHasContent || dragging || armedTitle !== null;
  const single = days.length === 1;
  const taskCap = single ? Infinity : MAX_STRIP_TASKS;

  // --- Timed items per day -----------------------------------------------------
  const timedByDay = useMemo(() => {
    const map = new Map<string, TimedEntry[]>();
    const push = (date: string, entry: TimedEntry) => {
      if (!daySet.has(date)) return;
      const list = map.get(date);
      if (list) list.push(entry);
      else map.set(date, [entry]);
    };
    for (const e of events) {
      if (e.startMin === null || isSpanned(e)) continue;
      push(e.localDate, {
        key: `u:${e.id}`,
        start: e.startMin,
        end: e.endMin ?? e.startMin + 60,
        title: e.title,
        color: colorOf(e.tagId) ?? OWN_EVENT_COLOR,
        kind: "event",
        select: { kind: "event", id: e.id, snapshot: e },
      });
    }
    for (const e of ics) {
      if (e.allDay || isSpanned(e) || !e.startIso) continue;
      const { start, end } = icsWindow(e);
      const key = icsTimedKey(e);
      push(e.date, {
        key,
        start,
        end,
        title: e.title,
        color: ICS_COLOR,
        kind: "ics",
        select: { kind: "ics", key, event: e },
      });
    }
    for (const t of tasks) {
      const start = hhmmToMin(t.remindAt);
      if (start === null) continue;
      push(t.due, {
        key: `t:${t.id}`,
        start,
        end: start + 30,
        title: t.title,
        color: "var(--sage)",
        kind: "task",
        completed: t.completed,
        select: { kind: "task", id: t.id, snapshot: t },
      });
    }
    return map;
  }, [events, ics, tasks, daySet, colorOf]);

  const minuteAt = (e: React.MouseEvent | React.DragEvent, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    return ((e.clientY - rect.top) / rect.height) * 1440;
  };

  const taskIdOf = (e: React.DragEvent) =>
    e.dataTransfer.getData(TASK_DRAG_TYPE) || null;
  const acceptsTask = (e: React.DragEvent) =>
    e.dataTransfer.types.includes(TASK_DRAG_TYPE);

  return (
    <div
      ref={scrollRef}
      className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
    >
      {/* Sticky top: day names + all-day strip. */}
      <div className="sticky top-0 z-20 border-b border-white/6 bg-canvas">
        <div className="grid" style={{ gridTemplateColumns: cols }}>
          <div />
          {days.map((d) => {
            const isToday = d === today;
            const date = parseLocalDate(d);
            return (
              <div
                key={d}
                className={`flex h-[2.5rem] min-w-0 items-center gap-1 border-l border-white/6 pr-1 pl-2 touch:h-[3.4rem] ${
                  isToday ? "bg-white/[0.025]" : ""
                }`}
                onDragOver={(e) => {
                  if (acceptsTask(e)) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  onPlace(taskIdOf(e), d, null);
                }}
              >
                <button
                  type="button"
                  onClick={() =>
                    armedTitle !== null ? onPlace(null, d, null) : onOpenDay(d)
                  }
                  title={
                    armedTitle !== null ? "Schedule on this day" : "Open day"
                  }
                  className={`min-w-0 truncate rounded px-1 py-0.5 text-left text-[0.875rem] font-medium hover:bg-white/6 focus-visible:outline-2 focus-visible:outline-sage/70 touch:min-h-11 ${
                    isToday ? "text-sage" : "text-ink-250"
                  }`}
                >
                  {WEEKDAY_SHORT[date.getDay()]} {date.getDate()}
                </button>
                {noteDays.has(d) && (
                  <Link
                    href={isToday ? "/app" : `/app?d=${d}`}
                    aria-label="Open the daily note"
                    title="Daily note"
                    className="ml-auto flex h-6 w-6 flex-none items-center justify-center rounded text-ink-600 hover:bg-white/6 hover:text-ink-300 focus-visible:outline-2 focus-visible:outline-sage/70 touch:h-11 touch:w-11"
                  >
                    <FileText className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
            );
          })}
        </div>

        {showStrip && (
          <div
            className="grid border-t border-white/6"
            style={{
              gridTemplateColumns: cols,
              gridTemplateRows:
                strip.lanes > 0
                  ? `repeat(${strip.lanes}, 1.5rem) auto`
                  : "auto",
            }}
          >
            <div
              className="flex items-start justify-end pt-1 pr-2 font-mono text-[0.625rem] text-ink-600"
              style={{ gridRow: "1 / -1", gridColumn: 1 }}
            >
              all-day
            </div>
            {/* Drop/click targets behind the bars, one per day. */}
            {days.map((d, i) => (
              <div
                key={`bg-${d}`}
                data-day-strip={d}
                aria-hidden
                className={`min-h-[1.75rem] border-l border-white/6 ${
                  d === today ? "bg-white/[0.025]" : ""
                } ${dropPreview?.date === d && dropPreview.min < 0 ? "bg-sage/10" : ""} ${
                  armedTitle !== null ? "cursor-copy hover:bg-sage/8" : ""
                }`}
                style={{ gridRow: "1 / -1", gridColumn: i + 2 }}
                onClick={() => {
                  if (armedTitle !== null) onPlace(null, d, null);
                }}
                onDragOver={(e) => {
                  if (!acceptsTask(e)) return;
                  e.preventDefault();
                  setDropPreview({ date: d, min: -1 });
                }}
                onDragLeave={() => setDropPreview(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropPreview(null);
                  onPlace(taskIdOf(e), d, null);
                }}
              />
            ))}
            {strip.bars.map((b) => {
              const it = strip.byKey.get(b.key)!;
              const selected = selectedKey === b.key;
              return (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => onSelect(it.select)}
                  title={it.title}
                  className={`relative z-10 my-[0.1875rem] min-w-0 truncate px-1.5 text-left text-[0.75rem] leading-[1.125rem] font-medium text-ink-100 focus-visible:outline-2 focus-visible:outline-sage/70 ${
                    b.isStart ? "ml-0.5 rounded-l-[0.3125rem] border-l-2" : ""
                  } ${b.isEnd ? "mr-0.5 rounded-r-[0.3125rem]" : ""}`}
                  style={{
                    ...tintStyle(it.color, selected ? "selected" : "rest"),
                    gridRow: b.lane + 1,
                    gridColumn: `${b.startCol + 2} / ${b.endCol + 3}`,
                  }}
                >
                  {it.title}
                </button>
              );
            })}
            {days.map((d, i) => {
              const list = strip.untimedTasks.get(d) ?? [];
              if (list.length === 0) return null;
              const shown = list.slice(0, taskCap);
              const more = list.length - shown.length;
              return (
                <div
                  key={`tasks-${d}`}
                  className="pointer-events-none relative z-10 flex min-w-0 flex-col gap-0.5 px-0.5 py-1"
                  style={{ gridRow: strip.lanes + 1, gridColumn: i + 2 }}
                >
                  {shown.map((t) => (
                    <TaskChip
                      key={t.id}
                      task={t}
                      selected={selectedKey === `t:${t.id}`}
                      onSelect={() =>
                        onSelect({ kind: "task", id: t.id, snapshot: t })
                      }
                    />
                  ))}
                  {more > 0 && (
                    <button
                      type="button"
                      onClick={() => onOpenDay(d)}
                      className="pointer-events-auto self-start rounded px-1 text-[0.6875rem] text-ink-500 hover:bg-white/6 hover:text-ink-300 focus-visible:outline-2 focus-visible:outline-sage/70"
                    >
                      +{more} more
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Body: hour gutter + day columns. */}
      <div
        className="relative grid"
        style={{ gridTemplateColumns: cols, height: `${DAY_REM}rem` }}
      >
        <div className="relative">
          {Array.from({ length: 24 }, (_, h) =>
            h === 0 ? null : (
              <span
                key={h}
                className="absolute right-2 -translate-y-1/2 font-mono text-[0.6875rem] text-ink-600"
                style={{ top: `${(h / 24) * 100}%` }}
              >
                {hourLabel(h)}
              </span>
            ),
          )}
        </div>
        {/* Hour lines across every column. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 left-[3.5rem]"
        >
          {Array.from({ length: 23 }, (_, i) => (
            <div
              key={i}
              className="absolute inset-x-0 border-t border-white/5"
              style={{ top: `${((i + 1) / 24) * 100}%` }}
            />
          ))}
        </div>

        {days.map((d) => {
          const items = timedByDay.get(d) ?? [];
          const placed = layoutOverlaps(items);
          const isToday = d === today;
          const preview =
            dropPreview?.date === d && dropPreview.min >= 0
              ? dropPreview.min
              : null;
          const composing = composer?.date === d ? composer.startMin : null;
          return (
            <div
              key={d}
              data-day-column={d}
              className={`relative border-l border-white/6 ${
                isToday ? "bg-white/[0.025]" : ""
              } ${armedTitle !== null ? "cursor-copy" : "cursor-default"}`}
              onClick={(e) => {
                if (e.target !== e.currentTarget) return;
                const min = snapMinutes(minuteAt(e, e.currentTarget), 30);
                if (armedTitle !== null) onPlace(null, d, min);
                else onSlot(d, min);
              }}
              onDragOver={(e) => {
                if (!acceptsTask(e)) return;
                e.preventDefault();
                const min = snapMinutes(minuteAt(e, e.currentTarget), 15);
                if (preview !== min) setDropPreview({ date: d, min });
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  setDropPreview(null);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                const min = snapMinutes(minuteAt(e, e.currentTarget), 15);
                setDropPreview(null);
                onPlace(taskIdOf(e), d, min);
              }}
            >
              {items.map((it) => {
                const p = placed.get(it.key) ?? { col: 0, cols: 1 };
                const top = (it.start / 1440) * 100;
                const len = Math.max(
                  it.end - it.start,
                  it.kind === "task" ? 30 : 20,
                );
                const height = (Math.min(len, 1440 - it.start) / 1440) * 100;
                const selected = selectedKey === it.key;
                const roomy = len >= 45;
                return (
                  <button
                    key={it.key}
                    type="button"
                    draggable={it.kind === "task"}
                    onDragStart={
                      it.kind === "task"
                        ? (e) => {
                            e.dataTransfer.setData(
                              TASK_DRAG_TYPE,
                              it.key.slice(2),
                            );
                            e.dataTransfer.effectAllowed = "move";
                          }
                        : undefined
                    }
                    onClick={() => onSelect(it.select)}
                    title={`${it.title} · ${timeRangeLabel(it.start, it.kind === "task" ? null : it.end)}`}
                    className={`absolute z-10 flex flex-col overflow-hidden rounded-[0.3125rem] px-1.5 text-left focus-visible:outline-2 focus-visible:outline-sage/70 ${
                      it.kind === "task"
                        ? "border border-dashed py-0.5"
                        : "border-l-2 py-1"
                    } ${selected ? "ring-1 ring-ink-300/60" : ""}`}
                    style={{
                      ...tintStyle(it.color, selected ? "selected" : "rest"),
                      top: `${top}%`,
                      height: `calc(${height}% - 2px)`,
                      left: `calc(${(p.col / p.cols) * 100}% + 3px)`,
                      width: `calc(${100 / p.cols}% - 6px)`,
                    }}
                  >
                    <span
                      className={`flex min-w-0 items-center gap-1 text-[0.8125rem] leading-tight font-medium ${
                        it.completed
                          ? "text-ink-500 line-through"
                          : "text-ink-100"
                      } ${roomy ? "line-clamp-2" : "truncate"}`}
                    >
                      {it.kind === "task" && (
                        <span
                          aria-hidden
                          className={`h-2.5 w-2.5 flex-none rounded-[0.1875rem] border ${
                            it.completed
                              ? "border-sage bg-sage"
                              : "border-ink-400"
                          }`}
                        />
                      )}
                      <span className="min-w-0 truncate">{it.title}</span>
                    </span>
                    {roomy && it.kind !== "task" && (
                      <span className="mt-0.5 truncate font-mono text-[0.6875rem] text-ink-400">
                        {timeRangeLabel(it.start, it.end)}
                      </span>
                    )}
                  </button>
                );
              })}

              {preview !== null && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-[3px] z-10 rounded-[0.3125rem] border border-dashed border-sage/70 bg-sage/10 px-1.5 font-mono text-[0.6875rem] text-sage"
                  style={{
                    top: `${(preview / 1440) * 100}%`,
                    height: `${(30 / 1440) * 100}%`,
                  }}
                >
                  {timeRangeLabel(preview, null)}
                </div>
              )}

              {composing !== null && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-[3px] z-10 rounded-[0.3125rem] border-l-2 border-sage bg-sage/20"
                  style={{
                    top: `${(composing / 1440) * 100}%`,
                    height: `${(60 / 1440) * 100}%`,
                  }}
                />
              )}

              {isToday && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 z-[15] border-t-[1.5px] border-sage"
                  style={{ top: `${(nowMin / 1440) * 100}%` }}
                >
                  <span className="absolute -top-[4px] -left-[4px] h-[7px] w-[7px] rounded-full bg-sage" />
                </div>
              )}
            </div>
          );
        })}

        {/* New-event composer, anchored under its slot. */}
        {composer && daySet.has(composer.date) && composerNode && (
          <ComposerAnchor
            dayIndex={days.indexOf(composer.date)}
            dayCount={days.length}
            startMin={composer.startMin}
          >
            {composerNode}
          </ComposerAnchor>
        )}
      </div>
    </div>
  );
}

/** Positions the composer beside its slot without leaving the grid. */
function ComposerAnchor({
  dayIndex,
  dayCount,
  startMin,
  children,
}: {
  dayIndex: number;
  dayCount: number;
  startMin: number;
  children: React.ReactNode;
}) {
  // Open toward the side with room: right of the column for the left half
  // of the week, left of it for the right half.
  const leftHalf = dayIndex < dayCount / 2;
  const colFrac = `((100% - 3.5rem) / ${dayCount})`;
  const style: React.CSSProperties = {
    top: `calc(${((startMin + 60) / 1440) * 100}% + 4px)`,
    width: "min(22rem, calc(100% - 4.5rem))",
  };
  if (dayCount === 1) style.left = "4rem";
  else if (leftHalf)
    style.left = `calc(3.5rem + ${colFrac} * ${dayIndex} + 3px)`;
  else style.right = `calc(${colFrac} * ${dayCount - dayIndex - 1} + 3px)`;
  return (
    <div className="absolute z-30" style={style}>
      <div className="rounded-xl bg-panel shadow-[0_12px_32px_rgba(0,0,0,0.45)]">
        {children}
      </div>
    </div>
  );
}

/** Untimed task chip in the all-day strip (draggable to a time). */
function TaskChip({
  task,
  selected,
  onSelect,
}: {
  task: CalendarRangeTask;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(TASK_DRAG_TYPE, task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onSelect}
      title={task.title}
      className={`pointer-events-auto flex min-w-0 items-center gap-1.5 rounded-[0.3125rem] border border-dashed px-1.5 py-px text-left text-[0.75rem] leading-[1.125rem] focus-visible:outline-2 focus-visible:outline-sage/70 touch:min-h-8 ${
        selected
          ? "border-sage/70 bg-sage/16"
          : "border-sage/35 bg-sage/[0.05] hover:bg-sage/10"
      }`}
    >
      <span
        aria-hidden
        className={`h-2.5 w-2.5 flex-none rounded-[0.1875rem] border ${
          task.completed ? "border-sage bg-sage" : "border-ink-400"
        }`}
      />
      <span
        className={`min-w-0 truncate ${
          task.completed ? "text-ink-500 line-through" : "text-ink-200"
        }`}
      >
        {task.title}
      </span>
    </button>
  );
}
