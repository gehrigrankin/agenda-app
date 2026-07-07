"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bell,
  ChevronDown,
  Flame,
  Pause,
  Pencil,
  Plus,
  Repeat,
} from "lucide-react";

import {
  createRecurringTaskAction,
  createRecurringTaskStructuredAction,
  createStandaloneTaskAction,
  deleteRecurringTaskAction,
  listRecurringTasksAction,
  listTasksDueAction,
  listTasksUpcomingAction,
  setRecurringPausedAction,
  toggleTaskAction,
  updateRecurringTaskAction,
  updateRecurringTaskStructuredAction,
  type DueTaskResult,
  type RecurringRuleResult,
} from "@/app/app/actions";
import { setRecurringHabitAction } from "@/app/app/habits/actions";
import { addDays, formatShortDate, localDateString } from "@/lib/dates";
import {
  describeSchedule,
  formatTimeLong,
  formatTimeShort,
  nextOccurrence,
  recurrenceChipLabel,
  toInputPhrase,
  weekdayOf,
  type RecurrenceFreq,
  type RecurrenceSpec,
} from "@/lib/recurrence";

/**
 * Full Tasks page (design Turn 12b): Today and Upcoming as plain lists over
 * the dotted canvas, then a Recurring section where the rules themselves
 * live — schedule, reminder, next occurrence, pause/edit/delete. Occurrences
 * of rules materialize server-side into ordinary tasks and appear in Today.
 */

const SECTION_LABEL =
  "mb-1.5 text-[0.65625rem] font-medium uppercase tracking-[0.0875rem] text-ink-600";

const TASK_ROW =
  "flex items-center gap-[0.6875rem] rounded-[0.625rem] border border-white/7 bg-panel/90 px-3 py-2.5";

const PARSE_HINT = "couldn't read a schedule — try 'every friday 4pm'";

/** "Jul 3" from the stored midnight-UTC ISO due date. */
function formatDue(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Board dot + recurring/bell chips shared by the Today and Upcoming rows. */
function TaskChips({ task }: { task: DueTaskResult }) {
  return (
    <>
      {task.boardTitle && (
        <span className="flex flex-none items-center gap-[0.3125rem] text-[0.625rem] font-medium text-sage">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: task.boardColor ?? "#9CC5AC" }}
          />
          {task.boardTitle}
        </span>
      )}
      {task.recurring && (
        <span className="flex flex-none items-center gap-1 text-[0.65625rem] font-medium text-sage">
          <Repeat className="h-[0.6875rem] w-[0.6875rem] text-sage" />
          {recurrenceChipLabel(task.recurring)}
        </span>
      )}
      {task.remindAt && (
        <span className="flex flex-none items-center gap-1 text-[0.65625rem] font-medium text-[#D9B78A]">
          <Bell className="h-[0.6875rem] w-[0.6875rem] text-[#D9B78A]" />
          {formatTimeShort(task.remindAt)}
        </span>
      )}
    </>
  );
}

