"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bell,
  CalendarClock,
  Check,
  CornerLeftUp,
  FileText,
  Maximize2,
  Plus,
  Repeat,
} from "lucide-react";

import {
  createStandaloneTaskAction,
  listTasksDoneAction,
  listTasksDueAction,
  toggleTaskAction,
  type DoneTaskResult,
  type DueTaskResult,
} from "@/app/app/actions";
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
  const [done, setDone] = useState<DoneTaskResult[]>([]);
  const [draft, setDraft] = useState("");
  const [day, setDay] = useState("");

  useEffect(() => {
    let cancelled = false;
    const viewed = dateStr ?? localDateString();
    setDay(viewed);
    // completedAt is an absolute instant, so send the local day's real bounds.
    const { start, end } = localDayBounds(viewed);
    Promise.all([
      listTasksDueAction(viewed),
      listTasksDoneAction(start.toISOString(), end.toISOString()),
    ])
      .then(([dueRows, doneRows]) => {
        if (cancelled) return;
        setDue(dueRows);
        setDone(doneRows);
      })
      .catch((err) => console.error("[tasks] widget load failed:", err));
    return () => {
      cancelled = true;
    };
  }, [dateStr]);

  const carried = due.filter((t) => t.dueAt.slice(0, 10) < day);
  const dueToday = due.filter((t) => t.dueAt.slice(0, 10) >= day);
  const repeatingToday = due.filter((t) => t.recurring !== null).length;

  const complete = (task: DueTaskResult) => {
    setDue((prev) => prev.filter((t) => t.id !== task.id));
    setDone((prev) => [...prev, { id: task.id, title: task.title }]);
    toggleTaskAction(task.id, true).catch((err) => {
      console.error("[tasks] toggle failed:", err);
      setDue((prev) =>
        [...prev, task].sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
      );
      setDone((prev) => prev.filter((t) => t.id !== task.id));
    });
  };

  const uncomplete = (task: DoneTaskResult) => {
    setDone((prev) => prev.filter((t) => t.id !== task.id));
    const restored: DueTaskResult = {
      id: task.id,
      title: task.title,
      dueAt: `${day}T00:00:00.000Z`,
      noteId: null,
      remindAt: null,
      boardTitle: null,
      boardColor: null,
      recurring: null,
    };
    setDue((prev) => [...prev, restored]);
    toggleTaskAction(task.id, false).catch((err) => {
      console.error("[tasks] toggle failed:", err);
      setDue((prev) => prev.filter((t) => t.id !== task.id));
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-white/7 px-3.5 py-3">
        <CalendarClock className="h-3.5 w-3.5 text-sage" />
        <span className="text-[0.8125rem] font-semibold text-ink-100">Tasks</span>
        <span className="text-[0.6875rem] text-ink-600">{due.length} open</span>
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
          {dueToday.length === 0 ? (
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
  );
}
