"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Check, ChevronLeft, Loader2, Plus, X } from "lucide-react";

import { createRecurringTaskAction } from "@/app/app/actions";
import {
  listHabitsForDayAction,
  logHabitAction,
  setRecurringHabitAction,
} from "@/app/app/habits/actions";
import type { HabitDot, HabitForDay } from "@/server/habits";
import { localDateString } from "@/lib/dates";
import { weekdayOf } from "@/lib/recurrence";

/**
 * Habits page (design Turn 17g): the phone tab bar's Habits destination —
 * one card per tracked habit with a big one-tap log button and a 7-day
 * streak strip. Reuses the exact data + actions the daily-note HabitStrip
 * and the Tasks page's habit history already use (`src/server/habits.ts`);
 * this page just gives them a dedicated, full-width home.
 */

const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

function DayCell({ dot, isToday }: { dot: HabitDot; isToday: boolean }) {
  const logged = dot.state === "done";
  const dotClass = isToday
    ? logged
      ? "bg-sage shadow-[0_0_0_3px_rgba(156,197,172,0.2)]"
      : "border-[1.5px] border-ink-700"
    : logged
      ? "bg-sage"
      : "bg-[#3A403D]";
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className={`h-[0.6875rem] w-[0.6875rem] rounded-full ${dotClass}`} />
      <span
        className={`text-[0.625rem] ${isToday ? "text-[#B7D8C4]" : "text-ink-600"}`}
      >
        {WEEKDAY_INITIALS[weekdayOf(dot.date)]}
      </span>
    </div>
  );
}

function HabitCard({
  habit,
  today,
  busy,
  onLog,
}: {
  habit: HabitForDay;
  today: string;
  busy: boolean;
  onLog: () => void;
}) {
  const subtitle = habit.todayCompleted
    ? `logged${habit.runDays > 0 ? ` · ${habit.runDays}-day run` : ""}`
    : "not yet today";

  return (
    <div className="rounded-2xl border border-white/8 bg-white/3 p-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[1.03125rem] font-semibold text-ink-100">
            {habit.title}
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-600">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onLog}
          disabled={busy}
          aria-label={
            habit.todayCompleted
              ? `Un-log ${habit.title} for today`
              : `Log ${habit.title} for today`
          }
          aria-pressed={habit.todayCompleted}
          className={`flex h-[3.25rem] w-[3.25rem] flex-none items-center justify-center rounded-full transition-colors ${
            habit.todayCompleted
              ? "border-[1.5px] border-sage/40 bg-sage/16"
              : "border-[1.5px] border-white/18 hover:bg-white/6"
          } disabled:opacity-60`}
        >
          {busy ? (
            <Loader2 className="h-[1.375rem] w-[1.375rem] animate-spin text-ink-300" />
          ) : habit.todayCompleted ? (
            <Check className="h-[1.375rem] w-[1.375rem] text-sage" />
          ) : (
            <Plus className="h-[1.375rem] w-[1.375rem] text-ink-300" />
          )}
        </button>
      </div>
      <div className="mt-4 grid grid-cols-7 gap-1">
        {habit.dots.map((dot) => (
          <DayCell key={dot.date} dot={dot} isToday={dot.date === today} />
        ))}
      </div>
    </div>
  );
}

/** Dashed footer panel: collapsed = tap to add, expanded = inline name entry
 * that reuses `createRecurringTaskAction` (typed-phrase recurrence, same as
 * the Tasks page) plus `setRecurringHabitAction` to flag the new rule as a
 * habit — a daily habit by default; the schedule can be changed on Tasks. */
