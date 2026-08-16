"use client";

import { useCallback, useRef, useState } from "react";
import { X } from "lucide-react";

import type { TimelineEvent } from "@/app/app/timeline/actions";
import type { DayBlock } from "@/server/blocks";

/**
 * Shared day time rail (7:00–22:00): the hour gutter + positioned calendar
 * events + task blocks behind both planning surfaces — the desktop "Plan the
 * day" drawer (home/DayTimeline.tsx, drag-to-place) and the phone calendar's
 * Today tab (calendar/CalendarPageClient.tsx, tap-to-place). Interaction is
 * opt-in per prop: `onDropTask` wires HTML5 drag/drop (payload: dataTransfer
 * "text/task-id") with the dashed drop preview, `onTapSlot` makes empty rail
 * space tappable at quarter-hour snaps, and blocks offer removal via a hover
 * X (`onRemoveBlock`, pointer surfaces) or a whole-block tap (`onTapBlock`,
 * touch surfaces). Anything falling wholly outside the rail window is
 * summarized by slim "+N earlier"/"+N later" chips instead of silently
 * vanishing, and `staleCount` > 0 renders one quiet rolled-forward line.
 *
 * Geometry: the rail's height is fixed in rem and children are placed by
 * percent-of-rail, so pointer math derives px-per-minute from the measured
 * rect instead of assuming a 16px root font.
 */

export const HOUR_START = 7; // 7 AM
export const HOUR_END = 22; // 10 PM
export const DEFAULT_BLOCK_MIN = 60;

/** 2.875rem/hour = the original drawer's 46px-per-hour at the 16px root. */
const HOUR_REM = 2.875;

const railTopMin = HOUR_START * 60;
const railBottomMin = HOUR_END * 60;
const railSpanMin = railBottomMin - railTopMin;
const railHeightRem = (HOUR_END - HOUR_START) * HOUR_REM;

/** Rail-relative vertical position of a minute mark, in percent. */
function minToPct(min: number): number {
  return ((min - railTopMin) / railSpanMin) * 100;
}

/** "7 AM" / "2:15 PM" for minutes-from-midnight. */
export function minToLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0
    ? `${h12} ${suffix}`
    : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** Local minutes-from-midnight for an absolute ISO instant. */
