"use client";

import { useEffect, useState } from "react";
import { Bell, Flame, Pause, Pencil, Plus, Repeat } from "lucide-react";

import {
  createRecurringTaskAction,
  createRecurringTaskStructuredAction,
  deleteRecurringTaskAction,
  listRecurringTasksAction,
  setRecurringPausedAction,
  updateRecurringTaskAction,
  updateRecurringTaskStructuredAction,
  type RecurringRuleResult,
} from "@/app/app/actions";
import { setRecurringHabitAction } from "@/app/app/habits/actions";
import { addDays, formatShortDate } from "@/lib/dates";
import {
  describeSchedule,
  formatTimeLong,
  nextOccurrence,
  toInputPhrase,
  weekdayOf,
  type RecurrenceFreq,
  type RecurrenceSpec,
} from "@/lib/recurrence";

/**
 * Recurring rules management, shared by the phone Tasks page and the desktop
 * page's "Repeating" smart list: the structured "Recurring tasks" (pick a
 * schedule) and the typed "Rules" (natural-language phrase). The rules
 * themselves live here — schedule, reminder, next occurrence, pause, edit,
 * delete, "track as a habit". Occurrences materialize server-side into
 * ordinary tasks, so every write that can add or remove one calls
 * `onTasksChanged` for the host page to refetch its lists.
 */

const PARSE_HINT = "couldn't read a schedule — try 'every friday 4pm'";

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
  const [freq, setFreq] = useState<RecurrenceFreq>(
    initial?.spec.freq ?? "daily",
  );
  const [weekday, setWeekday] = useState<number>(
    initial?.spec.weekday ?? (today ? weekdayOf(today) : 1),
  );
  const [intervalDays, setIntervalDays] = useState<number>(
    initial?.spec.intervalDays ?? 2,
  );
  const [monthDay, setMonthDay] = useState<number>(
    initial?.spec.monthDay ?? (today ? Number(today.slice(8, 10)) : 1),
  );
  const [remindAt, setRemindAt] = useState<string>(
    initial?.spec.remindAt ?? "",
  );

  const submit = () => {
    const t = title.trim();
    if (!t) return;
    const base = { weekday: null, intervalDays: null, monthDay: null };
    const remind = /^\d{2}:\d{2}$/.test(remindAt) ? remindAt : null;
    let spec: RecurrenceSpec;
    if (freq === "weekly") {
      spec = { ...base, freq, weekday, remindAt: remind };
    } else if (freq === "interval") {
      spec = {
        ...base,
        freq,
        intervalDays: Math.max(1, intervalDays),
        remindAt: remind,
      };
    } else if (freq === "monthly") {
      spec = {
        ...base,
        freq,
        monthDay: Math.min(31, Math.max(1, monthDay)),
        remindAt: remind,
      };
    } else {
      spec = { ...base, freq: "daily", remindAt: remind };
    }
    onSubmit(t, spec);
  };

  const SEG =
    "flex-1 rounded-md px-2 py-1.5 text-[0.71875rem] font-medium transition-colors";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-sage/25 bg-sage/[0.05] p-3">
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
              freq === o.value
                ? "bg-sage/16 text-sage"
                : "text-ink-400 hover:bg-white/6"
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
          className="rounded-lg border border-white/8 bg-input px-2 py-1.5 text-[0.75rem] text-ink-100 outline-none"
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
    rule.lastDate && rule.lastDate >= today ? addDays(rule.lastDate, 1) : today;
  const next = nextOccurrence(rule.spec, rule.anchorDate, from);
  const schedule = `${describeSchedule(rule.spec)} · ${
    rule.spec.remindAt
      ? `reminds at ${formatTimeLong(rule.spec.remindAt)}`
      : "no reminder"
  }${rule.paused ? " · paused" : ""}`;

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border border-sage/16 bg-sage/4 px-3 py-[0.6875rem] ${
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
        <span className="block whitespace-pre-wrap break-words text-[0.8125rem] font-medium text-ink-200">
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
            className="flex h-[1.625rem] w-[1.625rem] flex-none items-center justify-center rounded-[0.375rem] hover:bg-white/6"
          >
            <Pause className="h-[0.8125rem] w-[0.8125rem] text-ink-400" />
          </button>
        </>
      )}
      {/* One-way on this page: habit-flagged rules live on /app/habits, so
          flagging moves the rule there and it leaves this list. */}
      <button
        type="button"
        aria-label={`Track “${rule.title}” as a habit`}
        title="Track as a habit"
        onClick={onToggleHabit}
        className="flex h-[1.625rem] w-[1.625rem] flex-none items-center justify-center rounded-lg text-ink-400 hover:bg-white/6"
      >
        <Flame className="h-[0.8125rem] w-[0.8125rem]" />
      </button>
      <button
        type="button"
        aria-label={`Edit “${rule.title}”`}
        onClick={onEdit}
        className="flex h-[1.625rem] w-[1.625rem] flex-none items-center justify-center rounded-[0.375rem] hover:bg-white/6"
      >
        <Pencil className="h-3 w-3 text-ink-400" />
      </button>
    </div>
  );
}

export type RecurringRulesApi = ReturnType<typeof useRecurringRules>;

/** Rules state + every write the two sections make (optimistic where the
 *  original page was). Loads once `today` is known. */
