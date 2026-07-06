"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bell,
  ChevronDown,
  Pause,
  Pencil,
  Plus,
  Repeat,
} from "lucide-react";

import {
  createRecurringTaskAction,
  createStandaloneTaskAction,
  deleteRecurringTaskAction,
  listRecurringTasksAction,
  listTasksDueAction,
  listTasksUpcomingAction,
  setRecurringPausedAction,
  toggleTaskAction,
  updateRecurringTaskAction,
  type DueTaskResult,
  type RecurringRuleResult,
} from "@/app/app/actions";
import { addDays, formatShortDate, localDateString } from "@/lib/dates";
import {
  describeSchedule,
  formatTimeLong,
  formatTimeShort,
  nextOccurrence,
  recurrenceChipLabel,
  toInputPhrase,
} from "@/lib/recurrence";

/**
 * Full Tasks page (design Turn 12b): Today and Upcoming as plain lists over
 * the dotted canvas, then a Recurring section where the rules themselves
 * live — schedule, reminder, next occurrence, pause/edit/delete. Occurrences
 * of rules materialize server-side into ordinary tasks and appear in Today.
 */

const SECTION_LABEL =
  "mb-1.5 text-[10.5px] font-medium uppercase tracking-[1.4px] text-ink-600";

const TASK_ROW =
  "flex items-center gap-[11px] rounded-[10px] border border-white/7 bg-panel/90 px-3 py-2.5";

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
        <span className="flex flex-none items-center gap-[5px] text-[10px] font-medium text-sage">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: task.boardColor ?? "#9CC5AC" }}
          />
          {task.boardTitle}
        </span>
      )}
      {task.recurring && (
        <span className="flex flex-none items-center gap-1 text-[10.5px] font-medium text-sage">
          <Repeat className="h-[11px] w-[11px] text-sage" />
          {recurrenceChipLabel(task.recurring)}
        </span>
      )}
      {task.remindAt && (
        <span className="flex flex-none items-center gap-1 text-[10.5px] font-medium text-[#D9B78A]">
          <Bell className="h-[11px] w-[11px] text-[#D9B78A]" />
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
        className="h-4 w-4 flex-none rounded-[4px] border-[1.5px] border-ink-700 hover:bg-sage/15"
      />
      <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink-200">
        {task.title}
      </span>
      <TaskChips task={task} />
      {dueDay < today ? (
        <span className="flex-none text-[10.5px] font-medium text-[#D9938A]">
          {formatDue(task.dueAt)}
        </span>
      ) : dueDay > today ? (
        <span className="flex-none text-[10.5px] font-medium text-ink-400">
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
          className="w-full min-w-0 flex-1 rounded-lg border border-white/7 bg-input px-3 py-2.5 text-[12px] text-ink-100 outline-none placeholder:text-ink-600"
        />
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="flex-none text-[10.5px] font-medium text-[#D9938A]"
          >
            Delete
          </button>
        )}
      </div>
      {hint && (
        <p className="px-1 text-[10.5px] text-[#D9938A]">{PARSE_HINT}</p>
      )}
    </div>
  );
}

function RuleRow({
  rule,
  today,
  onPause,
  onResume,
  onEdit,
}: {
  rule: RecurringRuleResult;
  today: string;
  onPause: () => void;
  onResume: () => void;
  onEdit: () => void;
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
  }${rule.paused ? " · paused" : ""}`;

  return (
    <div
      className={`flex items-center gap-3 rounded-[10px] border border-sage/16 bg-sage/4 px-3 py-[11px] ${
        rule.paused ? "opacity-55" : ""
      }`}
    >
      <span
        className={`flex h-7 w-7 flex-none items-center justify-center rounded-lg ${
          rule.paused ? "bg-white/6" : "bg-sage/12"
        }`}
      >
        {rule.paused ? (
          <Pause className="h-[13px] w-[13px] text-ink-400" />
        ) : (
          <Repeat className="h-[13px] w-[13px] text-sage" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink-200">
          {rule.title}
        </span>
        <span className="block text-[11px] text-ink-500">{schedule}</span>
      </span>
      {rule.paused ? (
        <button
          type="button"
          onClick={onResume}
          className="flex-none text-[10.5px] font-medium text-sage"
        >
          Resume
        </button>
      ) : (
        <>
          {next && (
            <span className="flex-none text-[11px] text-ink-600">
              next {formatShortDate(next)}
            </span>
          )}
          <button
            type="button"
            aria-label={`Pause “${rule.title}”`}
            onClick={onPause}
            className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] hover:bg-white/6"
          >
            <Pause className="h-[13px] w-[13px] text-ink-400" />
          </button>
        </>
      )}
      <button
        type="button"
        aria-label={`Edit “${rule.title}”`}
        onClick={onEdit}
        className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] hover:bg-white/6"
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
  const byBoard = (t: DueTaskResult) =>
    boardFilter === null || t.boardTitle === boardFilter;
  const dueShown = due.filter(byBoard);
  const upcomingShown = upcoming.filter(byBoard);
  const openCount = due.length + upcoming.length;

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
    <div className="h-full min-h-0 overflow-y-auto bubble-canvas-grid p-4 pt-7 md:pl-[92px]">
      <div className="mx-auto w-full max-w-[880px]">
        {/* Header */}
        <div className="mb-[18px] flex flex-wrap items-center gap-3">
          <span className="text-[22px] font-semibold leading-none text-ink-100">
            Tasks
          </span>
          <span className="text-[12.5px] text-ink-600">
            {openCount} open · {rules.length} recurring
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {boards.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setBoardMenuOpen((o) => !o)}
                  className="flex items-center gap-1.5 rounded-lg border border-white/8 bg-white/5 px-3 py-[7px] text-[11.5px] font-medium text-ink-300"
                >
                  {boardFilter ?? "All boards"}
                  <ChevronDown className="h-[11px] w-[11px] text-ink-400" />
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
                          className={`flex w-full items-center rounded-lg px-2.5 py-2 text-left text-[12px] hover:bg-white/6 ${
                            boardFilter === board
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
              className="flex items-center gap-1.5 rounded-lg bg-sage px-[13px] py-[7px] text-[11.5px] font-semibold text-sage-ink"
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
              className="w-full rounded-[10px] border border-white/7 bg-input px-3 py-2.5 text-[12px] text-ink-100 outline-none placeholder:text-ink-600"
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

        {/* Recurring */}
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[10.5px] font-medium uppercase tracking-[1.4px] text-ink-600">
            Recurring
          </span>
          <span className="text-[10.5px] text-ink-700">
            rules — occurrences appear above on their day
          </span>
        </div>
        <div className="flex flex-col gap-0.5 pb-6">
          {rules.map((rule) =>
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
              />
            ),
          )}
          {editingRule === "new" ? (
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
              onClick={() => openRuleEditor("new")}
              className="flex cursor-text items-center gap-2 rounded-[10px] px-3 py-2.5 text-left text-ink-600 hover:bg-white/3"
            >
              <Plus className="h-[13px] w-[13px] flex-none" />
              <span className="text-[12px]">
                New recurring task — e.g. &quot;review inbox every friday
                4pm&quot;
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
