"use client";

import { useEffect, useState } from "react";
import { CalendarClock, GripVertical, PanelRightClose } from "lucide-react";

import { listTasksDueAction, type DueTaskResult } from "@/app/app/actions";
import {
  getTimelineAction,
  scheduleBlockAction,
  unscheduleBlockAction,
  type TimelineEvent,
} from "@/app/app/timeline/actions";
import {
  DEFAULT_BLOCK_MIN,
  HOUR_END,
  TimeRail,
} from "@/components/timeline/TimeRail";
import type { DayBlock } from "@/server/blocks";
import { addDays, localDayBounds } from "@/lib/dates";

/**
 * Timeline planner (design 15d): a pull-out day timeline you drag tasks onto,
 * around your real calendar events. Blocks are suggestions to yourself — the
 * task stays a task — and unfinished blocks roll forward into the next day
 * (handled server-side when the timeline opens on today). Lives as a right-edge
 * drawer over the home content so it doesn't reshape the dashboard grid.
 *
 * The rail itself (hour gutter, event/block placement, drop preview) is the
 * shared TimeRail component, also used tap-to-place by the phone calendar's
 * Today tab; this file keeps the drawer chrome, the drag-source task tray, and
 * the optimistic schedule/unschedule flow.
 */

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
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[0.75rem] text-ink-200">
        {task.title}
      </span>
      {carriedDays > 0 && (
        // Red is reserved for starred tasks here as everywhere else; an
        // unstarred task that slipped a few days reads calm blue, so the tray
        // doesn't turn into a wall of alarm you learn to skip past.
        <span
          className={`flex-none rounded-[0.25rem] px-1.5 py-[0.1875rem] text-[0.5625rem] font-medium ${
            task.important
              ? "bg-overdue/10 text-overdue"
              : "bg-overdue-calm/10 text-overdue-calm"
          }`}
        >
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
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [staleCount, setStaleCount] = useState(0);
  const [loading, setLoading] = useState(true);

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
        setStaleCount(timeline.staleCount);
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

  /** A tray task dropped on the rail at `startMin` (already quarter-snapped). */
  const placeTask = (taskId: string, startMin: number) => {
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
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex-none border-b border-white/8 p-3">
              <div className="mb-2 h-2.5 w-40 animate-pulse rounded bg-white/6" />
              <div className="flex flex-col gap-1.5">
                <div className="h-9 animate-pulse rounded-[0.5625rem] bg-white/5" />
                <div className="h-9 animate-pulse rounded-[0.5625rem] bg-white/5" />
              </div>
            </div>
            <div className="flex flex-1 flex-col gap-2.5 p-3">
              <div className="h-10 animate-pulse rounded-lg bg-white/4" />
              <div className="h-16 animate-pulse rounded-lg bg-white/4" />
              <div className="h-8 animate-pulse rounded-lg bg-white/4" />
            </div>
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
              <TimeRail
                blocks={blocks}
                events={events}
                staleCount={staleCount}
                onDropTask={placeTask}
                onRemoveBlock={removeBlock}
              />
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
