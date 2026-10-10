"use client";

import { useEffect, useState } from "react";

import { listTasksDueAction, type DueTaskResult } from "@/app/app/actions";
import {
  getTimelineAction,
  scheduleBlockAction,
  unscheduleBlockAction,
  type TimelineEvent,
} from "@/app/app/timeline/actions";
import { BottomSheet } from "@/components/layout/BottomSheet";
import {
  DEFAULT_BLOCK_MIN,
  HOUR_END,
  minToLabel,
  TimeRail,
} from "@/components/timeline/TimeRail";
import { addDays, localDayBounds } from "@/lib/dates";
import type { DayBlock } from "@/server/blocks";

/**
 * Phone Today-tab day plan (merged-calendar phase): the same 7:00–22:00
 * TimeRail as the desktop drawer, tap-to-place instead of drag. Tapping an
 * empty quarter-hour opens a bottom sheet of today's open, unscheduled tasks;
 * tapping a block opens a remove sheet. Blocks are the same day_blocks rows
 * the drawer manages, so the two surfaces stay in lockstep.
 */
export function PhonePlanRail({ today }: { today: string }) {
  const [blocks, setBlocks] = useState<DayBlock[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [staleCount, setStaleCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState<
    | { mode: "place"; startMin: number }
    | { mode: "remove"; block: DayBlock }
    | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const { start, end } = localDayBounds(today);
    // Passing yesterday opts into the server's roll-forward of unfinished
    // blocks, exactly like the desktop drawer's load.
    getTimelineAction(
      today,
      start.toISOString(),
      end.toISOString(),
      addDays(today, -1),
    )
      .then((timeline) => {
        if (cancelled) return;
        setBlocks(timeline.blocks);
        setEvents(timeline.events);
        setStaleCount(timeline.staleCount);
        setLoading(false);
      })
      .catch((err) => {
        console.error("[calendar] plan rail load failed:", err);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [today]);

  const place = (task: DueTaskResult, startMin: number) => {
    const endMin = Math.min(HOUR_END * 60, startMin + DEFAULT_BLOCK_MIN);
    // Optimistic placeholder; reconcile with the server's row on response.
    const optimistic: DayBlock = {
      id: `tmp-${task.id}`,
      taskId: task.id,
      title: task.title,
      completed: false,
      startMin,
      endMin,
    };
    setBlocks((prev) => [
      ...prev.filter((b) => b.taskId !== task.id),
      optimistic,
    ]);
    setSheet(null);
    scheduleBlockAction(task.id, today, startMin, endMin)
      .then((saved) => {
        if (!saved) return;
        setBlocks((prev) =>
          prev.map((b) => (b.taskId === task.id ? saved : b)),
        );
      })
      .catch((err) => {
        console.error("[calendar] schedule failed:", err);
        setBlocks((prev) => prev.filter((b) => b.taskId !== task.id));
      });
  };

  const remove = (block: DayBlock) => {
    setBlocks((prev) => prev.filter((b) => b.id !== block.id));
    setSheet(null);
    if (block.id.startsWith("tmp-")) return;
    unscheduleBlockAction(block.id).catch((err) =>
      console.error("[calendar] unschedule failed:", err),
    );
  };

  return (
    <div>
      <p className="text-[0.8125rem] text-ink-500">
        Tap an empty slot to put one of today&rsquo;s tasks on the plan.
      </p>
      {loading ? (
        <div className="mt-2 flex flex-col gap-2">
          <div className="h-24 animate-pulse rounded-xl bg-white/4" />
          <div className="h-24 animate-pulse rounded-xl bg-white/4" />
          <div className="h-24 animate-pulse rounded-xl bg-white/4" />
        </div>
      ) : (
        <div className="mt-2">
          <TimeRail
            blocks={blocks}
            events={events}
            staleCount={staleCount}
            onTapSlot={(startMin) => setSheet({ mode: "place", startMin })}
            onTapBlock={(block) => setSheet({ mode: "remove", block })}
          />
        </div>
      )}
      {sheet?.mode === "place" && (
        <PlanTaskSheet
          today={today}
          startMin={sheet.startMin}
          scheduledTaskIds={new Set(blocks.map((b) => b.taskId))}
          onPick={(task) => place(task, sheet.startMin)}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.mode === "remove" && (
        <RemoveBlockSheet
          block={sheet.block}
          onRemove={() => remove(sheet.block)}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

/** Bottom sheet listing today's open, unscheduled tasks for a tapped slot. */
function PlanTaskSheet({
  today,
  startMin,
  scheduledTaskIds,
  onPick,
  onClose,
}: {
  today: string;
  startMin: number;
  scheduledTaskIds: Set<string>;
  onPick: (task: DueTaskResult) => void;
  onClose: () => void;
}) {
  const [tasks, setTasks] = useState<DueTaskResult[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listTasksDueAction(today)
      .then((rows) => {
        if (!cancelled) setTasks(rows);
      })
      .catch((err) => {
        console.error("[calendar] due tasks load failed:", err);
        if (!cancelled) setTasks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [today]);

  const open = tasks?.filter((t) => !scheduledTaskIds.has(t.id));

  return (
    <BottomSheet
      label={`Schedule at ${minToLabel(startMin)}`}
      header={<SheetTitle>{`Schedule at ${minToLabel(startMin)}`}</SheetTitle>}
      onClose={onClose}
    >
      <div className="px-4 pb-2">
        {open === undefined ? (
          <div className="flex flex-col gap-1.5">
            <div className="h-11 animate-pulse rounded-xl bg-white/5" />
            <div className="h-11 animate-pulse rounded-xl bg-white/5" />
          </div>
        ) : open.length === 0 ? (
          <p className="px-1 pb-2 text-[0.8125rem] text-ink-500">
            Nothing left to schedule today.
          </p>
        ) : (
          <div className="flex max-h-[50dvh] flex-col gap-1.5 overflow-y-auto">
            {open.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onPick(t)}
                className="flex min-h-11 items-center gap-2.5 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-sage/70"
              >
                <span className="h-3.5 w-3.5 flex-none rounded-[0.25rem] border-[1.5px] border-ink-700" />
                <span className="min-w-0 flex-1 truncate text-[0.9375rem] text-ink-200">
                  {t.title}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

/** Bottom sheet offering removal of a tapped plan block. */
function RemoveBlockSheet({
  block,
  onRemove,
  onClose,
}: {
  block: DayBlock;
  onRemove: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet
      label={block.title}
      header={<SheetTitle>{block.title}</SheetTitle>}
      onClose={onClose}
    >
      <div className="px-4 pb-2">
        <p className="mb-3 text-[0.75rem] text-ink-500">
          On the plan {minToLabel(block.startMin)} – {minToLabel(block.endMin)}.
          Removing it keeps the task itself.
        </p>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={onRemove}
            className="flex-1 rounded-xl border border-[#D9938A]/30 bg-[#D9938A]/10 min-h-11 px-3 py-2.5 text-[0.8125rem] font-semibold text-[#D9938A]"
          >
            Remove from plan
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-white/8 bg-white/[0.03] min-h-11 px-3 py-2.5 text-[0.8125rem] font-medium text-ink-300"
          >
            Cancel
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}

function SheetTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-4 pb-2 text-[1rem] font-semibold text-ink-100">
      {children}
    </h2>
  );
}
