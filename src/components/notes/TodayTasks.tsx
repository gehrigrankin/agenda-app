"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, FileText } from "lucide-react";

import {
  listTasksDueAction,
  toggleTaskAction,
  type DueTaskResult,
} from "@/app/app/actions";

/** The user's local calendar date as YYYY-MM-DD (same pattern as DailyJot). */
function localDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "Jul 5" from the stored midnight-UTC ISO due date. */
function formatDue(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * "Due today" strip on the Today page: incomplete tasks due today or overdue,
 * fetched with the CLIENT's local date (the server can't know the timezone).
 * Renders nothing when there's nothing due, so the page stays clean.
 */
export function TodayTasks() {
  const [tasks, setTasks] = useState<DueTaskResult[] | null>(null);
  const [todayStr, setTodayStr] = useState("");

  useEffect(() => {
    let cancelled = false;
    const dateStr = localDateString();
    setTodayStr(dateStr);
    listTasksDueAction(dateStr)
      .then((rows) => {
        if (!cancelled) setTasks(rows);
      })
      .catch((err) => {
        console.error("[tasks] failed to load due tasks:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!tasks || tasks.length === 0) return null;

  const complete = (task: DueTaskResult) => {
    // Optimistic: drop it from the list now, restore (sorted) on failure.
    setTasks((prev) => (prev ? prev.filter((t) => t.id !== task.id) : prev));
    toggleTaskAction(task.id, true).catch((err) => {
      console.error("[tasks] toggle failed:", err);
      setTasks((prev) =>
        prev
          ? [...prev, task].sort((a, b) => a.dueAt.localeCompare(b.dueAt))
          : prev,
      );
    });
  };

  return (
    <section
      aria-label="Tasks due today"
      className="shrink-0 border-b border-neutral-200 px-3 py-3 dark:border-neutral-800 md:px-4"
    >
      <h2 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-neutral-400">
        <CalendarClock className="h-3.5 w-3.5" />
        Due today
      </h2>
      <ul className="space-y-1.5">
        {tasks.map((task) => {
          const overdue = task.dueAt.slice(0, 10) < todayStr;
          return (
            <li
              key={task.id}
              className="flex items-center gap-2.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
            >
              <input
                type="checkbox"
                checked={false}
                onChange={() => complete(task)}
                aria-label={`Mark “${task.title}” complete`}
                className="h-4 w-4 shrink-0 cursor-pointer accent-blue-600"
              />
              <span className="min-w-0 flex-1 truncate text-sm text-neutral-800 dark:text-neutral-200">
                {task.title}
              </span>
              <span
                className={`shrink-0 text-xs ${
                  overdue
                    ? "font-medium text-red-600 dark:text-red-400"
                    : "text-neutral-400"
                }`}
              >
                {overdue ? `Overdue · ${formatDue(task.dueAt)}` : formatDue(task.dueAt)}
              </span>
              {task.noteId && (
                <Link
                  href={`/app/notes/${task.noteId}`}
                  aria-label="Open containing note"
                  title="Open note"
                  className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                >
                  <FileText className="h-3.5 w-3.5" />
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