function isoToMin(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Wall-clock window of an event. User quick-add events carry their minutes
 * directly (immune to DST-day skew); ICS instants convert here.
 */
function eventWindow(ev: TimelineEvent): { start: number; end: number } {
  const start = ev.startMin ?? isoToMin(ev.startIso);
  const end = ev.endMin ?? (ev.endIso ? isoToMin(ev.endIso) : start + 30);
  return { start, end };
}

export interface TimeRailProps {
  blocks: DayBlock[];
  events: TimelineEvent[];
  /** When > 0, one quiet rolled-forward line renders under the rail. */
  staleCount?: number;
  /** Drag-to-place: a task chip dropped at a snapped quarter-hour start. */
  onDropTask?: (taskId: string, startMin: number) => void;
  /** Tap-to-place: an empty slot tapped, snapped to the quarter hour. */
  onTapSlot?: (startMin: number) => void;
  /** Renders the hover X on each block (pointer surfaces). */
  onRemoveBlock?: (block: DayBlock) => void;
  /** Makes whole blocks tappable (touch surfaces — caller offers remove). */
  onTapBlock?: (block: DayBlock) => void;
}

function OverflowChip({ count, label }: { count: number; label: string }) {
  return (
    <span className="inline-flex rounded-full border border-white/10 bg-white/4 px-2 py-[0.125rem] text-[0.5625rem] font-medium text-ink-500">
      +{count} {label}
    </span>
  );
}

export function TimeRail({
  blocks,
  events,
  staleCount = 0,
  onDropTask,
  onTapSlot,
  onRemoveBlock,
  onTapBlock,
}: TimeRailProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const [dragOverMin, setDragOverMin] = useState<number | null>(null);

  /** Snap a viewport Y to a start minute rounded to the quarter hour. */
  const minAtClientY = useCallback((clientY: number): number | null => {
    const rail = railRef.current;
    if (!rail) return null;
    const rect = rail.getBoundingClientRect();
    if (rect.height <= 0) return null;
    const raw = railTopMin + ((clientY - rect.top) / rect.height) * railSpanMin;
    const snapped = Math.round(raw / 15) * 15;
    return Math.max(railTopMin, Math.min(railBottomMin - 15, snapped));
  }, []);

  const hours = Array.from(
    { length: HOUR_END - HOUR_START + 1 },
    (_, i) => HOUR_START + i,
  );

  // Split everything into in-window (rendered) vs before/after (chip counts).
  const visibleEvents: { ev: TimelineEvent; start: number; end: number }[] = [];
  let earlier = 0;
  let later = 0;
  for (const ev of events) {
    const w = eventWindow(ev);
    if (w.end <= railTopMin) earlier += 1;
    else if (w.start >= railBottomMin) later += 1;
    else visibleEvents.push({ ev, start: w.start, end: w.end });
  }
  const visibleBlocks: DayBlock[] = [];
  for (const b of blocks) {
    if (b.endMin <= railTopMin) earlier += 1;
    else if (b.startMin >= railBottomMin) later += 1;
    else visibleBlocks.push(b);
  }

  return (
    <div>
      {earlier > 0 && (
        <div className="pb-1 pl-[3rem]">
          <OverflowChip count={earlier} label="earlier" />
        </div>
      )}

      <div className="flex gap-2">
        {/* Hour gutter */}
        <div className="flex-none" style={{ width: "2.5rem" }}>
          {hours.map((h) => (
            <div
              key={h}
              className="text-right text-[0.5625rem] font-medium text-ink-700"
              style={{ height: `${HOUR_REM}rem` }}
            >
              {minToLabel(h * 60)}
            </div>
          ))}
        </div>

        {/* The rail itself */}
        <div
          ref={railRef}
          onDragOver={
            onDropTask
              ? (e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                  const min = minAtClientY(e.clientY);
                  if (min !== null) setDragOverMin(min);
                }
              : undefined
          }
          onDragLeave={onDropTask ? () => setDragOverMin(null) : undefined}
          onDrop={
            onDropTask
              ? (e) => {
                  e.preventDefault();
                  const taskId = e.dataTransfer.getData("text/task-id");
                  setDragOverMin(null);
                  if (!taskId) return;
                  const min = minAtClientY(e.clientY);
                  if (min !== null) onDropTask(taskId, min);
                }
              : undefined
          }
          onClick={
            onTapSlot
              ? (e) => {
                  const min = minAtClientY(e.clientY);
                  if (min !== null) onTapSlot(min);
                }
              : undefined
          }
          className="relative flex-1 border-l border-white/8"
          style={{ height: `${railHeightRem}rem` }}
        >
          {/* Hour gridlines */}
          {hours.map((h) => (
            <div
              key={h}
              className="absolute inset-x-0 border-t border-white/5"
              style={{ top: `${minToPct(h * 60)}%` }}
            />
          ))}

          {/* Calendar events (read-only background) */}
          {visibleEvents.map(({ ev, start, end }) => (
            <div
              key={ev.uid}
              className="absolute left-2 right-1 overflow-hidden rounded-lg border border-white/10 bg-white/5 px-2 py-1"
              style={{
                top: `${minToPct(start)}%`,
                height: `calc(${((end - start) / railSpanMin) * 100}% - 0.125rem)`,
                minHeight: "1rem",
              }}
            >
              <span className="block truncate text-[0.625rem] font-medium text-ink-300">
                {ev.title}{" "}
                <span className="font-normal text-ink-600">· calendar</span>
              </span>
            </div>
          ))}

          {/* Drop preview */}
          {dragOverMin !== null && (
            <div
              className="pointer-events-none absolute left-2 right-1 flex items-center justify-center rounded-lg border-[1.5px] border-dashed border-sage/60 bg-sage/5"
              style={{
                top: `${minToPct(dragOverMin)}%`,
                height: `${(DEFAULT_BLOCK_MIN / railSpanMin) * 100}%`,
              }}
            >
              <span className="text-[0.625rem] font-medium text-sage">
                drop here · {minToLabel(dragOverMin)}
              </span>
            </div>
          )}

          {/* Task blocks */}
          {visibleBlocks.map((b) => (
            <div
              key={b.id}
              role={onTapBlock ? "button" : undefined}
              tabIndex={onTapBlock ? 0 : undefined}
              onClick={
                onTapBlock
                  ? (e) => {
                      e.stopPropagation();
                      onTapBlock(b);
                    }
                  : undefined
              }
              onKeyDown={
                onTapBlock
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        onTapBlock(b);
                      }
                    }
                  : undefined
              }
              className={`group absolute left-2 right-1 overflow-hidden rounded-lg border border-sage/30 bg-sage/10 px-2 py-1 ${
                onTapBlock ? "cursor-pointer" : ""
              }`}
              style={{
                top: `${minToPct(b.startMin)}%`,
                height: `calc(${((b.endMin - b.startMin) / railSpanMin) * 100}% - 0.125rem)`,
                minHeight: "1.125rem",
              }}
            >
              <span
                className={`block truncate text-[0.625rem] font-medium ${
                  b.completed
                    ? "strike-muted text-ink-500 line-through"
                    : "text-ink-200"
                }`}
              >
                {b.title}
              </span>
              <span className="block text-[0.5625rem] text-ink-600">
                {minToLabel(b.startMin)} – {minToLabel(b.endMin)}
              </span>
              {onRemoveBlock && (
                <button
                  type="button"
                  aria-label={`Remove ${b.title} from the timeline`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveBlock(b);
                  }}
                  className="absolute right-1 top-1 hidden h-4 w-4 items-center justify-center rounded bg-black/30 text-ink-400 hover:text-ink-100 group-hover:flex"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {later > 0 && (
        <div className="pl-[3rem] pt-1">
          <OverflowChip count={later} label="later" />
        </div>
      )}

      {staleCount > 0 && (
        <p className="pl-[3rem] pt-2 text-[0.5625rem] leading-relaxed text-ink-600">
          {staleCount} unfinished block{staleCount === 1 ? "" : "s"} from
          earlier days rolled into today
        </p>
      )}
    </div>
  );
}
