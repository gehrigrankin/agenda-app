"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarClock,
  GripVertical,
  PanelRightClose,
  X,
} from "lucide-react";

import { listTasksDueAction, type DueTaskResult } from "@/app/app/actions";
import {
  getTimelineAction,
  scheduleBlockAction,
  unscheduleBlockAction,
} from "@/app/app/timeline/actions";
import type { DayBlock } from "@/server/blocks";
import type { DayEvent } from "@/server/calendar";
import { addDays, localDayBounds } from "@/lib/dates";

/**
 * Timeline planner (design 15d): a pull-out day timeline you drag tasks onto,
 * around your real calendar events. Blocks are suggestions to yourself — the
 * task stays a task — and unfinished blocks roll forward into the next day
 * (handled server-side when the timeline opens on today). Lives as a right-edge
 * drawer over the home content so it doesn't reshape the dashboard grid.
 */

const HOUR_START = 7; // 7 AM
const HOUR_END = 22; // 10 PM
const HOUR_PX = 46; // pixels per hour on the rail
const DEFAULT_BLOCK_MIN = 60;

const railTopMin = HOUR_START * 60;
const railHeight = (HOUR_END - HOUR_START) * HOUR_PX;

function minToTop(min: number): number {
  return ((min - railTopMin) / 60) * HOUR_PX;
}
function minToLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}
/** Local minutes-from-midnight for an absolute ISO instant. */
function isoToMin(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

function TrayTask({
  task,
  today,
  scheduled,
}: {
  task: DueTaskResult;
  today: string;
  scheduled: boolean;
}) {
  const carriedDays =
    task.dueAt.slice(0, 10) < today
      ? Math.max(
          1,
          Math.round(
            (new Date(`${today}T00:00:00Z`).getTime() -
              new Date(task.dueAt).getTime()) /
              86_400_000,
          ),
        )
      : 0;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/task-id", task.id);
        e.dataTransfer.effectAllowed = "copy";
      }}
      className={`flex cursor-grab items-center gap-2 rounded-[0.5625rem] border px-2.5 py-2 active:cursor-grabbing ${
        scheduled
          ? "border-sage/30 bg-sage/8"
          : "border-white/8 bg-white/[0.03] hover:border-white/15"
      }`}
    >
      <GripVertical className="h-[0.6875rem] w-[0.6875rem] flex-none text-ink-700" />
      <span className="h-3.5 w-3.5 flex-none rounded-[0.25rem] border-[1.5px] border-ink-700" />
      <span className="min-w-0 flex-1 truncate text-[0.75rem] text-ink-200">
        {task.title}
      </span>
      {carriedDays > 0 && (
        <span className="flex-none rounded-[0.25rem] bg-[#D9938A]/10 px-1.5 py-[0.1875rem] text-[0.5625rem] font-medium text-[#D9938A]">
          carried {carriedDays}d
        </span>
      )}
      {scheduled && (
        <span className="flex-none text-[0.5625rem] font-medium text-sage">
          on plan
        </span>
      )}
    </div>
  );
}

