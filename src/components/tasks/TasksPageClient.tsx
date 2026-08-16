"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Bell,
  ChevronDown,
  FileText,
  Flame,
  MoreHorizontal,
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
  getTasksPageDataAction,
  listRecurringTasksAction,
  listTagsAction,
  listTasksDueAction,
  listTasksRecentlyAddedAction,
  listTasksUpcomingAction,
  setRecurringPausedAction,
  setTaskDueAction,
  setTaskImportantAction,
  toggleTaskAction,
  updateRecurringTaskAction,
  updateRecurringTaskStructuredAction,
  type DueTaskResult,
  type RecentTaskResult,
  type RecurringRuleResult,
  type TagResult,
  type TagWithCountResult,
  type TasksPageDataResult,
  type UnscheduledTaskResult,
} from "@/app/app/actions";
import { setRecurringHabitAction } from "@/app/app/habits/actions";
import {
  addDays,
  formatShortDate,
  localDateString,
  parseLocalDate,
} from "@/lib/dates";
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
import { relativeTime } from "@/lib/relative-time";
import {
  EMPTY_TASK_FILTER,
  TaskFilterRail,
  isFilterActive,
  matchesTaskFilter,
  type FilterableTask,
  type TaskFilter,
} from "@/components/tasks/TaskFilterRail";
import {
  ImportantStar,
  overdueTone,
} from "@/components/tasks/ImportantStar";
import { TagChip, TaskTagPicker } from "@/components/tasks/TaskTagPicker";
import { TaskNotesPicker } from "@/components/tasks/TaskNotesPicker";
import { useOutsideClose } from "@/lib/hooks/use-outside-close";
import {
  loadCachedThenRefresh,
  viewCacheKey,
} from "@/lib/indexeddb-cache";
import { MobilePageHeader } from "@/components/layout/MobilePageHeader";

/**
 * Full Tasks page (design Turn 12b): Today and Upcoming as plain lists over
 * the dotted canvas, then a Recurring section where the rules themselves
 * live — schedule, reminder, next occurrence, pause/edit/delete. Occurrences
 * of rules materialize server-side into ordinary tasks and appear in Today.
 */

/** Section label minus its ink colour — the two overdue headers set their own,
 *  and appending a second text-* class would leave the winner to stylesheet
 *  order rather than to intent. */
const SECTION_LABEL_BASE =
  "mb-1.5 text-[0.65625rem] font-medium uppercase tracking-[0.0875rem]";
const SECTION_LABEL = `${SECTION_LABEL_BASE} text-ink-600`;

const TASK_ROW =
  "flex items-center gap-[0.6875rem] rounded-xl border border-white/7 bg-panel/90 px-3 py-2.5";

const PARSE_HINT = "couldn't read a schedule — try 'every friday 4pm'";

