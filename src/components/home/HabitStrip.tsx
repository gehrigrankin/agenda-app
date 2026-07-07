"use client";

import { useEffect, useState } from "react";
import { Check, LineChart, Loader2, Plus } from "lucide-react";

import {
  listHabitsForDayAction,
  logHabitAction,
} from "@/app/app/habits/actions";
import type { HabitDot, HabitForDay } from "@/server/habits";
import { formatTimeShort } from "@/lib/recurrence";

/**
 * The daily note's habit strip (design 16b): a quiet row per habit with a
 * one-tap log box, a subtitle, and a chain of streak dots that DIMS on a miss
 * instead of breaking. Renders nothing until it knows the day has habits, so an
 * empty account never grows chrome it didn't ask for.
 */

function Dot({ dot }: { dot: HabitDot }) {
  if (dot.state === "done") {
    return <span className="h-[0.4375rem] w-[0.4375rem] rounded-full bg-sage" />;
  }
  if (dot.state === "today") {
    // Today, not logged yet: a hollow ring waiting to be filled.
    return (
      <span className="h-[0.4375rem] w-[0.4375rem] rounded-full border-[1.5px] border-ink-700" />
    );
  }
  // Missed: the chain dims here rather than resetting.
  return (
    <span className="h-[0.4375rem] w-[0.4375rem] rounded-full bg-[#3A403D]" />
  );
}

function HabitRow({
  habit,
  onLog,
  busy,
}: {
  habit: HabitForDay;
  onLog: () => void;
  busy: boolean;
}) {
  const subtitle = habit.todayCompleted
    ? `logged ${habit.loggedAt ? formatTimeShort(habit.loggedAt) : "today"}${
        habit.runDays > 0 ? ` · ${habit.runDays}-day run` : ""
      }`
    : habit.scheduledToday
      ? habit.runDays > 0
        ? `not yet today · ${habit.runDays}-day run`
        : "not yet today"
      : "not scheduled today";

  return (
    <div className="flex items-center gap-3 rounded-[0.6875rem] border border-white/8 bg-white/[0.02] px-3 py-2.5">
      <button
        type="button"
        onClick={onLog}
        disabled={busy}
        aria-label={
          habit.todayCompleted
            ? `Un-log ${habit.title}`
            : `Log ${habit.title} for today`
        }
        aria-pressed={habit.todayCompleted}
        className={`flex h-[1.625rem] w-[1.625rem] flex-none items-center justify-center rounded-lg ${
          habit.todayCompleted
            ? "bg-sage/[0.14] text-sage"
            : "border-[1.5px] border-white/15 text-ink-400 hover:bg-sage/10"
        } disabled:opacity-60`}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : habit.todayCompleted ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Plus className="h-3.5 w-3.5" />
        )}
      </button>

      <span className="flex min-w-0 flex-1 flex-col gap-[0.1875rem]">
        <span className="truncate text-[0.78125rem] font-medium text-ink-200">
          {habit.title}
        </span>
        <span className="truncate text-[0.65625rem] text-ink-600">
          {subtitle}
        </span>
      </span>

      <span className="flex flex-none items-center gap-1">
        {habit.dots.map((dot) => (
          <Dot key={dot.date} dot={dot} />
        ))}
      </span>
    </div>
  );
}

export function HabitStrip({ dateStr }: { dateStr: string }) {
  const [habits, setHabits] = useState<HabitForDay[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listHabitsForDayAction(dateStr)
      .then((rows) => {
        if (!cancelled) setHabits(rows);
      })
      .catch((err) => console.error("[habits] load failed:", err));
    return () => {
      cancelled = true;
    };
  }, [dateStr]);

  if (!habits || habits.length === 0) return null;

  const log = (habit: HabitForDay) => {
    if (busyId) return;
    setBusyId(habit.id);
    // Optimistic: flip the box and nudge the run count; reconcile on response.
    setHabits((prev) =>
      prev
        ? prev.map((h) =>
            h.id === habit.id
              ? {
                  ...h,
                  todayCompleted: !h.todayCompleted,
                  runDays: h.runDays + (h.todayCompleted ? -1 : 1),
                  dots: h.dots.map((d) =>
                    d.date === dateStr
                      ? { ...d, state: h.todayCompleted ? "today" : "done" }
                      : d,
                  ),
                }
              : h,
          )
        : prev,
    );
    logHabitAction(habit.id, dateStr)
      .then((res) => {
        if (!res) return;
        setHabits((prev) =>
          prev
            ? prev.map((h) =>
                h.id === habit.id ? { ...h, todayCompleted: res.completed } : h,
              )
            : prev,
        );
      })
      .catch((err) => {
        console.error("[habits] log failed:", err);
        // Roll back the optimistic flip.
        setHabits((prev) =>
          prev
            ? prev.map((h) =>
                h.id === habit.id
                  ? {
                      ...h,
                      todayCompleted: habit.todayCompleted,
                      runDays: habit.runDays,
                      dots: habit.dots,
                    }
                  : h,
              )
            : prev,
        );
      })
      .finally(() => setBusyId(null));
  };

  return (
    <div className="mx-auto w-full max-w-[48.125rem] pl-[4.125rem] pr-7 pt-4 2xl:max-w-[56rem]">
      <div className="rounded-[0.875rem] border border-white/8 bg-panel/60 p-2.5">
        <div className="flex flex-col gap-2">
          {habits.map((habit) => (
            <HabitRow
              key={habit.id}
              habit={habit}
              busy={busyId === habit.id}
              onLog={() => log(habit)}
            />
          ))}
        </div>
        <div className="flex items-center gap-2 px-1.5 pb-0.5 pt-2.5">
          <LineChart className="h-[0.6875rem] w-[0.6875rem] flex-none text-ink-600" />
          <span className="text-[0.65625rem] leading-relaxed text-ink-600">
            Your streaks live with your notes — a miss dims the chain,{" "}
            <span className="text-ink-400">it never breaks</span>.
          </span>
        </div>
      </div>
    </div>
  );
}
