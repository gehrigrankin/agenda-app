"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bell,
  Calendar,
  CalendarClock,
  Check,
  ChevronRight,
  CornerLeftUp,
  FileText,
  Maximize2,
  Plus,
  Repeat,
  SquareCheck,
} from "lucide-react";

import {
  createStandaloneTaskAction,
  listTasksDoneAction,
  listTasksDueAction,
  toggleTaskAction,
  type DoneTaskResult,
  type DueTaskResult,
} from "@/app/app/actions";
import { TASKS_CHANGED_EVENT } from "@/components/layout/NavRail";
import { localDateString, localDayBounds } from "@/lib/dates";
import { formatTimeShort, recurrenceChipLabel } from "@/lib/recurrence";

/** "Jul 3" from the stored midnight-UTC ISO due date. */
function formatDue(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const SECTION_LABEL =
  "px-4 pb-1 pt-3.5 text-[0.625rem] font-medium uppercase tracking-[0.0875rem]";

/** Whole days a task has been carried past its due date (≥1 when overdue). */
function carriedDays(dueAt: string, day: string): number {
  return Math.max(
    1,
    Math.round(
      (new Date(`${day}T00:00:00Z`).getTime() - new Date(dueAt).getTime()) /
        86_400_000,
    ),
  );
}

/**
 * Done row plus the full task captured when it was completed in this widget,
 * so uncompleting restores the real fields (due date, chips, note link)
 * instead of a fabricated task. Server-loaded done rows lack it — refetch.
 */
type DoneEntry = DoneTaskResult & { original?: DueTaskResult };

/** Quiet recurring/reminder chip for an open-task row — recurring wins. */
function TaskChip({ task }: { task: DueTaskResult }) {
  if (task.recurring) {
    return (
      <span className="flex flex-none items-center gap-1 text-[0.625rem] font-medium text-sage">
        <Repeat className="h-[0.6875rem] w-[0.6875rem] text-sage" />
        {recurrenceChipLabel(task.recurring)}
      </span>
    );
  }
  if (task.remindAt) {
    return (
      <span className="flex flex-none items-center gap-1 text-[0.625rem] font-medium text-[#D9B78A]">
        <Bell className="h-[0.6875rem] w-[0.6875rem] text-[#D9B78A]" />
        {formatTimeShort(task.remindAt)}
      </span>
    );
  }
  return null;
}

/**
 * Tasks widget (home right column + /app/tasks): carried-over (overdue) tasks
 * pinned at top, then due on the viewed day, then done that day, with a
 * quick-add input at the bottom. `dateStr` is the viewed local day (defaults
 * to today); successor of the old daily map's TaskDock.
 */
export function TasksWidget({
  dateStr,
  expandHref,
}: {
  dateStr?: string;
  expandHref?: string;
}) {
  const [due, setDue] = useState<DueTaskResult[]>([]);
  const [done, setDone] = useState<DoneEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [day, setDay] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const viewed = dateStr ?? localDateString();
    setDay(viewed);
    const load = (isInitial: boolean) => {
      // completedAt is an absolute instant, so send the local day's bounds.
      const { start, end } = localDayBounds(viewed);
      Promise.all([
        // Pass real today so viewing a FUTURE day doesn't advance recurrence.
        listTasksDueAction(viewed, localDateString()),
        listTasksDoneAction(start.toISOString(), end.toISOString()),
      ])
        .then(([dueRows, doneRows]) => {
          if (cancelled) return;
          setDue(dueRows);
          setDone(doneRows);
        })
        .catch((err) => console.error("[tasks] widget load failed:", err))
        .finally(() => {
          if (!cancelled && isInitial) setLoading(false);
        });
    };
    load(true);
    // The rail's create menu adds tasks outside this widget — refetch on its
    // signal so they appear without a reload.
    const onTasksChanged = () => load(false);
    window.addEventListener(TASKS_CHANGED_EVENT, onTasksChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(TASKS_CHANGED_EVENT, onTasksChanged);
    };
  }, [dateStr]);

  const carried = due.filter((t) => t.dueAt.slice(0, 10) < day);
  const dueToday = due.filter((t) => t.dueAt.slice(0, 10) >= day);
  const repeatingToday = due.filter((t) => t.recurring !== null).length;

  const complete = (task: DueTaskResult) => {
    setDue((prev) => prev.filter((t) => t.id !== task.id));
    setDone((prev) => [
      ...prev,
      { id: task.id, title: task.title, original: task },
    ]);
    toggleTaskAction(task.id, true).catch((err) => {
      console.error("[tasks] toggle failed:", err);
      setDue((prev) =>
        [...prev, task].sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
      );
      setDone((prev) => prev.filter((t) => t.id !== task.id));
    });
  };

  const uncomplete = (task: DoneEntry) => {
    setDone((prev) => prev.filter((t) => t.id !== task.id));
    const restored = task.original;
    if (restored) {
      setDue((prev) =>
        [...prev, restored].sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
      );
    }
    toggleTaskAction(task.id, false)
      .then(() => {
        // Loaded-from-server done rows only carry id/title — refetch so the
        // restored task shows its real due date and chips.
        if (!restored) {
          listTasksDueAction(day, localDateString())
            .then(setDue)
            .catch((err) => console.error("[tasks] due refresh failed:", err));
        }
      })
      .catch((err) => {
        console.error("[tasks] toggle failed:", err);
        if (restored) setDue((prev) => prev.filter((t) => t.id !== task.id));
        setDone((prev) => [...prev, task]);
      });
  };

  const addTask = async () => {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    try {
      const { id } = await createStandaloneTaskAction(title, day);
      setDue((prev) => [
        ...prev,
        {
          id,
          title,
          dueAt: `${day}T00:00:00.000Z`,
          noteId: null,
          remindAt: null,
          boardTitle: null,
          boardColor: null,
          recurring: null,
        },
      ]);
    } catch (err) {
      console.error("[tasks] create failed:", err);
      setDraft(title);
    }
  };

  // Phone agenda peek: the soonest reminder-timed open task stands in for
  // "next scheduled" — the only time-shaped data this widget already loads.
  const timed = due
    .filter((t) => t.remindAt !== null)
    .sort((a, b) => (a.remindAt as string).localeCompare(b.remindAt as string));
  const agendaLine = timed.length
    ? `${formatTimeShort(timed[0].remindAt as string)} · ${timed[0].title}${
        timed.length > 1 ? ` · +${timed.length - 1} more` : ""
      }`
    : "Nothing scheduled — tap to plan the day";

  return (
    <>
      {/* Phone (design Turn 17a): an agenda peek card + a collapsed due-today
          card. The parent renders this widget with max-md:contents, so these
          sit as siblings in the home column; the desktop panel below hides. */}
      <Link
        href="/app/calendar"
        className="flex min-h-11 items-center gap-3 rounded-2xl border border-white/8 bg-white/3 px-4 py-3 md:hidden"
      >
        <Calendar className="h-[1.125rem] w-[1.125rem] flex-none text-steel" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[0.8125rem] text-ink-200">
            {agendaLine}
          </span>
          <span className="text-[0.6875rem] text-ink-600">
            tap for the full day
          </span>
        </span>
        <ChevronRight className="h-4 w-4 flex-none text-ink-600" />
      </Link>

      <div className="rounded-2xl border border-white/8 bg-white/3 px-2.5 pb-1.5 pt-3 md:hidden">
        <div className="flex items-center gap-2 px-1.5 pb-1.5">
          <SquareCheck className="h-4 w-4 flex-none text-sage" />
          <span className="text-[0.84375rem] font-semibold text-ink-100">
            Due today
          </span>
          {!loading && (
            <span className="text-[0.6875rem] text-ink-600">
              {due.length} open
            </span>
          )}
        </div>
        {loading ? (
          <div className="flex flex-col gap-1.5 px-1.5 pb-2">
            <div className="h-9 animate-pulse rounded-lg bg-white/6" />
            <div className="h-9 animate-pulse rounded-lg bg-white/5" />
          </div>
        ) : due.length === 0 ? (
          <p className="px-1.5 pb-2.5 text-xs text-ink-600">
            Nothing due — enjoy the space.
          </p>
        ) : (
          [...carried, ...dueToday].map((task) => {
            const overdue = task.dueAt.slice(0, 10) < day;
            return (
              <div
                key={task.id}
                className="flex min-h-11 items-center gap-3 px-1.5"
              >
                <button
                  type="button"
                  aria-label={`Mark “${task.title}” complete`}
                  onClick={() => complete(task)}
                  className="h-[1.375rem] w-[1.375rem] flex-none rounded-md border-[1.5px] border-ink-700 active:bg-sage/15"
                />
                <span className="min-w-0 flex-1 truncate text-[0.84375rem] text-ink-200">
                  {task.title}
                </span>
                {overdue && (
                  <span className="flex-none rounded bg-[#D9938A]/10 px-1.5 py-0.5 text-[0.625rem] font-medium text-[#D9938A]">
                    carried {carriedDays(task.dueAt, day)}d
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col max-md:hidden">
        <div className="flex flex-none items-center gap-2 border-b border-white/7 px-3.5 py-3">
          <CalendarClock className="h-3.5 w-3.5 text-sage" />
          <span className="text-[0.8125rem] font-semibold text-ink-100">Tasks</span>
          {loading ? (
            <div className="h-2.5 w-12 animate-pulse rounded bg-white/6" />
          ) : (
            <span className="text-[0.6875rem] text-ink-600">{due.length} open</span>
          )}
          {expandHref && (
            <Link
              href={expandHref}
              aria-label="Open tasks page"
              className="ml-auto flex h-5 w-5 items-center justify-center rounded-md hover:bg-white/6"
            >
              <Maximize2 className="h-[0.6875rem] w-[0.6875rem] text-ink-600" />
            </Link>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          {carried.length > 0 && (
            <>
              <div
                className={`${SECTION_LABEL} flex items-center gap-1.5 text-[#D9938A]`}
              >
                <CornerLeftUp className="h-3 w-3" />
                Carried over
              </div>
              <div className="flex flex-col gap-1 px-2">
                {carried.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-2.5 rounded-lg border border-[#D9938A]/20 bg-[#D9938A]/5 px-2.5 py-2"
                  >
                    <button
                      type="button"
                      aria-label={`Mark “${task.title}” complete`}
                      onClick={() => complete(task)}
                      className="h-[0.9375rem] w-[0.9375rem] flex-none rounded-[0.25rem] border-[1.5px] border-[#6B4F4B] hover:bg-[#D9938A]/20"
                    />
                    <span className="min-w-0 flex-1 truncate text-[0.78125rem] text-[#DDB4AD]">
                      {task.title}
                    </span>
                    <TaskChip task={task} />
                    <span className="flex-none text-[0.65625rem] font-medium text-[#D9938A]">
                      {formatDue(task.dueAt)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className={`${SECTION_LABEL} text-ink-600`}>Due today</div>
          <div className="flex flex-col gap-px px-2">
            {loading ? (
              <div className="flex flex-col gap-1.5 py-0.5">
                <div className="h-8 animate-pulse rounded-lg bg-white/6" />
                <div className="h-8 animate-pulse rounded-lg bg-white/6" />
                <div className="h-8 animate-pulse rounded-lg bg-white/5" />
              </div>
            ) : dueToday.length === 0 ? (
              <p className="px-2.5 py-1.5 text-xs text-ink-600">
                Nothing due — enjoy the space.
              </p>
            ) : (
              dueToday.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-white/4"
                >
                  <button
                    type="button"
                    aria-label={`Mark “${task.title}” complete`}
                    onClick={() => complete(task)}
                    className="h-[0.9375rem] w-[0.9375rem] flex-none rounded-[0.25rem] border-[1.5px] border-ink-700 hover:bg-sage/15"
                  />
                  <span className="min-w-0 flex-1 truncate text-[0.78125rem] leading-[1.35] text-ink-200">
                    {task.title}
                  </span>
                  <TaskChip task={task} />
                  {task.noteId && (
                    <Link
                      href={`/app/notes/${task.noteId}`}
                      aria-label="Open containing note"
                      className="flex-none rounded p-0.5 text-ink-600 hover:text-ink-300"
                    >
                      <FileText className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>
              ))
            )}
          </div>

          {done.length > 0 && (
            <>
              <div className={`${SECTION_LABEL} text-ink-600`}>Done</div>
              <div className="flex flex-col gap-px px-2">
                {done.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-2.5 rounded-lg px-2.5 py-2"
                  >
                    <button
                      type="button"
                      aria-label={`Mark “${task.title}” incomplete`}
                      onClick={() => uncomplete(task)}
                      className="flex h-[0.9375rem] w-[0.9375rem] flex-none items-center justify-center rounded-[0.25rem] bg-sage"
                    >
                      <Check className="h-2.5 w-2.5 text-sage-ink" />
                    </button>
                    <span className="min-w-0 flex-1 truncate text-[0.78125rem] text-ink-500 line-through">
                      {task.title}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <form
          className="m-2 flex flex-none items-center gap-2 rounded-lg border border-white/7 bg-input px-2.5 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            void addTask();
          }}
        >
          <Plus className="h-3 w-3 flex-none text-ink-600" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a task…"
            className="min-w-0 flex-1 bg-transparent text-[0.71875rem] text-ink-100 outline-none placeholder:text-ink-600"
          />
        </form>

        {expandHref && repeatingToday > 0 && (
          <div className="flex flex-none items-center gap-[0.4375rem] px-3.5 pb-2.5 pt-2">
            <Repeat className="h-[0.6875rem] w-[0.6875rem] text-ink-600" />
            <span className="text-[0.65625rem] text-ink-600">
              {repeatingToday} repeat today
            </span>
            <Link
              href={expandHref}
              className="ml-auto text-[0.65625rem] font-medium text-ink-400 hover:text-ink-300"
            >
              Manage →
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
