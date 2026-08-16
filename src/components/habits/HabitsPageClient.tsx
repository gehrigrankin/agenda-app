"use client";
import { useCallback, useEffect, useState, useTransition } from "react";
import {
  Check,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { MobilePageHeader } from "@/components/layout/MobilePageHeader";
import {
  createHabitAction,
  deleteHabitAction,
  listHabitsForDayAction,
  logHabitAction,
  setHabitPausedAction,
  updateHabitAction,
} from "@/app/app/habits/actions";
import { localDateString } from "@/lib/dates";
import { weekdayOf } from "@/lib/recurrence";
import type { HabitDot, HabitForDay } from "@/server/habits";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
type Draft = {
  title: string;
  weekdays: number[];
  startDate: string;
  endDate: string;
  remindAt: string;
};

function DayCell({ dot, today }: { dot: HabitDot; today: string }) {
  const done = dot.state === "done";
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span
        className={`h-2.5 w-2.5 rounded-full ${done ? "bg-sage" : dot.date === today ? "border border-ink-600" : "bg-white/10"}`}
      />
      <span className="text-[0.625rem] text-ink-600">
        {DAYS[weekdayOf(dot.date)][0]}
      </span>
    </div>
  );
}

function HabitForm({
  initial,
  today,
  onCancel,
  onSaved,
}: {
  initial?: HabitForDay;
  today: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>({
    title: initial?.title ?? "",
    weekdays: initial?.weekdays?.length ? initial.weekdays : [weekdayOf(today)],
    startDate: initial?.startDate ?? today,
    endDate: initial?.endDate ?? "",
    remindAt: initial?.remindAt ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const toggle = (day: number) =>
    setDraft((d) => ({
      ...d,
      weekdays: d.weekdays.includes(day)
        ? d.weekdays.filter((x) => x !== day)
        : [...d.weekdays, day].sort(),
    }));
  const save = () => {
    if (!draft.title.trim() || !draft.weekdays.length)
      return setError("Add a name and choose at least one day.");
    startTransition(async () => {
      try {
        const input = {
          title: draft.title,
          weekdays: draft.weekdays,
          startDate: draft.startDate || today,
          endDate: draft.endDate || null,
          remindAt: draft.remindAt || null,
        };
        if (initial) await updateHabitAction(initial.id, input);
        else await createHabitAction(input);
        onSaved();
      } catch (e) {
        console.error(e);
        setError("Couldn’t save this habit.");
      }
    });
  };
  return (
    <div className="rounded-2xl border border-sage/25 bg-white/3 p-4">
      <div className="flex gap-2">
        <input
          autoFocus
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder="Habit name…"
          className="min-w-0 flex-1 border-b border-sage/40 bg-transparent py-1 text-base outline-none"
        />
        <button onClick={onCancel} aria-label="Cancel">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mb-2 mt-4 text-xs text-ink-500">Repeat on</p>
      <div className="grid grid-cols-7 gap-1">
        {DAYS.map((name, day) => (
          <button
            key={name}
            onClick={() => toggle(day)}
            className={`min-h-9 rounded-lg text-xs ${draft.weekdays.includes(day) ? "bg-sage text-sage-ink" : "bg-white/5 text-ink-400"}`}
          >
            {name[0]}
          </button>
        ))}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-ink-500">
          Starts
          <input
            type="date"
            value={draft.startDate}
            onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
            className="mt-1 w-full rounded-lg border border-white/8 bg-input p-2 text-ink-200"
          />
        </label>
        <label className="text-xs text-ink-500">
          Ends (optional)
          <input
            type="date"
            min={draft.startDate}
            value={draft.endDate}
            onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
            className="mt-1 w-full rounded-lg border border-white/8 bg-input p-2 text-ink-200"
          />
        </label>
        <label className="text-xs text-ink-500">
          Reminder
          <input
            type="time"
            value={draft.remindAt}
            onChange={(e) => setDraft({ ...draft, remindAt: e.target.value })}
            className="mt-1 w-full rounded-lg border border-white/8 bg-input p-2 text-ink-200"
          />
        </label>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-2 text-xs">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={pending}
          className="flex items-center gap-1 rounded-lg bg-sage px-3 py-2 text-xs font-semibold text-sage-ink"
        >
          {pending && <Loader2 className="h-3 w-3 animate-spin" />}Save
        </button>
      </div>
    </div>
  );
}

function HabitCard({
  habit,
  today,
  busy,
  reload,
  log,
}: {
  habit: HabitForDay;
  today: string;
  busy: boolean;
  reload: () => void;
  log: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  if (editing)
    return (
      <HabitForm
        initial={habit}
        today={today}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          reload();
        }}
      />
    );
  const act = (fn: () => Promise<void>) =>
    startTransition(async () => {
      await fn();
      reload();
    });
  const schedule = (habit.weekdays ?? []).map((d) => DAYS[d]).join(", ");
  return (
    <div
      className={`rounded-2xl border border-white/8 bg-white/3 p-4 ${habit.paused ? "opacity-60" : ""}`}
    >
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{habit.title}</p>
          <p className="text-xs text-ink-600">
            {habit.paused
              ? "Paused"
              : `${schedule}${habit.remindAt ? ` · ${habit.remindAt}` : ""}`}
          </p>
        </div>
        <button
          onClick={() => setEditing(true)}
          className="p-2"
          aria-label="Edit"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          disabled={pending}
          onClick={() =>
            act(() => setHabitPausedAction(habit.id, !habit.paused))
          }
          className="p-2"
          aria-label={habit.paused ? "Resume" : "Pause"}
        >
          {habit.paused ? (
            <Play className="h-4 w-4" />
          ) : (
            <Pause className="h-4 w-4" />
          )}
        </button>
        <button
          disabled={pending}
          onClick={() => {
            if (confirm(`Delete “${habit.title}”?`))
              act(() => deleteHabitAction(habit.id));
          }}
          className="p-2"
          aria-label="Delete"
        >
          <Trash2 className="h-4 w-4" />
        </button>
        <button
          onClick={log}
          disabled={busy || habit.paused || !habit.scheduledToday}
          className={`flex h-12 w-12 items-center justify-center rounded-full border ${habit.todayCompleted ? "border-sage bg-sage/15" : "border-white/20"} disabled:opacity-30`}
        >
          {busy ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : habit.todayCompleted ? (
            <Check className="h-5 w-5 text-sage" />
          ) : (
            <Plus className="h-5 w-5" />
          )}
        </button>
      </div>
      <div className="mt-4 grid grid-cols-7">
        {habit.dots.map((d) => (
          <DayCell key={d.date} dot={d} today={today} />
        ))}
      </div>
    </div>
  );
}

export function HabitsPageClient() {
  const [today, setToday] = useState("");
  const [habits, setHabits] = useState<HabitForDay[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => setToday(localDateString()), []);
  const load = useCallback(async () => {
    if (today) setHabits(await listHabitsForDayAction(today, true));
  }, [today]);
  useEffect(() => {
    void load();
  }, [load]);
  const log = (h: HabitForDay) => {
    setBusy(h.id);
    logHabitAction(h.id, today)
      .then(load)
      .finally(() => setBusy(null));
  };
  return (
    <div className="h-full overflow-y-auto overscroll-y-contain md:pl-[5.75rem]">
      <MobilePageHeader
        title="Habits"
        subtitle={
          habits === null
            ? "Loading today…"
            : `${habits.filter((habit) => habit.todayCompleted).length} of ${habits.length} done today`
        }
      />
      <div className="mx-auto max-w-xl px-3 pb-8 md:px-4">
        <h1 className="hidden py-4 text-2xl font-semibold md:block">Habits</h1>
        <div className="flex flex-col gap-3">
          {habits === null ? (
            <div className="h-32 animate-pulse rounded-2xl bg-white/3" />
          ) : (
            habits.map((h) => (
              <HabitCard
                key={h.id}
                habit={h}
                today={today}
                busy={busy === h.id}
                reload={() => void load()}
                log={() => log(h)}
              />
            ))
          )}
          {adding ? (
            <HabitForm
              today={today}
              onCancel={() => setAdding(false)}
              onSaved={() => {
                setAdding(false);
                void load();
              }}
            />
          ) : (
            habits && (
              <button
                onClick={() => setAdding(true)}
                className="flex h-12 items-center justify-center gap-2 rounded-3xl border border-dashed border-white/15"
              >
                <Plus className="h-4 w-4" />
                Add a habit
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