/** "Jul 3" from the stored midnight-UTC ISO due date. */
function formatDue(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Whole days between an overdue `dueDay` and `today` (both YYYY-MM-DD), min 1. */
function carriedDays(dueDay: string, today: string): number {
  const ms = parseLocalDate(today).getTime() - parseLocalDate(dueDay).getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
}

/** "Fri" for a this-week row's right-aligned day label. */
function weekdayLabel(dueDay: string): string {
  return parseLocalDate(dueDay).toLocaleDateString("en-US", { weekday: "short" });
}

/** Link chip back to the note a task was captured in (shared by the two
 *  note-carrying lists — Unscheduled and Recently added). */
function NoteChip({
  noteId,
  noteTitle,
  boardColor,
}: {
  noteId: string;
  noteTitle: string | null;
  boardColor: string | null;
}) {
  return (
    <Link
      href={`/app/notes/${noteId}`}
      className="flex min-w-0 flex-none items-center gap-1 rounded-full border border-white/8 bg-white/4 px-2 py-0.5 text-[0.625rem] font-medium text-ink-400 hover:bg-white/8 hover:text-ink-200"
    >
      <FileText
        className="h-[0.625rem] w-[0.625rem] flex-none"
        style={boardColor ? { color: boardColor } : undefined}
      />
      <span className="max-w-[9rem] truncate">{noteTitle || "Note"}</span>
    </Link>
  );
}

/** Everything a desktop row needs to show and edit its tags. */
type TagEditing = {
  allTags: TagWithCountResult[];
  onTagsChange: (taskId: string, tags: TagResult[]) => void;
  onTagCreated: (tag: TagResult) => void;
  /** Write-through for the important star (see `applyImportant`). */
  onImportantChange: (taskId: string, important: boolean) => void;
  /** Write-through for the NOTES picker (see `applyNoteRemoved`): the task
   *  left `noteId`, so any row's stale note chip clears. */
  onNoteRemoved: (taskId: string, noteId: string) => void;
};

/** Phone task rows keep the title lane for the title. Secondary controls live
 * behind the same single overflow target used by task rows in Today/notes. */
function PhoneTaskActions({
  taskId,
  important,
  overdue = false,
  tags,
  noteId,
  tagging,
}: {
  taskId: string;
  important: boolean;
  overdue?: boolean;
  tags: TagResult[];
  noteId: string | null;
  tagging: TagEditing;
}) {
  const [open, setOpen] = useState(false);
  const [openAbove, setOpenAbove] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  useOutsideClose(open, wrapRef, () => setOpen(false));
  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const menuHeight = 148;
    const bottomNavClearance = 76;
    setOpenAbove(
      rect.bottom + menuHeight > window.innerHeight - bottomNavClearance &&
        rect.top > menuHeight,
    );
  }, [open]);

  return (
    <span ref={wrapRef} className="relative flex flex-none">
      <button
        type="button"
        aria-label="Task actions"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Task actions"
        onClick={() => setOpen((value) => !value)}
        className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
          open
            ? "bg-white/10 text-ink-200"
            : "text-ink-500 hover:bg-white/8 hover:text-ink-200"
        }`}
      >
        <MoreHorizontal className="h-5 w-5" />
      </button>

      {open && (
        <span
          role="dialog"
          aria-label="Task actions"
          className={`animate-pop-in absolute right-0 z-40 w-52 rounded-xl border border-white/10 bg-panel p-1.5 shadow-2xl ${
            openAbove ? "bottom-full mb-1.5" : "top-full mt-1.5"
          }`}
        >
          <span className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-ink-200 hover:bg-white/6">
            <span className="min-w-0 flex-1">Importance</span>
            <ImportantStar
              important={important}
              overdue={overdue}
              onToggle={(next) => tagging.onImportantChange(taskId, next)}
            />
          </span>
          <span className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-ink-200 hover:bg-white/6">
            <span className="min-w-0 flex-1">Tags</span>
            <TaskTagPicker
              taskId={taskId}
              tags={tags}
              allTags={tagging.allTags}
              onTagsChange={tagging.onTagsChange}
              onTagCreated={tagging.onTagCreated}
            />
          </span>
          <span className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-ink-200 hover:bg-white/6">
            <span className="min-w-0 flex-1">Notes and links</span>
            <TaskNotesPicker
              taskId={taskId}
              currentNoteId={noteId}
              onRemovedFromCurrentNote={
                noteId
                  ? () => tagging.onNoteRemoved(taskId, noteId)
                  : undefined
              }
            />
          </span>
        </span>
      )}
    </span>
  );
}

/** A task's tag chips — omitted entirely when it has none. */
function TagChips({ tags }: { tags: TagResult[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="flex flex-none items-center gap-1">
      {tags.map((tag) => (
        <TagChip key={tag.id} tag={tag} />
      ))}
    </span>
  );
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
  tagging,
  onComplete,
}: {
  task: DueTaskResult;
  today: string;
  tagging: TagEditing;
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
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[0.84375rem] text-ink-200">
        {task.title}
      </span>
      <TagChips tags={task.tags} />
      <TaskChips task={task} />
      {dueDay < today ? (
        <span
          className={`flex-none text-[0.65625rem] font-medium ${overdueTone(
            true,
            task.important,
          )}`}
        >
          {formatDue(task.dueAt)}
        </span>
      ) : dueDay > today ? (
        <span className="flex-none text-[0.65625rem] font-medium text-ink-400">
          {formatShortDate(dueDay)}
        </span>
      ) : null}
      <ImportantStar
        important={task.important}
        overdue={dueDay < today}
        onToggle={(next) => tagging.onImportantChange(task.id, next)}
      />
      <TaskTagPicker
        taskId={task.id}
        tags={task.tags}
        allTags={tagging.allTags}
        onTagsChange={tagging.onTagsChange}
        onTagCreated={tagging.onTagCreated}
      />
      <TaskNotesPicker
        taskId={task.id}
        currentNoteId={task.noteId}
        onRemovedFromCurrentNote={
          task.noteId
            ? () => tagging.onNoteRemoved(task.id, task.noteId!)
            : undefined
        }
      />
    </div>
  );
}

/** Which phone bucket a row belongs to — governs its sub-line/trailing label. */
type PhoneRowVariant = "carried" | "today" | "week" | "later";

/** Phone row (design Turn 17e): 52px tall, 24px checkbox, bucket-specific sub-line. */
function PhoneTaskRow({
  task,
  today,
  variant,
  tagging,
  onComplete,
}: {
  task: DueTaskResult;
  today: string;
  variant: PhoneRowVariant;
  tagging: TagEditing;
  onComplete: (task: DueTaskResult) => void;
}) {
  const dueDay = task.dueAt.slice(0, 10);
  const days = variant === "carried" ? carriedDays(dueDay, today) : 0;
  return (
    <div className="flex min-h-[3.25rem] items-center gap-3 py-1.5">
      <button
        type="button"
        aria-label={`Mark “${task.title}” complete`}
        onClick={() => onComplete(task)}
        className="h-6 w-6 flex-none rounded-lg border-[1.5px] border-ink-700 hover:bg-sage/15"
      />
      <div className="min-w-0 flex-1">
        <span className="block whitespace-pre-wrap break-words text-[0.96875rem] text-ink-200">
          {task.title}
        </span>
        {variant === "carried" && (
          <span
            className={`block text-[0.6875rem] ${overdueTone(
              true,
              task.important,
            )}`}
          >
            carried {days} day{days === 1 ? "" : "s"}
          </span>
        )}
        {variant === "today" && task.recurring && (
          <span className="flex items-center gap-1 text-[0.6875rem] text-ink-600">
            <Repeat className="h-[0.6875rem] w-[0.6875rem]" />
            {describeSchedule(task.recurring)}
          </span>
        )}
        {/* Chips ride the sub-line rather than the title line — the row is
            52px and the title has to keep its full width. */}
        {task.tags.length > 0 && (
          <span className="mt-0.5 flex flex-wrap items-center gap-1">
            {task.tags.map((tag) => (
              <TagChip key={tag.id} tag={tag} />
            ))}
          </span>
        )}
      </div>
      <PhoneTaskActions
        taskId={task.id}
        important={task.important}
        overdue={variant === "carried"}
        tags={task.tags}
        noteId={task.noteId}
        tagging={tagging}
      />
      {variant === "week" && (
        <span className="flex-none text-[0.6875rem] font-medium text-ink-400">
          {weekdayLabel(dueDay)}
        </span>
      )}
      {variant === "later" && (
        <span className="flex-none text-[0.6875rem] font-medium text-ink-400">
          {formatShortDate(dueDay)}
        </span>
      )}
    </div>
  );
}

/** Phone filter chips (design Turn 17e) — "Someday" is omitted because this
 * page's data never includes undated tasks (the due/upcoming queries both
 * require a non-null due date), so there is no undated bucket to filter to. */
const PHONE_CHIPS: { id: "all" | "today" | "recurring"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "today", label: "Today" },
  { id: "recurring", label: "Recurring" },
];
type PhoneFilter = (typeof PHONE_CHIPS)[number]["id"];

const PHONE_SECTION_LABEL =
  "pt-3.5 pb-2 text-[0.625rem] font-medium uppercase tracking-[0.14em]";

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

/**
 * Unscheduled row (product coherence: captured tasks must stay visible until
 * scheduled). Same TASK_ROW shell as TaskRow, but no due chip — instead a
 * source-note chip linking home and a date picker that graduates the task
 * into Today/Upcoming.
 */
function UnscheduledRow({
  task,
  tagging,
  onComplete,
  onSchedule,
}: {
  task: UnscheduledTaskResult;
  tagging: TagEditing;
  onComplete: (task: UnscheduledTaskResult) => void;
  onSchedule: (task: UnscheduledTaskResult, dateStr: string) => void;
}) {
  return (
    <div className={TASK_ROW}>
      <button
        type="button"
        aria-label={`Mark “${task.title}” complete`}
        onClick={() => onComplete(task)}
        className="h-4 w-4 flex-none rounded-[0.25rem] border-[1.5px] border-ink-700 hover:bg-sage/15"
      />
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[0.84375rem] text-ink-200">
        {task.title}
      </span>
      <TagChips tags={task.tags} />
      {task.noteId && (
        <NoteChip
          noteId={task.noteId}
          noteTitle={task.noteTitle}
          boardColor={task.boardColor}
        />
      )}
      {task.boardTitle && (
        <span className="hidden flex-none items-center gap-[0.3125rem] text-[0.625rem] font-medium text-sage sm:flex">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: task.boardColor ?? "#9CC5AC" }}
          />
          {task.boardTitle}
        </span>
      )}
      <input
        type="date"
        aria-label={`Set a due date for “${task.title}”`}
        title="Schedule this task"
        onChange={(e) => {
          if (e.target.value) onSchedule(task, e.target.value);
        }}
        className="w-[7.25rem] flex-none rounded-md border border-white/8 bg-input px-1.5 py-1 text-[0.65625rem] text-ink-400 outline-none hover:text-ink-200"
      />
      {/* Undated, so never overdue — the star is the flag only, no colour. */}
      <ImportantStar
        important={task.important}
        onToggle={(next) => tagging.onImportantChange(task.id, next)}
      />
      <TaskTagPicker
        taskId={task.id}
        tags={task.tags}
        allTags={tagging.allTags}
        onTagsChange={tagging.onTagsChange}
        onTagCreated={tagging.onTagCreated}
      />
      <TaskNotesPicker
        taskId={task.id}
        currentNoteId={task.noteId}
        onRemovedFromCurrentNote={
          task.noteId
            ? () => tagging.onNoteRemoved(task.id, task.noteId!)
            : undefined
        }
      />
    </div>
  );
}

/** The phone counterpart keeps scheduling metadata below the title and folds
 * the three secondary actions into one menu, so neither can collapse the
 * title to a one-character column. */
function PhoneUnscheduledRow({
  task,
  tagging,
  onComplete,
  onSchedule,
}: {
  task: UnscheduledTaskResult;
  tagging: TagEditing;
  onComplete: (task: UnscheduledTaskResult) => void;
  onSchedule: (task: UnscheduledTaskResult, dateStr: string) => void;
}) {
  return (
    <div className="flex min-h-[3.25rem] items-start gap-3 py-2">
      <button
        type="button"
        aria-label={`Mark “${task.title}” complete`}
        onClick={() => onComplete(task)}
        className="mt-1 h-6 w-6 flex-none rounded-lg border-[1.5px] border-ink-700 hover:bg-sage/15"
      />
      <div className="min-w-0 flex-1">
        <span className="block whitespace-pre-wrap break-words text-[0.96875rem] text-ink-200">
          {task.title}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {task.tags.map((tag) => (
            <TagChip key={tag.id} tag={tag} />
          ))}
          {task.noteId && (
            <NoteChip
              noteId={task.noteId}
              noteTitle={task.noteTitle}
              boardColor={task.boardColor}
            />
          )}
          <input
            type="date"
            aria-label={`Set a due date for “${task.title}”`}
            title="Schedule this task"
            onChange={(event) => {
              if (event.target.value) onSchedule(task, event.target.value);
            }}
            className="h-8 w-[8.5rem] flex-none rounded-full border border-white/10 bg-input px-2.5 text-[0.6875rem] text-ink-400 outline-none hover:text-ink-200"
          />
        </span>
      </div>
      <PhoneTaskActions
        taskId={task.id}
        important={task.important}
        tags={task.tags}
        noteId={task.noteId}
        tagging={tagging}
      />
    </div>
  );
}

/**
 * Recently added row — the capture-order lens. Deliberately cuts across the
 * buckets above (a row here may also be in Today, Upcoming or Unscheduled), so
 * it leads with when the task was captured and states where it landed: a due
 * day, or "no date" for the ones still waiting to be scheduled.
 */
function RecentRow({
  task,
  today,
  nowMs,
  tagging,
  onComplete,
}: {
  task: RecentTaskResult;
  today: string;
  nowMs: number;
  tagging: TagEditing;
  onComplete: (task: RecentTaskResult) => void;
}) {
  return (
    <div className={TASK_ROW}>
      <button
        type="button"
        aria-label={`Mark “${task.title}” complete`}
        onClick={() => onComplete(task)}
        className="h-4 w-4 flex-none rounded-[0.25rem] border-[1.5px] border-ink-700 hover:bg-sage/15"
      />
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[0.84375rem] text-ink-200">
        {task.title}
      </span>
      <TagChips tags={task.tags} />
      {/* "long" rather than the Inbox's "short": this list reaches back as far
          as the oldest open task, and only that style tiers past days. */}
      <span className="flex-none text-[0.65625rem] text-ink-600">
        {relativeTime(task.createdAt, "long", nowMs)}
      </span>
      {task.noteId && (
        <NoteChip
          noteId={task.noteId}
          noteTitle={task.noteTitle}
          boardColor={task.boardColor}
        />
      )}
      {task.boardTitle && (
        <span className="hidden flex-none items-center gap-[0.3125rem] text-[0.625rem] font-medium text-sage sm:flex">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: task.boardColor ?? "#9CC5AC" }}
          />
          {task.boardTitle}
        </span>
      )}
      {task.due === null ? (
        <span className="flex-none text-[0.65625rem] font-medium text-ink-700">
          no date
        </span>
      ) : (
        <span
          className={`flex-none text-[0.65625rem] font-medium ${
            overdueTone(task.due < today, task.important) ?? "text-ink-400"
          }`}
        >
          {formatShortDate(task.due)}
        </span>
      )}
      <ImportantStar
        important={task.important}
        overdue={task.due !== null && task.due < today}
        onToggle={(next) => tagging.onImportantChange(task.id, next)}
      />
      <TaskTagPicker
        taskId={task.id}
        tags={task.tags}
        allTags={tagging.allTags}
        onTagsChange={tagging.onTagsChange}
        onTagCreated={tagging.onTagCreated}
      />
      <TaskNotesPicker
        taskId={task.id}
        currentNoteId={task.noteId}
        onRemovedFromCurrentNote={
          task.noteId
            ? () => tagging.onNoteRemoved(task.id, task.noteId!)
            : undefined
        }
      />
    </div>
  );
}

/** Recently-added tasks use the same roomy phone shell as the dated buckets;
 * capture/due metadata wraps beneath the title instead of competing with it. */
function PhoneRecentRow({
  task,
  today,
  nowMs,
  tagging,
  onComplete,
}: {
  task: RecentTaskResult;
  today: string;
  nowMs: number;
  tagging: TagEditing;
  onComplete: (task: RecentTaskResult) => void;
}) {
  const overdue = task.due !== null && task.due < today;
  return (
    <div className="flex min-h-[3.25rem] items-start gap-3 py-2">
      <button
        type="button"
        aria-label={`Mark “${task.title}” complete`}
        onClick={() => onComplete(task)}
        className="mt-1 h-6 w-6 flex-none rounded-lg border-[1.5px] border-ink-700 hover:bg-sage/15"
      />
      <div className="min-w-0 flex-1">
        <span className="block whitespace-pre-wrap break-words text-[0.96875rem] text-ink-200">
          {task.title}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] text-ink-600">
          <span>{relativeTime(task.createdAt, "long", nowMs)}</span>
          <span
            className={
              task.due === null
                ? "text-ink-700"
                : overdueTone(overdue, task.important) ?? "text-ink-400"
            }
          >
            {task.due === null ? "no date" : formatShortDate(task.due)}
          </span>
          {task.tags.map((tag) => (
            <TagChip key={tag.id} tag={tag} />
          ))}
          {task.noteId && (
            <NoteChip
              noteId={task.noteId}
              noteTitle={task.noteTitle}
              boardColor={task.boardColor}
            />
          )}
        </span>
      </div>
      <PhoneTaskActions
        taskId={task.id}
        important={task.important}
        overdue={overdue}
        tags={task.tags}
        noteId={task.noteId}
        tagging={tagging}
      />
    </div>
  );
}

/** Low-contrast pulse row standing in for a TASK_ROW while data loads. */
function TaskRowSkeleton() {
  return (
    <div className="h-[2.875rem] animate-pulse rounded-xl border border-white/7 bg-white/6" />
  );
}

/**
 * Folder-filter dropdown. Two breakpoints render their own trigger (a pill
 * chip on phone, a bordered button at md) around an identical menu, so the
 * menu owns the open state and the container ref `useOutsideClose` needs —
 * one shared state across both would need one ref across two wrappers, and
 * the hidden breakpoint's wrapper would swallow the visible one's clicks.
 */
function BoardFilterMenu({
  boards,
  value,
  onChange,
  wrapperClassName,
  triggerClassName,
}: {
  boards: string[];
  value: string | null;
  onChange: (board: string | null) => void;
  wrapperClassName: string;
  triggerClassName: string;
}) {
  const [open, setOpen] = useState(false);
  // Wraps the trigger too, so the press that closes the menu isn't also read
  // as an outside click (which the trigger's click would then undo).
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useOutsideClose(open, wrapRef, () => setOpen(false));

  return (
    <div ref={wrapRef} className={wrapperClassName}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={triggerClassName}
      >
        {value ?? "All folders"}
        <ChevronDown className="h-[0.6875rem] w-[0.6875rem] text-ink-400" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1.5 w-44 overflow-hidden rounded-xl border border-white/10 bg-panel p-1.5 shadow-2xl">
          {[null, ...boards].map((board) => (
            <button
              key={board ?? "__all"}
              type="button"
              onClick={() => {
                onChange(board);
                setOpen(false);
              }}
              className={`flex w-full items-center rounded-lg px-2.5 py-2 text-left text-[0.75rem] hover:bg-white/6 ${
                value === board ? "text-sage" : "text-ink-200"
              }`}
            >
              {board ?? "All folders"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TasksPageClient({ cacheScope }: { cacheScope: string }) {
  const [today, setToday] = useState("");
  const [due, setDue] = useState<DueTaskResult[]>([]);
  const [upcoming, setUpcoming] = useState<DueTaskResult[]>([]);
  const [unscheduled, setUnscheduled] = useState<UnscheduledTaskResult[]>([]);
  const [unscheduledOpen, setUnscheduledOpen] = useState(true);
  const [recent, setRecent] = useState<RecentTaskResult[]>([]);
  // Collapsed by default: its rows deliberately repeat the lists above, so it
  // opens on demand rather than doubling the page's length on every visit.
  const [recentOpen, setRecentOpen] = useState(false);
  /** "now" captured once at load, so the "22 min ago" labels don't drift apart. */
  const [nowMs, setNowMs] = useState(0);
  const [rules, setRules] = useState<RecurringRuleResult[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [recentLoading, setRecentLoading] = useState(false);
  /** Every tag the owner has — the picker's menu, including unused ones. */
  const [allTags, setAllTags] = useState<TagWithCountResult[]>([]);
  const [loading, setLoading] = useState(true);

  // Left rail (lg+): time lens, brushed due-day window, folder and traits.
  // Below lg the rail is hidden and only `board` is reachable, via the header
  // dropdown — so the rest of the filter stays at its default there.
  const [filter, setFilter] = useState<TaskFilter>(EMPTY_TASK_FILTER);

  const [addingTask, setAddingTask] = useState(false);
  const [taskDraft, setTaskDraft] = useState("");
  const taskInputRef = useRef<HTMLInputElement | null>(null);

  /** Rule id in edit mode, or "new" for the ghost add row. */
  const [editingRule, setEditingRule] = useState<string | null>(null);
  const [ruleHint, setRuleHint] = useState(false);

  // Phone-only filter chips (design Turn 17e) — desktop ignores this.
  const [phoneFilter, setPhoneFilter] = useState<PhoneFilter>("all");

  useEffect(() => {
    let cancelled = false;
    let secondaryStarted = false;
    const day = localDateString();
    setToday(day);
    setNowMs(Date.now());

    const loadSecondary = () => {
      if (secondaryStarted || cancelled) return;
      secondaryStarted = true;
      setRecentLoading(true);
      listRecurringTasksAction()
        .then((rows) => {
          if (!cancelled) setRules(rows);
        })
        .catch((err) => console.error("[tasks] recurring load failed:", err))
        .finally(() => {
          if (!cancelled) setRulesLoading(false);
        });
      listTagsAction()
        .then((rows) => {
          if (!cancelled) setAllTags(rows);
        })
        .catch((err) => console.error("[tasks] tags load failed:", err));
      listTasksRecentlyAddedAction()
        .then((rows) => {
          if (!cancelled) setRecent(rows);
        })
        .catch((err) => console.error("[tasks] recent load failed:", err))
        .finally(() => {
          if (!cancelled) setRecentLoading(false);
        });
    };

    const applyPrimary = (data: TasksPageDataResult) => {
      setDue(data.due);
      setUpcoming(data.upcoming);
      setUnscheduled(data.unscheduled);
      setLoading(false);
      loadSecondary();
    };

    void loadCachedThenRefresh({
      key: viewCacheKey(cacheScope, "tasks", day),
      refresh: () => getTasksPageDataAction(day),
      onValue: applyPrimary,
      onError: (err) => {
        console.error("[tasks] page load failed:", err);
        setLoading(false);
        loadSecondary();
      },
      cancelled: () => cancelled,
    });
    return () => {
      cancelled = true;
    };
  }, [cacheScope]);

  // Folders present in the loaded tasks, first colour seen wins.
  const boardColors = new Map<string, string | null>();
  for (const t of [...due, ...upcoming, ...unscheduled, ...recent]) {
    if (t.boardTitle !== null && !boardColors.has(t.boardTitle)) {
      boardColors.set(t.boardTitle, t.boardColor);
    }
  }
  const boards = [...boardColors.keys()];
  const boardOptions = [...boardColors].map(([title, color]) => ({
    title,
    color,
  }));
  // A filter for a board that vanished from the loaded tasks (last task
  // completed) would hide everything while the control that clears it
  // disappears too — treat it as "all".
  const effectiveBoardFilter =
    filter.board !== null && boards.includes(filter.board) ? filter.board : null;
  // Same reasoning for tags: a filter on a tag that's no longer on any open
  // task would hide everything while its chip disappears from the rail.
  const liveTagIds = new Set(
    [...due, ...upcoming, ...unscheduled, ...recent].flatMap((t) =>
      t.tags.map((tag) => tag.id),
    ),
  );
  const effectiveFilter: TaskFilter = {
    ...filter,
    board: effectiveBoardFilter,
    tags: filter.tags.filter((id) => liveTagIds.has(id)),
  };
  const filtering = isFilterActive(effectiveFilter);

  // Only the due/upcoming queries carry recurrence and reminder data; the
  // Unscheduled and Recently-added rows are the same tasks seen through a
  // different query, so the trait filters read those two fields back from
  // whichever list has them.
  const traitsById = new Map(
    [...due, ...upcoming].map((t) => [
      t.id,
      { recurring: t.recurring, remindAt: t.remindAt },
    ]),
  );
  const normDue = (t: DueTaskResult): FilterableTask => ({
    due: t.dueAt.slice(0, 10),
    important: t.important,
    boardTitle: t.boardTitle,
    recurring: t.recurring,
    remindAt: t.remindAt,
    noteId: t.noteId,
    tags: t.tags,
  });
  const normUnscheduled = (t: UnscheduledTaskResult): FilterableTask => ({
    due: null,
    important: t.important,
    boardTitle: t.boardTitle,
    recurring: null,
    remindAt: null,
    noteId: t.noteId,
    tags: t.tags,
  });
  const normRecent = (t: RecentTaskResult): FilterableTask => ({
    due: t.due,
    important: t.important,
    boardTitle: t.boardTitle,
    recurring: traitsById.get(t.id)?.recurring ?? null,
    remindAt: traitsById.get(t.id)?.remindAt ?? null,
    noteId: t.noteId,
    tags: t.tags,
  });

  const keep = (t: FilterableTask) =>
    matchesTaskFilter(t, effectiveFilter, today);
  const dueShown = due.filter((t) => keep(normDue(t)));
  const upcomingShown = upcoming.filter((t) => keep(normDue(t)));
  const unscheduledShown = unscheduled.filter((t) => keep(normUnscheduled(t)));
  const recentShown = recent.filter((t) => keep(normRecent(t)));
  const openCount = due.length + upcoming.length + unscheduled.length;
  const shownCount =
    dueShown.length + upcomingShown.length + unscheduledShown.length;
  // Every open task exactly once — the rail's counts and workload strip.
  const allOpenTasks: FilterableTask[] = [
    ...due.map(normDue),
    ...upcoming.map(normDue),
    ...unscheduled.map(normUnscheduled),
  ];
  // The two recurring sections are the same table, split by how they were made.
  const recurringTasks = rules.filter((r) => !r.isRule);
  const namedRules = rules.filter((r) => r.isRule);

  // Phone sections (design Turn 17e): the same board-filtered due/upcoming
  // lists, bucketed by carried-over / today / this-week / later, then
  // narrowed further by the chip row.
  const weekEnd = today ? addDays(today, 7) : "";
  const carriedOver = dueShown.filter((t) => t.dueAt.slice(0, 10) < today);
  const dueTodayList = dueShown.filter((t) => t.dueAt.slice(0, 10) === today);
  const thisWeekList = upcomingShown.filter((t) => t.dueAt.slice(0, 10) <= weekEnd);
  const laterList = upcomingShown.filter((t) => t.dueAt.slice(0, 10) > weekEnd);
  const matchesChip = (t: DueTaskResult) =>
    phoneFilter !== "recurring" || t.recurring !== null;
  // "Today" narrows the whole page to just what's due today; carried-over and
  // future buckets disappear rather than being individually filtered.
  const showOtherBuckets = phoneFilter !== "today";
  // The overdue pile splits by importance: red for the ones flagged important,
  // calm blue for the rest. Same rows, two sections — the point is that red
  // stops applying to everything that merely slipped. Both phone and desktop
  // read these; the phone chip filter narrows them further below.
  const overdueImportant = carriedOver.filter((t) => t.important);
  const overdueCalm = carriedOver.filter((t) => !t.important);
  const overdueImportantShown = showOtherBuckets
    ? overdueImportant.filter(matchesChip)
    : [];
  const overdueCalmShown = showOtherBuckets
    ? overdueCalm.filter(matchesChip)
    : [];
  const dueTodayShown = dueTodayList.filter(matchesChip);
  const thisWeekShown = showOtherBuckets ? thisWeekList.filter(matchesChip) : [];
  const laterShown = showOtherBuckets ? laterList.filter(matchesChip) : [];

  /**
   * A task can be on screen up to twice (its bucket plus "Recently added"),
   * so a tag edit in either copy has to land on both — the picker writes
   * through this one handler and the row it came from is irrelevant.
   */
  const applyTags = (taskId: string, tags: TagResult[]) => {
    // Keep the picker's counts honest without a refetch: the menu is the one
    // place you see "#errands 3" right after putting it on a fourth task.
    const before =
      due.find((t) => t.id === taskId)?.tags ??
      upcoming.find((t) => t.id === taskId)?.tags ??
      unscheduled.find((t) => t.id === taskId)?.tags ??
      recent.find((t) => t.id === taskId)?.tags ??
      [];
    const beforeIds = new Set(before.map((t) => t.id));
    const afterIds = new Set(tags.map((t) => t.id));
    bumpTagCounts(
      tags.filter((t) => !beforeIds.has(t.id)).map((t) => t.id),
      1,
    );
    bumpTagCounts(
      before.filter((t) => !afterIds.has(t.id)).map((t) => t.id),
      -1,
    );

    setDue((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, tags } : t)),
    );
    setUpcoming((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, tags } : t)),
    );
    setUnscheduled((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, tags } : t)),
    );
    setRecent((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, tags } : t)),
    );
  };

  /**
   * Same write-through as `applyTags`, for the important star: a task can be in
   * its due bucket and in "Recently added" at once, and starring either copy
   * has to move both (and the row between the two overdue groups).
   *
   * Optimistic like the tag picker's `save()` — the row jumps groups on click
   * and jumps back if the write loses, because waiting on a round trip to move
   * a row feels broken on a list you're triaging fast.
   */
  const applyImportant = (taskId: string, important: boolean) => {
    const mark = (value: boolean) =>
      <T extends { id: string }>(prev: T[]) =>
        prev.map((t) => (t.id === taskId ? { ...t, important: value } : t));
    const write = (value: boolean) => {
      setDue(mark(value));
      setUpcoming(mark(value));
      setUnscheduled(mark(value));
      setRecent(mark(value));
    };
    write(important);
    setTaskImportantAction(taskId, important).catch((err) => {
      console.error("[tasks] important toggle failed:", err);
      write(!important);
    });
  };

  /**
   * The NOTES picker's unlink/move dropped this task off `noteId` — clear its
   * note chip wherever it's shown (Today, Upcoming, Unscheduled, Recently
   * added) rather than refetching. Only ever clears, never sets: the picker
   * itself is the source of truth for the full list of notes a task is on.
   * `DueTaskResult` (Today/Upcoming) carries `noteId` but not `noteTitle`, so
   * it gets its own clear that doesn't touch a field it doesn't have.
   */
  const applyNoteRemoved = (taskId: string, noteId: string) => {
    const clearNoteId = <T extends { id: string; noteId: string | null }>(
      prev: T[],
    ) =>
      prev.map((t) =>
        t.id === taskId && t.noteId === noteId ? { ...t, noteId: null } : t,
      );
    const clearNoteIdAndTitle = <
      T extends { id: string; noteId: string | null; noteTitle: string | null },
    >(
      prev: T[],
    ) =>
      prev.map((t) =>
        t.id === taskId && t.noteId === noteId
          ? { ...t, noteId: null, noteTitle: null }
          : t,
      );
    setDue(clearNoteId);
    setUpcoming(clearNoteId);
    setUnscheduled(clearNoteIdAndTitle);
    setRecent(clearNoteIdAndTitle);
  };

  /**
   * Register tags the page hasn't seen at count 0 — the caller that actually
   * attached them adjusts from there, so a create-then-apply doesn't count
   * the same link twice.
   */
  const registerTags = (tags: TagResult[]) => {
    setAllTags((prev) => {
      const known = new Set(prev.map((t) => t.id));
      const fresh = tags.filter((t) => !known.has(t.id));
      if (fresh.length === 0) return prev;
      return [...prev, ...fresh.map((t) => ({ ...t, taskCount: 0 }))].sort(
        (a, b) => a.name.localeCompare(b.name),
      );
    });
  };

  /** Move the picker's open-task counts by `delta` for the given tag ids. */
  const bumpTagCounts = (ids: string[], delta: number) => {
    if (ids.length === 0) return;
    const set = new Set(ids);
    setAllTags((prev) =>
      prev.map((t) =>
        set.has(t.id)
          ? { ...t, taskCount: Math.max(0, t.taskCount + delta) }
          : t,
      ),
    );
  };

  /** A tag that didn't exist a moment ago joins the picker's menu. */
  const addKnownTag = (tag: TagResult) => registerTags([tag]);

  const tagging: TagEditing = {
    allTags,
    onTagsChange: applyTags,
    onTagCreated: addKnownTag,
    onImportantChange: applyImportant,
    onNoteRemoved: applyNoteRemoved,
  };

  const refreshDue = () => {
    if (!today) return;
    listTasksDueAction(today)
      .then(setDue)
      .catch((err) => console.error("[tasks] due refresh failed:", err));
  };

  /**
   * A task can be on screen twice — once in its due/unscheduled bucket and
   * again under "Recently added" — so every completion has to clear it from
   * both. Returns the mirror entry (if any) for the failure path to restore.
   */
  const dropFromRecent = (id: string): RecentTaskResult | undefined => {
    const entry = recent.find((t) => t.id === id);
    if (entry) setRecent((prev) => prev.filter((t) => t.id !== id));
    return entry;
  };

  const restoreRecent = (entry: RecentTaskResult | undefined) => {
    if (!entry) return;
    setRecent((prev) =>
      [...prev, entry].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  };

  const complete = (task: DueTaskResult) => {
    const inDue = due.some((t) => t.id === task.id);
    const remove = (prev: DueTaskResult[]) =>
      prev.filter((t) => t.id !== task.id);
    if (inDue) setDue(remove);
    else setUpcoming(remove);
    const recentEntry = dropFromRecent(task.id);
    toggleTaskAction(task.id, true).catch((err) => {
      console.error("[tasks] toggle failed:", err);
      const restore = (prev: DueTaskResult[]) =>
        [...prev, task].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
      if (inDue) setDue(restore);
      else setUpcoming(restore);
      restoreRecent(recentEntry);
    });
  };

  const completeUnscheduled = (task: UnscheduledTaskResult) => {
    setUnscheduled((prev) => prev.filter((t) => t.id !== task.id));
    const recentEntry = dropFromRecent(task.id);
    toggleTaskAction(task.id, true).catch((err) => {
      console.error("[tasks] toggle failed:", err);
      setUnscheduled((prev) =>
        [...prev, task].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
      restoreRecent(recentEntry);
    });
  };

  /** Completing from the Recently added list — clears the bucket copy too. */
  const completeRecent = (task: RecentTaskResult) => {
    setRecent((prev) => prev.filter((t) => t.id !== task.id));
    const dueEntry = due.find((t) => t.id === task.id);
    const upcomingEntry = upcoming.find((t) => t.id === task.id);
    const unscheduledEntry = unscheduled.find((t) => t.id === task.id);
    if (dueEntry) setDue((prev) => prev.filter((t) => t.id !== task.id));
    if (upcomingEntry) setUpcoming((prev) => prev.filter((t) => t.id !== task.id));
    if (unscheduledEntry)
      setUnscheduled((prev) => prev.filter((t) => t.id !== task.id));
    toggleTaskAction(task.id, true).catch((err) => {
      console.error("[tasks] toggle failed:", err);
      restoreRecent(task);
      const byDue = (a: DueTaskResult, b: DueTaskResult) =>
        a.dueAt.localeCompare(b.dueAt);
      if (dueEntry) setDue((prev) => [...prev, dueEntry].sort(byDue));
      if (upcomingEntry)
        setUpcoming((prev) => [...prev, upcomingEntry].sort(byDue));
      if (unscheduledEntry)
        setUnscheduled((prev) =>
          [...prev, unscheduledEntry].sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt),
          ),
        );
    });
  };

  /** Give an unscheduled task a due date — it graduates into Today/Upcoming. */
  const scheduleUnscheduled = (task: UnscheduledTaskResult, dateStr: string) => {
    setUnscheduled((prev) => prev.filter((t) => t.id !== task.id));
    // The task stays in Recently added — only its "no date" label graduates.
    setRecent((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, due: dateStr } : t)),
    );
    setTaskDueAction(task.id, dateStr)
      .then(() => {
        // The task lands in whichever list its new date belongs to.
        refreshDue();
        if (today) {
          listTasksUpcomingAction(today)
            .then(setUpcoming)
            .catch((err) =>
              console.error("[tasks] upcoming refresh failed:", err),
            );
        }
      })
      .catch((err) => {
        console.error("[tasks] schedule failed:", err);
        setUnscheduled((prev) =>
          [...prev, task].sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt),
          ),
        );
        setRecent((prev) =>
          prev.map((t) => (t.id === task.id ? { ...t, due: null } : t)),
        );
      });
  };

  const addTask = async () => {
    const draft = taskDraft.trim();
    if (!draft || !today) return;
    setTaskDraft("");
    try {
      // The server parses any "#tags" out of what was typed, so the title and
      // tags it returns are the truth — not the raw draft.
      // "!" in the draft is parsed off server-side the same way "#tags" are,
      // so `important` comes back from the server rather than from the draft.
      const { id, title, tags, important } = await createStandaloneTaskAction(
        draft,
        today,
      );
      // Applied server-side, so nothing else will move these counts.
      registerTags(tags);
      bumpTagCounts(
        tags.map((t) => t.id),
        1,
      );
      setDue((prev) => [
        ...prev,
        {
          id,
          title,
          dueAt: `${today}T00:00:00.000Z`,
          important,
          noteId: null,
          remindAt: null,
          boardTitle: null,
          boardColor: null,
          recurring: null,
          tags,
        },
      ]);
      setRecent((prev) => [
        {
          id,
          title,
          createdAt: new Date().toISOString(),
          due: today,
          important,
          noteId: null,
          noteTitle: null,
          boardTitle: null,
          boardColor: null,
          tags,
        },
        ...prev,
      ]);
    } catch (err) {
      console.error("[tasks] create failed:", err);
      setTaskDraft(draft);
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

  /**
   * Flag a rule as a habit. Habits are not tasks (CONTEXT.md): the rule moves
   * to /app/habits and leaves this page, and its already-materialized
   * occurrences drop out of the due/upcoming lists — so refresh both.
   */
  const makeHabit = (rule: RecurringRuleResult) => {
    setRules((prev) => prev.filter((r) => r.id !== rule.id));
    setRecurringHabitAction(rule.id, true)
      .then(() => {
        refreshDue();
        if (today) {
          listTasksUpcomingAction(today)
            .then(setUpcoming)
            .catch((err) =>
              console.error("[tasks] upcoming refresh failed:", err),
            );
        }
      })
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

  // Unscheduled — open tasks with no due date (product coherence: captured
  // tasks stay visible). Collapsible; hidden entirely only when empty after
  // load. Shared by the desktop and phone layouts like the sections below.
  const unscheduledSection = (loading || unscheduledShown.length > 0) && (
    <div className="mb-5">
      <button
        type="button"
        aria-expanded={unscheduledOpen}
        onClick={() => setUnscheduledOpen((o) => !o)}
        className="mb-1.5 flex items-center gap-1.5"
      >
        <span className="text-[0.65625rem] font-medium uppercase tracking-[0.0875rem] text-ink-600">
          Unscheduled
        </span>
        {!loading && (
          <span className="text-[0.65625rem] text-ink-700">
            {unscheduledShown.length} · no date yet — pick one to schedule
          </span>
        )}
        <ChevronDown
          className={`h-3 w-3 text-ink-600 transition-transform ${
            unscheduledOpen ? "" : "-rotate-90"
          }`}
        />
      </button>
      {unscheduledOpen && (
        <div className="flex flex-col gap-0.5">
          {loading ? (
            <>
              <TaskRowSkeleton />
              <TaskRowSkeleton />
            </>
          ) : (
            unscheduledShown.map((task) => (
              <div key={task.id}>
                <div className="md:hidden">
                  <PhoneUnscheduledRow
                    task={task}
                    tagging={tagging}
                    onComplete={completeUnscheduled}
                    onSchedule={scheduleUnscheduled}
                  />
                </div>
                <div className="max-md:hidden">
                  <UnscheduledRow
                    task={task}
                    tagging={tagging}
                    onComplete={completeUnscheduled}
                    onSchedule={scheduleUnscheduled}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );

  // Recently added — the same open tasks as the lists above, re-sorted by when
  // they were captured, so a batch that arrived together (an import, a jot
  // session, a quick capture run) can be reviewed as a batch. Collapsed until
  // asked for; hidden entirely once it's clear there's nothing to show.
  const recentSection =
    (loading || recentLoading || recentShown.length > 0) && (
    <div className="mb-5">
      <button
        type="button"
        aria-expanded={recentOpen}
        onClick={() => {
          // Re-stamp "now" on open so the labels are fresh on a long-lived tab.
          if (!recentOpen) setNowMs(Date.now());
          setRecentOpen((o) => !o);
        }}
        className="mb-1.5 flex items-center gap-1.5"
      >
        <span className="text-[0.65625rem] font-medium uppercase tracking-[0.0875rem] text-ink-600">
          Recently added
        </span>
        {!loading && !recentLoading && (
          <span className="text-[0.65625rem] text-ink-700">
            {recentShown.length} · newest first
          </span>
        )}
        <ChevronDown
          className={`h-3 w-3 text-ink-600 transition-transform ${
            recentOpen ? "" : "-rotate-90"
          }`}
        />
      </button>
      {recentOpen && (
        <div className="flex flex-col gap-0.5">
          {loading || recentLoading ? (
            <>
              <TaskRowSkeleton />
              <TaskRowSkeleton />
            </>
          ) : (
            recentShown.map((task) => (
              <div key={task.id}>
                <div className="md:hidden">
                  <PhoneRecentRow
                    task={task}
                    today={today}
                    nowMs={nowMs}
                    tagging={tagging}
                    onComplete={completeRecent}
                  />
                </div>
                <div className="max-md:hidden">
                  <RecentRow
                    task={task}
                    today={today}
                    nowMs={nowMs}
                    tagging={tagging}
                    onComplete={completeRecent}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );

  // Shared between the desktop layout and the phone layout (where they stay
  // reachable below the Turn 17e sections, unchanged) — plain JSX values, not
  // components, so rendering them twice doesn't cause remounts.
  const recurringSection = (
    <>
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
    <div className="h-full min-h-0 overflow-y-auto overscroll-y-contain bubble-canvas-grid md:p-4 md:pt-7 md:pl-[5.75rem]">
      <MobilePageHeader
        title="Tasks"
        subtitle={loading ? "Loading tasks…" : `${openCount} open`}
      />
      {/* The page's own margins were the widest thing on it — at lg+ the left
          one becomes the filter rail, and the column keeps its 55rem measure. */}
      <div className="mx-auto flex w-full max-w-[55rem] items-start gap-8 px-3 py-3 md:p-0 lg:max-w-[70.5rem]">
        <aside className="sticky top-1 hidden max-h-[calc(100vh-4rem)] w-[13.5rem] flex-none overflow-y-auto pb-4 pr-1 lg:block">
          <TaskFilterRail
            tasks={allOpenTasks}
            boards={boardOptions}
            today={today}
            filter={effectiveFilter}
            onChange={setFilter}
            loading={loading}
          />
        </aside>

        <div className="w-full min-w-0 flex-1 lg:max-w-[55rem]">
        {/* ── Phone (<md, design Turn 17e): header + chips + carried/today/week
            sections, the recurring/rules editors kept reachable below, and a
            pinned add-task row as the last element (main already has pb-14,
            so this sits above the global bottom tab bar without being fixed). */}
        <div className="md:hidden">
          <div className="mb-4 flex items-center gap-2 overflow-x-auto">
            {PHONE_CHIPS.map((chip) => {
              const active = phoneFilter === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setPhoneFilter(chip.id)}
                  className={`flex h-[2.125rem] flex-none items-center gap-1.5 rounded-full px-3.5 text-[0.78125rem] font-medium ${
                    active
                      ? "border border-sage/35 bg-sage/16 text-[#B7D8C4]"
                      : "border border-white/10 bg-white/3 text-ink-300"
                  }`}
                >
                  {chip.id === "recurring" && (
                    <Repeat className="h-[0.6875rem] w-[0.6875rem]" />
                  )}
                  {chip.label}
                </button>
              );
            })}
            {boards.length > 0 && (
              <BoardFilterMenu
                boards={boards}
                value={effectiveBoardFilter}
                onChange={(board) => setFilter((f) => ({ ...f, board }))}
                wrapperClassName="relative flex-none"
                triggerClassName="flex h-[2.125rem] flex-none items-center gap-1.5 rounded-full border border-white/10 bg-white/3 px-3.5 text-[0.78125rem] font-medium text-ink-300"
              />
            )}
          </div>

          {loading ? (
            <div className="flex flex-col gap-2 pb-4">
              <TaskRowSkeleton />
              <TaskRowSkeleton />
              <TaskRowSkeleton />
            </div>
          ) : (
            <>
              {/* Overdue, split by importance: the red group is only the ones
                  flagged important, so red still means something. */}
              {overdueImportantShown.length > 0 && (
                <>
                  <div className={`${PHONE_SECTION_LABEL} text-overdue`}>
                    Overdue
                  </div>
                  <div className="flex flex-col divide-y divide-white/5">
                    {overdueImportantShown.map((task) => (
                      <PhoneTaskRow
                        key={task.id}
                        task={task}
                        today={today}
                        variant="carried"
                        tagging={tagging}
                        onComplete={complete}
                      />
                    ))}
                  </div>
                </>
              )}

              {overdueCalmShown.length > 0 && (
                <>
                  <div className={`${PHONE_SECTION_LABEL} text-overdue-calm`}>
                    Carried over
                  </div>
                  <div className="flex flex-col divide-y divide-white/5">
                    {overdueCalmShown.map((task) => (
                      <PhoneTaskRow
                        key={task.id}
                        task={task}
                        today={today}
                        variant="carried"
                        tagging={tagging}
                        onComplete={complete}
                      />
                    ))}
                  </div>
                </>
              )}

              <div className={`${PHONE_SECTION_LABEL} text-ink-600`}>
                Due today
              </div>
              <div className="flex flex-col divide-y divide-white/5">
                {dueTodayShown.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-ink-600">
                    Nothing due today.
                  </p>
                ) : (
                  dueTodayShown.map((task) => (
                    <PhoneTaskRow
                      key={task.id}
                      task={task}
                      today={today}
                      variant="today"
                        tagging={tagging}
                      onComplete={complete}
                    />
                  ))
                )}
              </div>

              {thisWeekShown.length > 0 && (
                <>
                  <div className={`${PHONE_SECTION_LABEL} text-ink-600`}>
                    This week
                  </div>
                  <div className="flex flex-col divide-y divide-white/5">
                    {thisWeekShown.map((task) => (
                      <PhoneTaskRow
                        key={task.id}
                        task={task}
                        today={today}
                        variant="week"
                        tagging={tagging}
                        onComplete={complete}
                      />
                    ))}
                  </div>
                </>
              )}

              {laterShown.length > 0 && (
                <>
                  <div className={`${PHONE_SECTION_LABEL} text-ink-600`}>
                    Later
                  </div>
                  <div className="flex flex-col divide-y divide-white/5">
                    {laterShown.map((task) => (
                      <PhoneTaskRow
                        key={task.id}
                        task={task}
                        today={today}
                        variant="later"
                        tagging={tagging}
                        onComplete={complete}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {/* Unscheduled: same recovery section as desktop. Hidden while the
              "Today" chip narrows the page and under the Recurring chip
              (unscheduled tasks are never recurring occurrences). */}
          {!loading && showOtherBuckets && phoneFilter !== "recurring" && (
            <div className="mt-2">
              {unscheduledSection}
              {recentSection}
            </div>
          )}

          {/* Recurring/rules editors and habit history aren't in the Turn 17e
              spec, but stay reachable here rather than disappearing. */}
          <div className="mt-2">{recurringSection}</div>
          {rulesSection}

          {/* Pinned add-task row — the existing standalone-task action,
              defaulting to today's date. */}
          <div className="flex h-12 items-center gap-2.5 rounded-3xl border border-white/10 bg-white/4 px-3.5">
            <Plus className="h-4 w-4 flex-none text-ink-500" />
            <input
              value={taskDraft}
              onChange={(e) => setTaskDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void addTask();
                }
              }}
              placeholder="Add a task… #tag to label it"
              className="w-full min-w-0 flex-1 bg-transparent text-[0.875rem] text-ink-100 outline-none placeholder:text-ink-500"
            />
          </div>
        </div>

        {/* ── Desktop (md+, design Turn 12b): unchanged Today/Upcoming lists
            plus the Recurring tasks and Rules sections. ── */}
        <div className="hidden md:block">
          {/* Header */}
          <div className="mb-[1.125rem] flex flex-wrap items-center gap-3">
            <span className="text-[1.375rem] font-semibold leading-none text-ink-100">
              Tasks
            </span>
            {loading ? (
              <div className="h-3 w-28 animate-pulse rounded bg-white/6" />
            ) : (
              <span className="text-[0.78125rem] text-ink-600">
                {filtering ? (
                  <span className="text-sage">
                    {shownCount} of {openCount} open
                  </span>
                ) : (
                  `${openCount} open`
                )}{" "}
                · {recurringTasks.length} recurring
                {namedRules.length > 0 ? ` · ${namedRules.length} rules` : ""}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              {/* At lg+ the rail owns folder selection — this is the md-width
                  fallback for the same state. */}
              {boards.length > 0 && (
                <BoardFilterMenu
                  boards={boards}
                  value={effectiveBoardFilter}
                  onChange={(board) => setFilter((f) => ({ ...f, board }))}
                  wrapperClassName="relative lg:hidden"
                  triggerClassName="flex items-center gap-1.5 rounded-lg border border-white/8 bg-white/5 px-3 py-[0.4375rem] text-[0.71875rem] font-medium text-ink-300"
                />
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

          {/* Overdue, in two groups. Everything late used to land in one red
              list under "Today", which made red the colour of "you have tasks"
              rather than of "this one matters". Now only the starred ones are
              red; the rest carry over in calm blue. */}
          {!loading && overdueImportant.length > 0 && (
            <>
              <div className={`${SECTION_LABEL_BASE} text-overdue`}>Overdue</div>
              <div className="mb-5 flex flex-col gap-0.5">
                {overdueImportant.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    today={today}
                    tagging={tagging}
                    onComplete={complete}
                  />
                ))}
              </div>
            </>
          )}

          {!loading && overdueCalm.length > 0 && (
            <>
              <div className={`${SECTION_LABEL_BASE} text-overdue-calm`}>
                Carried over
              </div>
              <div className="mb-5 flex flex-col gap-0.5">
                {overdueCalm.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    today={today}
                    tagging={tagging}
                    onComplete={complete}
                  />
                ))}
              </div>
            </>
          )}

          {/* Today — "Nothing due today." is the right empty state for an
              unfiltered page, but under a rail filter it would read as a
              result; there the whole section drops out instead. */}
          {(loading || !filtering || dueTodayList.length > 0 || addingTask) && (
            <>
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
                placeholder="Add a task… #tag to label it, ! if it matters"
                className="w-full rounded-xl border border-white/7 bg-input px-3 py-2.5 text-[0.75rem] text-ink-100 outline-none placeholder:text-ink-600"
              />
            )}
            {loading ? (
              <>
                <TaskRowSkeleton />
                <TaskRowSkeleton />
                <TaskRowSkeleton />
              </>
            ) : dueTodayList.length === 0 && !addingTask ? (
              <p className="px-1 text-xs text-ink-600">Nothing due today.</p>
            ) : (
              dueTodayList.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  today={today}
                  tagging={tagging}
                  onComplete={complete}
                />
              ))
            )}
          </div>
            </>
          )}

          {/* Upcoming */}
          {loading ? (
            <>
              <div className={SECTION_LABEL}>Upcoming</div>
              <div className="mb-5 flex flex-col gap-0.5">
                <TaskRowSkeleton />
                <TaskRowSkeleton />
              </div>
            </>
          ) : upcomingShown.length > 0 && (
            <>
              <div className={SECTION_LABEL}>Upcoming</div>
              <div className="mb-5 flex flex-col gap-0.5">
                {upcomingShown.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    today={today}
                    tagging={tagging}
                    onComplete={complete}
                  />
                ))}
              </div>
            </>
          )}

          {unscheduledSection}
          {recentSection}

          {/* Nothing matched — every section above hid itself, so say why and
              offer the way back rather than leaving a blank page. */}
          {!loading && filtering && shownCount === 0 && (
            <div className="mb-5 rounded-xl border border-white/7 bg-panel/60 px-4 py-6 text-center">
              <p className="text-[0.8125rem] text-ink-400">
                No open tasks match these filters.
              </p>
              <button
                type="button"
                onClick={() => setFilter(EMPTY_TASK_FILTER)}
                className="mt-2 text-[0.71875rem] font-medium text-sage hover:underline"
              >
                Clear filters
              </button>
            </div>
          )}

          {recurringSection}
          {rulesSection}
        </div>
        </div>
      </div>
    </div>
  );
}