function TaskRow({
  task,
  today,
  onComplete,
}: {
  task: DueTaskResult;
  today: string;
  onComplete: (task: DueTaskResult) => void;
}) {
  const dueDay = task.dueAt.slice(0, 10);
  return (
    <div className={TASK_ROW}>
      <button
        type="button"
        aria-label={`Mark “${task.title}” complete`}
        onClick={() => onComplete(task)}
        className="h-4 w-4 flex-none rounded-[0.25rem] border-[1.5px] border-ink-700 hover:bg-sage/15"
      />
      <span className="min-w-0 flex-1 truncate text-[0.84375rem] text-ink-200">
        {task.title}
      </span>
      <TaskChips task={task} />
      {dueDay < today ? (
        <span className="flex-none text-[0.65625rem] font-medium text-[#D9938A]">
          {formatDue(task.dueAt)}
        </span>
      ) : dueDay > today ? (
        <span className="flex-none text-[0.65625rem] font-medium text-ink-400">
          {formatShortDate(dueDay)}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Natural-language rule input, shared by rule edit mode and the ghost add
 * row. Shows the parse hint when `hint` is set; Enter submits, Esc cancels.
 */
function RuleInput({
  initialValue,
  hint,
  onSubmit,
  onCancel,
  onDelete,
}: {
  initialValue: string;
  hint: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (value.trim()) onSubmit(value.trim());
            } else if (e.key === "Escape") {
              onCancel();
            }
          }}
          placeholder='e.g. "review inbox every friday 4pm"'
          className="w-full min-w-0 flex-1 rounded-lg border border-white/7 bg-input px-3 py-2.5 text-[0.75rem] text-ink-100 outline-none placeholder:text-ink-600"
        />
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="flex-none text-[0.65625rem] font-medium text-[#D9938A]"
          >
            Delete
          </button>
        )}
      </div>
      {hint && (
        <p className="px-1 text-[0.65625rem] text-[#D9938A]">{PARSE_HINT}</p>
      )}
    </div>
  );
}

const FREQ_OPTIONS: { value: RecurrenceFreq; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "interval", label: "Every N days" },
  { value: "monthly", label: "Monthly" },
];
const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * Structured recurrence picker for the "Recurring tasks" section: a title, a
 * frequency segmented control, the one control that frequency needs (weekday /
 * interval / day-of-month), and an optional reminder time. No phrase to guess —
 * clicking builds a valid RecurrenceSpec directly.
 */