function AddHabitFooter({
  today,
  onCreated,
}: {
  today: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const cancel = () => {
    setOpen(false);
    setName("");
    setError(null);
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    startTransition(async () => {
      try {
        const rule = await createRecurringTaskAction(`${trimmed} every day`, today);
        if (!rule) {
          setError("couldn't create that habit — try again");
          return;
        }
        await setRecurringHabitAction(rule.id, true);
        setName("");
        setOpen(false);
        setError(null);
        onCreated();
      } catch (err) {
        console.error("[habits] create failed:", err);
        setError("couldn't create that habit — try again");
      }
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-12 w-full items-center justify-center gap-1.5 rounded-[0.875rem] border-[1.5px] border-dashed border-white/14 text-sm text-ink-400 hover:text-ink-300"
      >
        <Plus className="h-4 w-4" />
        Add a habit
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-[0.875rem] border-[1.5px] border-dashed border-sage/30 bg-white/3 p-3">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={name}
          disabled={pending}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") cancel();
          }}
          placeholder="Habit name…"
          className="min-w-0 flex-1 border-b border-sage/50 bg-transparent px-0.5 py-1 text-sm text-ink-100 outline-none placeholder:text-ink-600 disabled:opacity-60"
        />
        <button
          type="button"
          aria-label="Cancel"
          onClick={cancel}
          className="flex h-7 w-7 flex-none items-center justify-center rounded-md hover:bg-white/6"
        >
          <X className="h-3.5 w-3.5 text-ink-400" />
        </button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.6875rem] text-ink-600">
          Logs daily — adjust the schedule on Tasks.
        </span>
        <button
          type="button"
          disabled={pending || !name.trim()}
          onClick={submit}
          className="flex flex-none items-center gap-1.5 rounded-lg bg-sage/16 px-3 py-1.5 text-xs font-semibold text-sage disabled:opacity-50"
        >
          {pending && <Loader2 className="h-3 w-3 animate-spin" />}
          Add
        </button>
      </div>
      {error && <span className="text-[0.6875rem] text-red-400">{error}</span>}
    </div>
  );
}

export function HabitsPageClient() {
  const [today, setToday] = useState("");
  const [habits, setHabits] = useState<HabitForDay[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setToday(localDateString());
  }, []);

  const load = (dateStr: string) => {
    listHabitsForDayAction(dateStr)
      .then((rows) => setHabits(rows))
      .catch((err) => console.error("[habits] load failed:", err));
  };

  useEffect(() => {
    if (today) load(today);
  }, [today]);

  const log = (habit: HabitForDay) => {
    if (busyId || !today) return;
    setBusyId(habit.id);
    // Optimistic: flip the button and the today-dot, same as HabitStrip.
    setHabits((prev) =>
      prev
        ? prev.map((h) =>
            h.id === habit.id
              ? {
                  ...h,
                  todayCompleted: !h.todayCompleted,
                  runDays: h.runDays + (h.todayCompleted ? -1 : 1),
                  dots: h.dots.map((d) =>
                    d.date === today
                      ? { ...d, state: h.todayCompleted ? "today" : "done" }
                      : d,
                  ),
                }
              : h,
          )
        : prev,
    );
    logHabitAction(habit.id, today)
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

  const loaded = habits !== null;
  const empty = loaded && habits.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto md:pl-[5.75rem]">
      <div className="mx-auto w-full max-w-xl px-4 pb-8">
        {/* Phone back bar — Habits lives inside Today on phone. */}
        <div className="relative -mx-2 flex h-11 items-center md:hidden">
          <Link
            href="/app"
            className="flex h-11 items-center gap-0.5 px-2 text-[0.9375rem] font-medium text-sage"
          >
            <ChevronLeft className="h-5 w-5" />
            Today
          </Link>
          <span className="absolute left-1/2 -translate-x-1/2 text-[1rem] font-semibold text-ink-100">
            Habits
          </span>
        </div>
        <h1 className="hidden pb-4 pt-4 text-2xl font-semibold text-ink-100 md:block">
          Habits
        </h1>

        <div className="mt-2 flex flex-col gap-3 md:mt-0">
          {!loaded &&
            Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-[8.5rem] animate-pulse rounded-2xl border border-white/8 bg-white/3"
              />
            ))}

          {loaded &&
            habits.map((habit) => (
              <HabitCard
                key={habit.id}
                habit={habit}
                today={today}
                busy={busyId === habit.id}
                onLog={() => log(habit)}
              />
            ))}

          {empty && (
            <p className="px-1 text-sm leading-relaxed text-ink-500">
              No habits yet — the ones you track show up here with a one-tap
              log button and a 7-day streak.
            </p>
          )}

          {loaded && <AddHabitFooter today={today} onCreated={() => load(today)} />}
        </div>
      </div>
    </div>
  );
}
