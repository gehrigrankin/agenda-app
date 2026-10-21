"use client";

import { useState } from "react";

import type { TagResult } from "@/app/app/actions";
import { DOW_SHORT, weekdayIndex } from "@/lib/agenda-today";
import { addDays } from "@/lib/dates";
import { subjectColor } from "@/lib/subjects";

import { CheckGlyph } from "./atoms";

/**
 * The inline "write it into the planner" row for a new task. (A new event
 * opens the item panel as a form instead — NewEventPanel.)
 * The subject (and a task's due day) is a tap-to-cycle label rather than a
 * picker, like flipping to the next column in a paper agenda; the panel has
 * the full picker once the item exists.
 */

/** Cycle order: every subject, then "no subject". */
function useSubjectCycle(subjects: TagResult[]) {
  const [index, setIndex] = useState(0);
  const options: (TagResult | null)[] = [...subjects, null];
  const current = options[index % options.length];
  return {
    current,
    next: () => setIndex((i) => (i + 1) % options.length),
  };
}

function SubjectCycler({
  subject,
  onCycle,
  align,
}: {
  subject: TagResult | null;
  onCycle: () => void;
  align: "center" | "start";
}) {
  return (
    <button
      type="button"
      onClick={onCycle}
      title="Tap to change subject"
      className={`flex h-11 min-w-0 items-center overflow-hidden font-mono text-[0.6875rem] font-medium leading-none underline decoration-dotted underline-offset-4 ${
        align === "center" ? "justify-center px-1" : "justify-start"
      }`}
      style={{ color: subject ? subjectColor(subject.color) : undefined }}
    >
      <span className={`truncate ${subject ? "" : "text-ink-500"}`}>
        {subject ? subject.name : "none"}
      </span>
    </button>
  );
}

export function AddTaskForm({
  date,
  today,
  subjects,
  onAdd,
  onCancel,
}: {
  /** The page's day — the earliest due day offered. */
  date: string;
  today: string;
  subjects: TagResult[];
  onAdd: (title: string, due: string, tagId: string | null) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const subject = useSubjectCycle(subjects);
  // Due cycles from the page's day through the end of its week.
  const dueOptions = Array.from(
    { length: 7 - weekdayIndex(date) },
    (_, i) => addDays(date, i),
  );
  const [dueIndex, setDueIndex] = useState(0);
  const due = dueOptions[dueIndex % dueOptions.length];
  const dueLabel =
    due === today ? "TODAY" : DOW_SHORT[weekdayIndex(due)].toUpperCase();

  const submit = () => {
    const t = title.trim();
    if (!t) {
      onCancel();
      return;
    }
    onAdd(t, due, subject.current?.id ?? null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="flex flex-col">
      <div className="grid min-h-[2.875rem] grid-cols-[3.125rem_minmax(0,1fr)_3.375rem_2rem] items-center gap-2 border-b-[1.5px] border-sage/60">
        <SubjectCycler subject={subject.current} onCycle={subject.next} align="start" />
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="New task"
          aria-label="Task title"
          className="h-11 min-w-0 bg-transparent text-[0.875rem] leading-none text-ink-100 outline-none placeholder:text-ink-600"
        />
        <button
          type="button"
          onClick={() => setDueIndex((i) => (i + 1) % dueOptions.length)}
          title="Tap to change the due day"
          className="rounded border border-dashed border-white/30 py-1.5 text-center font-mono text-[0.625rem] font-semibold leading-none text-ink-100"
        >
          {dueLabel}
        </button>
        <button
          type="button"
          onClick={submit}
          aria-label="Add task"
          className="flex h-[1.875rem] w-[1.875rem] items-center justify-center rounded-full bg-sage"
        >
          <CheckGlyph size="lg" />
        </button>
      </div>
      <div className="flex justify-between pt-1.5 text-[0.6875rem] leading-[1.4] text-ink-600">
        <span>Tap subject or due to change · Enter to add</span>
        <button type="button" onClick={onCancel} className="text-ink-400">
          Cancel
        </button>
      </div>
    </div>
  );
}