function TimelineDrawer({
  dateStr,
  onClose,
}: {
  dateStr: string;
  onClose: () => void;
}) {
  const [tasks, setTasks] = useState<DueTaskResult[]>([]);
  const [blocks, setBlocks] = useState<DayBlock[]>([]);
  const [events, setEvents] = useState<DayEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragOverMin, setDragOverMin] = useState<number | null>(null);
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const { start, end } = localDayBounds(dateStr);
    Promise.all([
      listTasksDueAction(dateStr),
      getTimelineAction(
        dateStr,
        start.toISOString(),
        end.toISOString(),
        addDays(dateStr, -1),
      ),
    ])
      .then(([taskRows, timeline]) => {
        if (cancelled) return;
        setTasks(taskRows);
        setBlocks(timeline.blocks);
        setEvents(timeline.events);
        setLoading(false);
      })
      .catch((err) => {
        console.error("[timeline] load failed:", err);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dateStr]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Snap a rail Y offset (px) to a start minute rounded to the quarter hour. */
  const minAtOffset = useCallback((offsetY: number): number => {
    const raw = railTopMin + (offsetY / HOUR_PX) * 60;
    const snapped = Math.round(raw / 15) * 15;
    return Math.max(railTopMin, Math.min(HOUR_END * 60 - 15, snapped));
  }, []);

  const onRailDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const rail = railRef.current;
    if (!rail) return;
    const y = e.clientY - rail.getBoundingClientRect().top;
    setDragOverMin(minAtOffset(y));
  };

  const onRailDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("text/task-id");
    setDragOverMin(null);
    if (!taskId) return;
    const rail = railRef.current;
    if (!rail) return;
    const y = e.clientY - rail.getBoundingClientRect().top;
    const startMin = minAtOffset(y);
    const endMin = Math.min(HOUR_END * 60, startMin + DEFAULT_BLOCK_MIN);
    const task = tasks.find((t) => t.id === taskId);
    // Optimistic placeholder; reconcile with the server's row on response.
    const optimistic: DayBlock = {
      id: `tmp-${taskId}`,
      taskId,
      title: task?.title ?? "Task",
      completed: false,
      startMin,
      endMin,
    };
    setBlocks((prev) => [
      ...prev.filter((b) => b.taskId !== taskId),
      optimistic,
    ]);
    scheduleBlockAction(taskId, dateStr, startMin, endMin)
      .then((saved) => {
        if (!saved) return;
        setBlocks((prev) =>
          prev.map((b) => (b.taskId === taskId ? saved : b)),
        );
      })
      .catch((err) => {
        console.error("[timeline] schedule failed:", err);
        setBlocks((prev) => prev.filter((b) => b.taskId !== taskId));
      });
  };

  const removeBlock = (block: DayBlock) => {
    setBlocks((prev) => prev.filter((b) => b.id !== block.id));
    if (block.id.startsWith("tmp-")) return;
    unscheduleBlockAction(block.id).catch((err) =>
      console.error("[timeline] unschedule failed:", err),
    );
  };

  const scheduledTaskIds = new Set(blocks.map((b) => b.taskId));
  const hours = Array.from(
    { length: HOUR_END - HOUR_START + 1 },
    (_, i) => HOUR_START + i,
  );

  return (
    <>
      {/* Click-away scrim (subtle — the drawer sits over the daily note). */}
      <button
        type="button"
        aria-label="Close timeline"
        onClick={onClose}
        className="absolute inset-0 z-40 cursor-default bg-black/20"
      />
      <aside className="animate-pop-in absolute inset-y-0 right-0 z-50 flex w-[23rem] max-w-[92vw] flex-col border-l border-white/10 bg-bar/98 shadow-[-16px_0_48px_rgba(0,0,0,0.5)] backdrop-blur-[10px]">
        <div className="flex flex-none items-center gap-2 border-b border-white/8 px-4 py-3">
          <CalendarClock className="h-3.5 w-3.5 text-sage" />
          <span className="text-[0.8125rem] font-semibold text-ink-100">
            Plan the day
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto flex items-center gap-1.5 text-[0.65625rem] font-medium text-ink-500 hover:text-ink-300"
          >
            <PanelRightClose className="h-3 w-3" />
            hide
          </button>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/15 border-t-sage" />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Task tray */}
            <div className="flex-none border-b border-white/8 p-3">
              <p className="mb-2 text-[0.5625rem] font-medium uppercase tracking-[0.09em] text-ink-600">
                Today&rsquo;s tasks — drag onto the timeline
              </p>
              <div className="flex max-h-[8.5rem] flex-col gap-1 overflow-y-auto">
                {tasks.length === 0 ? (
                  <p className="px-1 py-1 text-[0.6875rem] text-ink-600">
                    Nothing to schedule.
                  </p>
                ) : (
                  tasks.map((t) => (
                    <TrayTask
                      key={t.id}
                      task={t}
                      today={dateStr}
                      scheduled={scheduledTaskIds.has(t.id)}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Hour rail */}
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <div className="flex gap-2">
                <div
                  className="flex-none pt-0"
                  style={{ width: "2.5rem" }}
                >
                  {hours.map((h) => (
                    <div
                      key={h}
                      className="text-right text-[0.5625rem] font-medium text-ink-700"
                      style={{ height: HOUR_PX }}
                    >
                      {minToLabel(h * 60)}
                    </div>
                  ))}
                </div>
                <div
                  ref={railRef}
                  onDragOver={onRailDragOver}
                  onDragLeave={() => setDragOverMin(null)}
                  onDrop={onRailDrop}
                  className="relative flex-1 border-l border-white/8"
                  style={{ height: railHeight }}
                >
                  {/* Hour gridlines */}
                  {hours.map((h, i) => (
                    <div
                      key={h}
                      className="absolute inset-x-0 border-t border-white/5"
                      style={{ top: i * HOUR_PX }}
                    />
                  ))}

                  {/* Calendar events (read-only background) */}
                  {events.map((ev) => {
                    const start = isoToMin(ev.startIso);
                    const end = ev.endIso
                      ? isoToMin(ev.endIso)
                      : start + 30;
                    const top = minToTop(start);
                    const height = Math.max(
                      16,
                      ((end - start) / 60) * HOUR_PX - 2,
                    );
                    if (end <= railTopMin || start >= HOUR_END * 60) return null;
                    return (
                      <div
                        key={ev.uid}
                        className="absolute left-2 right-1 overflow-hidden rounded-lg border border-white/10 bg-white/5 px-2 py-1"
                        style={{ top, height }}
                      >
                        <span className="block truncate text-[0.625rem] font-medium text-ink-300">
                          {ev.title}{" "}
                          <span className="font-normal text-ink-600">
                            · calendar
                          </span>
                        </span>
                      </div>
                    );
                  })}

                  {/* Drop preview */}
                  {dragOverMin !== null && (
                    <div
                      className="pointer-events-none absolute left-2 right-1 flex items-center justify-center rounded-lg border-[1.5px] border-dashed border-sage/60 bg-sage/5"
                      style={{
                        top: minToTop(dragOverMin),
                        height: (DEFAULT_BLOCK_MIN / 60) * HOUR_PX,
                      }}
                    >
                      <span className="text-[0.625rem] font-medium text-sage">
                        drop here · {minToLabel(dragOverMin)}
                      </span>
                    </div>
                  )}

                  {/* Task blocks */}
                  {blocks.map((b) => {
                    const top = minToTop(b.startMin);
                    const height = Math.max(
                      18,
                      ((b.endMin - b.startMin) / 60) * HOUR_PX - 2,
                    );
                    return (
                      <div
                        key={b.id}
                        className="group absolute left-2 right-1 overflow-hidden rounded-lg border border-sage/30 bg-sage/10 px-2 py-1"
                        style={{ top, height }}
                      >
                        <span
                          className={`block truncate text-[0.625rem] font-medium ${
                            b.completed
                              ? "text-ink-500 line-through"
                              : "text-ink-200"
                          }`}
                        >
                          {b.title}
                        </span>
                        <span className="block text-[0.5625rem] text-ink-600">
                          {minToLabel(b.startMin)} – {minToLabel(b.endMin)}
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove ${b.title} from the timeline`}
                          onClick={() => removeBlock(b)}
                          className="absolute right-1 top-1 hidden h-4 w-4 items-center justify-center rounded bg-black/30 text-ink-400 hover:text-ink-100 group-hover:flex"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
              <p className="pt-3 text-[0.5625rem] leading-relaxed text-ink-700">
                Blocks are notes to yourself — the task stays a task. Unfinished
                blocks roll into tomorrow.
              </p>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

/** The header trigger + the drawer. Self-contained: owns its own open state. */
export function DayTimelineButton({ dateStr }: { dateStr: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Plan the day on a timeline"
        title="Plan the day on a timeline"
        className="flex h-[1.375rem] w-[1.375rem] items-center justify-center rounded-md bg-white/6 hover:bg-white/10"
      >
        <CalendarClock className="h-3 w-3 text-ink-400" />
      </button>
      {open && <TimelineDrawer dateStr={dateStr} onClose={() => setOpen(false)} />}
    </>
  );
}