function StructuredRuleEditor({
  initial,
  today,
  onSubmit,
  onCancel,
  onDelete,
}: {
  initial: { title: string; spec: RecurrenceSpec } | null;
  today: string;
  onSubmit: (title: string, spec: RecurrenceSpec) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [freq, setFreq] = useState<RecurrenceFreq>(initial?.spec.freq ?? "daily");
  const [weekday, setWeekday] = useState<number>(
    initial?.spec.weekday ?? (today ? weekdayOf(today) : 1),
  );
  const [intervalDays, setIntervalDays] = useState<number>(
    initial?.spec.intervalDays ?? 2,
  );
  const [monthDay, setMonthDay] = useState<number>(
    initial?.spec.monthDay ?? (today ? Number(today.slice(8, 10)) : 1),
  );
  const [remindAt, setRemindAt] = useState<string>(initial?.spec.remindAt ?? "");

  const submit = () => {
    const t = title.trim();
    if (!t) return;
    const base = { weekday: null, intervalDays: null, monthDay: null };
    const remind = /^\d{2}:\d{2}$/.test(remindAt) ? remindAt : null;
    let spec: RecurrenceSpec;
    if (freq === "weekly") {
      spec = { ...base, freq, weekday, remindAt: remind };
    } else if (freq === "interval") {
      spec = { ...base, freq, intervalDays: Math.max(1, intervalDays), remindAt: remind };
    } else if (freq === "monthly") {
      spec = { ...base, freq, monthDay: Math.min(31, Math.max(1, monthDay)), remindAt: remind };
    } else {
      spec = { ...base, freq: "daily", remindAt: remind };
    }
    onSubmit(t, spec);
  };

  const SEG = "flex-1 rounded-md px-2 py-1.5 text-[0.71875rem] font-medium transition-colors";

  return (
    <div className="flex flex-col gap-3 rounded-[0.625rem] border border-sage/25 bg-sage/[0.05] p-3">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            onCancel();
          }
        }}
        placeholder="Recurring task title…"
        className="w-full rounded-lg border border-white/8 bg-input px-3 py-2.5 text-[0.8125rem] text-ink-100 outline-none placeholder:text-ink-600"
      />

      {/* Frequency */}
      <div className="flex gap-1 rounded-lg border border-white/8 bg-input p-1">
        {FREQ_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => setFreq(o.value)}
            className={`${SEG} ${
              freq === o.value ? "bg-sage/16 text-sage" : "text-ink-400 hover:bg-white/6"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {/* Frequency-specific control */}
      {freq === "weekly" && (
        <div className="flex items-center gap-2">
          <span className="text-[0.6875rem] text-ink-500">On</span>
          <div className="flex gap-1">
            {WEEKDAY_LETTERS.map((letter, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Weekday ${i}`}
                aria-pressed={weekday === i}
                onClick={() => setWeekday(i)}
                className={`h-7 w-7 rounded-md text-[0.6875rem] font-semibold ${
                  weekday === i
                    ? "bg-sage text-sage-ink"
                    : "bg-white/5 text-ink-400 hover:bg-white/8"
                }`}
              >
                {letter}
              </button>
            ))}
          </div>
        </div>
      )}
      {freq === "interval" && (
        <div className="flex items-center gap-2 text-[0.75rem] text-ink-400">
          Every
          <input
            type="number"
            min={1}
            max={365}
            value={intervalDays}
            onChange={(e) => setIntervalDays(Number(e.target.value))}
            className="w-16 rounded-lg border border-white/8 bg-input px-2 py-1.5 text-center text-[0.75rem] text-ink-100 outline-none"
          />
          days
        </div>
      )}
      {freq === "monthly" && (
        <div className="flex items-center gap-2 text-[0.75rem] text-ink-400">
          Day
          <input
            type="number"
            min={1}
            max={31}
            value={monthDay}
            onChange={(e) => setMonthDay(Number(e.target.value))}
            className="w-16 rounded-lg border border-white/8 bg-input px-2 py-1.5 text-center text-[0.75rem] text-ink-100 outline-none"
          />
          of each month
        </div>
      )}

      {/* Reminder time (optional) */}
      <div className="flex items-center gap-2">
        <Bell className="h-3.5 w-3.5 text-ink-500" />
        <span className="text-[0.6875rem] text-ink-500">Remind at</span>
        <input
          type="time"
          value={remindAt}
          onChange={(e) => setRemindAt(e.target.value)}
          className="rounded-lg border border-white/8 bg-input px-2 py-1.5 text-[0.75rem] text-ink-100 outline-none [color-scheme:dark]"
        />
        {remindAt && (
          <button
            type="button"
            onClick={() => setRemindAt("")}
            className="text-[0.65625rem] text-ink-500 hover:text-ink-300"
          >
            clear
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={submit}
          disabled={!title.trim()}
          className="rounded-lg bg-sage px-3 py-[0.4375rem] text-[0.71875rem] font-semibold text-sage-ink disabled:opacity-50"
        >
          {initial ? "Save" : "Add recurring task"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-2.5 py-[0.4375rem] text-[0.71875rem] font-medium text-ink-400 hover:bg-white/6"
        >
          Cancel
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="ml-auto text-[0.65625rem] font-medium text-[#D9938A]"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function RuleRow({
  rule,
  today,
  onPause,
  onResume,
  onEdit,
  onToggleHabit,
}: {
  rule: RecurringRuleResult;
  today: string;
  onPause: () => void;
  onResume: () => void;
  onEdit: () => void;
  onToggleHabit: () => void;
}) {
  const from =
    rule.lastDate && rule.lastDate >= today
      ? addDays(rule.lastDate, 1)
      : today;
  const next = nextOccurrence(rule.spec, rule.anchorDate, from);
  const schedule = `${describeSchedule(rule.spec)} · ${
    rule.spec.remindAt
      ? `reminds at ${formatTimeLong(rule.spec.remindAt)}`
      : "no reminder"
  }${rule.isHabit ? " · habit" : ""}${rule.paused ? " · paused" : ""}`;

  return (
    <div
      className={`flex items-center gap-3 rounded-[0.625rem] border border-sage/16 bg-sage/4 px-3 py-[0.6875rem] ${
        rule.paused ? "opacity-55" : ""
      }`}
    >
      <span
        className={`flex h-7 w-7 flex-none items-center justify-center rounded-lg ${
          rule.paused ? "bg-white/6" : "bg-sage/12"
        }`}
      >
        {rule.paused ? (
          <Pause className="h-[0.8125rem] w-[0.8125rem] text-ink-400" />
        ) : (
          <Repeat className="h-[0.8125rem] w-[0.8125rem] text-sage" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.8125rem] font-medium text-ink-200">
          {rule.title}
        </span>
        <span className="block text-[0.6875rem] text-ink-500">{schedule}</span>
      </span>
      {rule.paused ? (
        <button
          type="button"
          onClick={onResume}
          className="flex-none text-[0.65625rem] font-medium text-sage"
        >
          Resume
        </button>
      ) : (
        <>
          {next && (
            <span className="flex-none text-[0.6875rem] text-ink-600">
              next {formatShortDate(next)}
            </span>
          )}
          <button
            type="button"
            aria-label={`Pause “${rule.title}”`}
            onClick={onPause}
            className="flex h-[1.625rem] w-[1.625rem] flex-none items-center justify-center rounded-[0.4375rem] hover:bg-white/6"
          >
            <Pause className="h-[0.8125rem] w-[0.8125rem] text-ink-400" />
          </button>
        </>
      )}
      <button
        type="button"
        aria-label={
          rule.isHabit ? `Stop tracking “${rule.title}” as a habit` : `Track “${rule.title}” as a habit`
        }
        aria-pressed={rule.isHabit}
        title={rule.isHabit ? "Tracked as a habit" : "Track as a habit"}
        onClick={onToggleHabit}
        className={`flex h-[1.625rem] w-[1.625rem] flex-none items-center justify-center rounded-[0.4375rem] ${
          rule.isHabit ? "bg-sage/14 text-sage" : "text-ink-400 hover:bg-white/6"
        }`}
      >
        <Flame className="h-[0.8125rem] w-[0.8125rem]" />
      </button>
      <button
        type="button"
        aria-label={`Edit “${rule.title}”`}
        onClick={onEdit}
        className="flex h-[1.625rem] w-[1.625rem] flex-none items-center justify-center rounded-[0.4375rem] hover:bg-white/6"
      >
        <Pencil className="h-3 w-3 text-ink-400" />
      </button>
    </div>
  );
}

export function TasksPageClient() {
  const [today, setToday] = useState("");
  const [due, setDue] = useState<DueTaskResult[]>([]);
  const [upcoming, setUpcoming] = useState<DueTaskResult[]>([]);
  const [rules, setRules] = useState<RecurringRuleResult[]>([]);

  const [boardFilter, setBoardFilter] = useState<string | null>(null);
  const [boardMenuOpen, setBoardMenuOpen] = useState(false);

  const [addingTask, setAddingTask] = useState(false);
  const [taskDraft, setTaskDraft] = useState("");
  const taskInputRef = useRef<HTMLInputElement | null>(null);

  /** Rule id in edit mode, or "new" for the ghost add row. */
  const [editingRule, setEditingRule] = useState<string | null>(null);
  const [ruleHint, setRuleHint] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const day = localDateString();
    setToday(day);
    Promise.all([
      listTasksDueAction(day),
      listTasksUpcomingAction(day),
      listRecurringTasksAction(),
    ])
      .then(([dueRows, upcomingRows, ruleRows]) => {
        if (cancelled) return;
        setDue(dueRows);
        setUpcoming(upcomingRows);
        setRules(ruleRows);
      })
      .catch((err) => console.error("[tasks] page load failed:", err));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!boardMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBoardMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [boardMenuOpen]);

  const boards = [
    ...new Set(
      [...due, ...upcoming]
        .map((t) => t.boardTitle)
        .filter((b): b is string => b !== null),
    ),
  ];
  // A filter for a board that vanished from the loaded tasks (last task
  // completed) would hide everything while the dropdown that clears it
  // disappears too — treat it as "all".
  const effectiveBoardFilter =
    boardFilter !== null && boards.includes(boardFilter) ? boardFilter : null;
  const byBoard = (t: DueTaskResult) =>
    effectiveBoardFilter === null || t.boardTitle === effectiveBoardFilter;
  const dueShown = due.filter(byBoard);
  const upcomingShown = upcoming.filter(byBoard);
  const openCount = due.length + upcoming.length;
  // The two recurring sections are the same table, split by how they were made.
  const recurringTasks = rules.filter((r) => !r.isRule);
  const namedRules = rules.filter((r) => r.isRule);

  const refreshDue = () => {
    if (!today) return;
    listTasksDueAction(today)
      .then(setDue)
      .catch((err) => console.error("[tasks] due refresh failed:", err));
  };

  const complete = (task: DueTaskResult) => {
    const inDue = due.some((t) => t.id === task.id);
    const remove = (prev: DueTaskResult[]) =>
      prev.filter((t) => t.id !== task.id);
    if (inDue) setDue(remove);
    else setUpcoming(remove);
    toggleTaskAction(task.id, true).catch((err) => {
      console.error("[tasks] toggle failed:", err);
      const restore = (prev: DueTaskResult[]) =>
        [...prev, task].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
      if (inDue) setDue(restore);
      else setUpcoming(restore);
    });
  };

  const addTask = async () => {
    const title = taskDraft.trim();
    if (!title || !today) return;
    setTaskDraft("");
    try {
      const { id } = await createStandaloneTaskAction(title, today);
      setDue((prev) => [
        ...prev,
        {
          id,
          title,
          dueAt: `${today}T00:00:00.000Z`,
          noteId: null,
          remindAt: null,
          boardTitle: null,
          boardColor: null,
          recurring: null,
        },
      ]);
    } catch (err) {
      console.error("[tasks] create failed:", err);
      setTaskDraft(title);
    }
  };

  const setPaused = (rule: RecurringRuleResult, paused: boolean) => {
    setRules((prev) =>
      prev.map((r) => (r.id === rule.id ? { ...r, paused } : r)),
    );
    setRecurringPausedAction(rule.id, paused).catch((err) => {
      console.error("[tasks] pause failed:", err);
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, paused: rule.paused } : r)),
      );
    });
  };

  const openRuleEditor = (id: string) => {
    setEditingRule(id);
    setRuleHint(false);
  };

  const submitRuleEdit = async (rule: RecurringRuleResult, value: string) => {
    try {
      const updated = await updateRecurringTaskAction(rule.id, value, today);
      if (!updated) {
        setRuleHint(true);
        return;
      }
      setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
      setEditingRule(null);
      setRuleHint(false);
      // The reschedule may materialize an occurrence for today.
      refreshDue();
    } catch (err) {
      console.error("[tasks] rule update failed:", err);
    }
  };

  const submitRuleCreate = async (value: string) => {
    try {
      const created = await createRecurringTaskAction(value, today);
      if (!created) {
        setRuleHint(true);
        return;
      }
      setRules((prev) => [...prev, created]);
      setEditingRule(null);
      setRuleHint(false);
      // Materialization may add today's occurrence.
      refreshDue();
    } catch (err) {
      console.error("[tasks] rule create failed:", err);
    }
  };

  const submitStructuredCreate = async (title: string, spec: RecurrenceSpec) => {
    try {
      const created = await createRecurringTaskStructuredAction(title, spec, today);
      setRules((prev) => [...prev, created]);
      setEditingRule(null);
      refreshDue();
    } catch (err) {
      console.error("[tasks] recurring create failed:", err);
    }
  };

  const submitStructuredEdit = async (
    rule: RecurringRuleResult,
    title: string,
    spec: RecurrenceSpec,
  ) => {
    try {
      const updated = await updateRecurringTaskStructuredAction(
        rule.id,
        title,
        spec,
        today,
      );
      if (!updated) return;
      setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
      setEditingRule(null);
      refreshDue();
    } catch (err) {
      console.error("[tasks] recurring update failed:", err);
    }
  };

  const toggleHabit = (rule: RecurringRuleResult) => {
    const next = !rule.isHabit;
    setRules((prev) =>
      prev.map((r) => (r.id === rule.id ? { ...r, isHabit: next } : r)),
    );
    setRecurringHabitAction(rule.id, next).catch((err) => {
      console.error("[tasks] habit toggle failed:", err);
      setRules((prev) =>
        prev.map((r) =>
          r.id === rule.id ? { ...r, isHabit: rule.isHabit } : r,
        ),
      );
    });
  };

  const deleteRule = (rule: RecurringRuleResult) => {
    setRules((prev) => prev.filter((r) => r.id !== rule.id));
    setEditingRule(null);
    setRuleHint(false);
    deleteRecurringTaskAction(rule.id).catch((err) => {
      console.error("[tasks] rule delete failed:", err);
      setRules((prev) => [...prev, rule]);
    });
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto bubble-canvas-grid p-4 pt-7 md:pl-[5.75rem]">
      <div className="mx-auto w-full max-w-[55rem]">
        {/* Header */}
        <div className="mb-[1.125rem] flex flex-wrap items-center gap-3">
          <span className="text-[1.375rem] font-semibold leading-none text-ink-100">
            Tasks
          </span>
          <span className="text-[0.78125rem] text-ink-600">
            {openCount} open · {recurringTasks.length} recurring
            {namedRules.length > 0 ? ` · ${namedRules.length} rules` : ""}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {boards.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setBoardMenuOpen((o) => !o)}
                  className="flex items-center gap-1.5 rounded-lg border border-white/8 bg-white/5 px-3 py-[0.4375rem] text-[0.71875rem] font-medium text-ink-300"
                >
                  {effectiveBoardFilter ?? "All boards"}
                  <ChevronDown className="h-[0.6875rem] w-[0.6875rem] text-ink-400" />
                </button>
                {boardMenuOpen && (
                  <>
                    <button
                      type="button"
                      aria-label="Close board filter"
                      onClick={() => setBoardMenuOpen(false)}
                      className="fixed inset-0 z-30 cursor-default"
                    />
                    <div className="absolute right-0 top-full z-40 mt-1.5 w-44 overflow-hidden rounded-xl border border-white/10 bg-panel p-1.5 shadow-2xl">
                      {[null, ...boards].map((board) => (
                        <button
                          key={board ?? "__all"}
                          type="button"
                          onClick={() => {
                            setBoardFilter(board);
                            setBoardMenuOpen(false);
                          }}
                          className={`flex w-full items-center rounded-lg px-2.5 py-2 text-left text-[0.75rem] hover:bg-white/6 ${
                            effectiveBoardFilter === board
                              ? "text-sage"
                              : "text-ink-200"
                          }`}
                        >
                          {board ?? "All boards"}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setAddingTask((a) => !a);
                setTimeout(() => taskInputRef.current?.focus(), 0);
              }}
              className="flex items-center gap-1.5 rounded-lg bg-sage px-[0.8125rem] py-[0.4375rem] text-[0.71875rem] font-semibold text-sage-ink"
            >
              <Plus className="h-3 w-3 text-sage-ink" />
              New task
            </button>
          </div>
        </div>

        {/* Today */}
        <div className={SECTION_LABEL}>Today</div>
        <div className="mb-5 flex flex-col gap-0.5">
          {addingTask && (
            <input
              ref={taskInputRef}
              autoFocus
              value={taskDraft}
              onChange={(e) => setTaskDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void addTask();
                } else if (e.key === "Escape") {
                  setAddingTask(false);
                  setTaskDraft("");
                }
              }}
              placeholder="Add a task…"
              className="w-full rounded-[0.625rem] border border-white/7 bg-input px-3 py-2.5 text-[0.75rem] text-ink-100 outline-none placeholder:text-ink-600"
            />
          )}
          {dueShown.length === 0 && !addingTask ? (
            <p className="px-1 text-xs text-ink-600">Nothing due today.</p>
          ) : (
            dueShown.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                today={today}
                onComplete={complete}
              />
            ))
          )}
        </div>

        {/* Upcoming */}
        {upcomingShown.length > 0 && (
          <>
            <div className={SECTION_LABEL}>Upcoming</div>
            <div className="mb-5 flex flex-col gap-0.5">
              {upcomingShown.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  today={today}
                  onComplete={complete}
                />
              ))}
            </div>
          </>
        )}

        {/* Recurring tasks — structured schedule picker (the fixed version) */}
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[0.65625rem] font-medium uppercase tracking-[0.0875rem] text-ink-600">
            Recurring tasks
          </span>
          <span className="text-[0.65625rem] text-ink-700">
            pick a schedule — occurrences appear above on their day
          </span>
        </div>
        <div className="mb-5 flex flex-col gap-0.5">
          {recurringTasks.map((rule) =>
            editingRule === rule.id ? (
              <StructuredRuleEditor
                key={rule.id}
                initial={{ title: rule.title, spec: rule.spec }}
                today={today}
                onSubmit={(title, spec) => void submitStructuredEdit(rule, title, spec)}
                onCancel={() => setEditingRule(null)}
                onDelete={() => deleteRule(rule)}
              />
            ) : (
              <RuleRow
                key={rule.id}
                rule={rule}
                today={today}
                onPause={() => setPaused(rule, true)}
                onResume={() => setPaused(rule, false)}
                onEdit={() => setEditingRule(rule.id)}
                onToggleHabit={() => toggleHabit(rule)}
              />
            ),
          )}
          {editingRule === "new-structured" ? (
            <StructuredRuleEditor
              initial={null}
              today={today}
              onSubmit={(title, spec) => void submitStructuredCreate(title, spec)}
              onCancel={() => setEditingRule(null)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingRule("new-structured")}
              className="flex items-center gap-2 rounded-[0.625rem] px-3 py-2.5 text-left text-ink-600 hover:bg-white/3"
            >
              <Plus className="h-[0.8125rem] w-[0.8125rem] flex-none" />
              <span className="text-[0.75rem]">
                New recurring task — pick a schedule
              </span>
            </button>
          )}
        </div>

        {/* Rules — natural-language phrase (the typed version) */}
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[0.65625rem] font-medium uppercase tracking-[0.0875rem] text-ink-600">
            Rules
          </span>
          <span className="text-[0.65625rem] text-ink-700">
            type a phrase — e.g. &quot;review inbox every friday 4pm&quot;
          </span>
        </div>
        <div className="flex flex-col gap-0.5 pb-6">
          {namedRules.map((rule) =>
            editingRule === rule.id ? (
              <RuleInput
                key={rule.id}
                initialValue={toInputPhrase(rule.title, rule.spec)}
                hint={ruleHint}
                onSubmit={(value) => void submitRuleEdit(rule, value)}
                onCancel={() => {
                  setEditingRule(null);
                  setRuleHint(false);
                }}
                onDelete={() => deleteRule(rule)}
              />
            ) : (
              <RuleRow
                key={rule.id}
                rule={rule}
                today={today}
                onPause={() => setPaused(rule, true)}
                onResume={() => setPaused(rule, false)}
                onEdit={() => openRuleEditor(rule.id)}
                onToggleHabit={() => toggleHabit(rule)}
              />
            ),
          )}
          {editingRule === "new-rule" ? (
            <RuleInput
              initialValue=""
              hint={ruleHint}
              onSubmit={(value) => void submitRuleCreate(value)}
              onCancel={() => {
                setEditingRule(null);
                setRuleHint(false);
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => openRuleEditor("new-rule")}
              className="flex cursor-text items-center gap-2 rounded-[0.625rem] px-3 py-2.5 text-left text-ink-600 hover:bg-white/3"
            >
              <Plus className="h-[0.8125rem] w-[0.8125rem] flex-none" />
              <span className="text-[0.75rem]">
                New rule — type &quot;every friday 4pm&quot;
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