export function useRecurringRules({
  today,
  onTasksChanged,
}: {
  today: string;
  /** A write may have materialized or removed occurrences — refetch lists. */
  onTasksChanged: () => void;
}) {
  const [rules, setRules] = useState<RecurringRuleResult[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  /** Rule id in edit mode, or "new-rule" / "new-structured" for the add rows. */
  const [editingRule, setEditingRule] = useState<string | null>(null);
  const [ruleHint, setRuleHint] = useState(false);

  useEffect(() => {
    if (!today) return;
    let cancelled = false;
    listRecurringTasksAction()
      .then((rows) => {
        if (!cancelled) setRules(rows);
      })
      .catch((err) => console.error("[tasks] recurring load failed:", err))
      .finally(() => {
        if (!cancelled) setRulesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [today]);

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
      onTasksChanged();
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
      onTasksChanged();
    } catch (err) {
      console.error("[tasks] rule create failed:", err);
    }
  };

  const submitStructuredCreate = async (
    title: string,
    spec: RecurrenceSpec,
  ) => {
    try {
      const created = await createRecurringTaskStructuredAction(
        title,
        spec,
        today,
      );
      setRules((prev) => [...prev, created]);
      setEditingRule(null);
      onTasksChanged();
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
      onTasksChanged();
    } catch (err) {
      console.error("[tasks] recurring update failed:", err);
    }
  };

  /**
   * Flag a rule as a habit. Habits are not tasks (CONTEXT.md): the rule moves
   * to /app/habits and leaves this page, and its already-materialized
   * occurrences drop out of the due/upcoming lists — so refresh both.
   */
  const makeHabit = (rule: RecurringRuleResult) => {
    setRules((prev) => prev.filter((r) => r.id !== rule.id));
    setRecurringHabitAction(rule.id, true)
      .then(() => onTasksChanged())
      .catch((err) => {
        console.error("[tasks] habit flag failed:", err);
        setRules((prev) => [...prev, rule]);
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

  // The two recurring sections are the same table, split by how they were made.
  const recurringTasks = rules.filter((r) => !r.isRule);
  const namedRules = rules.filter((r) => r.isRule);

  return {
    today,
    rules,
    rulesLoading,
    recurringTasks,
    namedRules,
    editingRule,
    setEditingRule,
    ruleHint,
    setRuleHint,
    setPaused,
    openRuleEditor,
    submitRuleEdit,
    submitRuleCreate,
    submitStructuredCreate,
    submitStructuredEdit,
    makeHabit,
    deleteRule,
  };
}

/**
 * The "Recurring tasks" and "Rules" blocks, unchanged from the original Tasks
 * page. `hint` overrides the Recurring tasks sub-label (the desktop page has
 * no lists "above" for occurrences to appear in).
 */
export function RecurringRulesSections({
  api,
  hint = "pick a schedule — occurrences appear above on their day",
}: {
  api: RecurringRulesApi;
  hint?: string;
}) {
  const {
    today,
    rulesLoading,
    recurringTasks,
    namedRules,
    editingRule,
    setEditingRule,
    ruleHint,
    setRuleHint,
    setPaused,
    openRuleEditor,
    submitRuleEdit,
    submitRuleCreate,
    submitStructuredCreate,
    submitStructuredEdit,
    makeHabit,
    deleteRule,
  } = api;

  const recurringSection = (
    <>
      {/* Recurring tasks — structured schedule picker (the fixed version) */}
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[0.65625rem] font-medium uppercase tracking-[0.0875rem] text-ink-600">
          Recurring tasks
        </span>
        <span className="text-[0.65625rem] text-ink-700">{hint}</span>
      </div>
      <div className="mb-5 flex flex-col gap-0.5">
        {recurringTasks.map((rule) =>
          editingRule === rule.id ? (
            <StructuredRuleEditor
              key={rule.id}
              initial={{ title: rule.title, spec: rule.spec }}
              today={today}
              onSubmit={(title, spec) =>
                void submitStructuredEdit(rule, title, spec)
              }
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
              onToggleHabit={() => makeHabit(rule)}
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
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-ink-600 hover:bg-white/3"
          >
            <Plus className="h-[0.8125rem] w-[0.8125rem] flex-none" />
            <span className="text-[0.75rem]">
              New recurring task — pick a schedule
            </span>
          </button>
        )}
      </div>
    </>
  );

  const rulesSection = (
    <>
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
        {rulesLoading ? (
          <>
            <div className="h-[3.375rem] animate-pulse rounded-xl bg-white/6" />
            <div className="h-[3.375rem] animate-pulse rounded-xl bg-white/6" />
          </>
        ) : (
          namedRules.map((rule) =>
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
                onToggleHabit={() => makeHabit(rule)}
              />
            ),
          )
        )}
        {!rulesLoading &&
          (editingRule === "new-rule" ? (
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
              className="flex cursor-text items-center gap-2 rounded-xl px-3 py-2.5 text-left text-ink-600 hover:bg-white/3"
            >
              <Plus className="h-[0.8125rem] w-[0.8125rem] flex-none" />
              <span className="text-[0.75rem]">
                New rule — type &quot;every friday 4pm&quot;
              </span>
            </button>
          ))}
      </div>
    </>
  );

  return (
    <>
      {recurringSection}
      {rulesSection}
    </>
  );
}
