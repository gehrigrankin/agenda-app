"use client";

import { duePill, foldTasks, type DayRel } from "@/lib/agenda-today";
import { subjectColor } from "@/lib/subjects";

import { DuePillView, FoldChevron, NotesMark, TaskCheckbox } from "./atoms";
import type { DayTask } from "./useTodayAgenda";

/**
 * The day's tasks as a plain checklist: tick box, title (tap to open its
 * panel), subject, and the due pill (Today / Due / LATE / → TODAY). A heavy
 * day folds after `limit` behind "N more due".
 */
export function TaskList({
  tasks,
  date,
  today,
  rel,
  wide,
  limit,
  expanded,
  onToggleExpanded,
  onToggle,
  onOpen,
}: {
  tasks: DayTask[];
  date: string;
  today: string;
  rel: DayRel;
  wide: boolean;
  limit: number;
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggle: (id: string) => void;
  onOpen: (task: DayTask) => void;
}) {
  const rowHeight = wide ? "min-h-[2.625rem]" : "min-h-[2.375rem]";
  if (tasks.length === 0) {
    return (
      <div
        className={`flex items-center border-b border-white/6 text-[0.875rem] leading-none text-ink-400 ${
          wide ? "h-[2.625rem]" : "h-[2.375rem]"
        }`}
      >
        {rel === "past" ? "Nothing was due." : "Nothing due. Free period."}
      </div>
    );
  }

  const { visible, hidden, foldable } = foldTasks(tasks, limit, expanded);

  return (
    <div className="flex flex-col">
      {visible.map((t) => {
        const subject = t.tags[0] ?? null;
        const pill = duePill(t.dueAt.slice(0, 10), date, today, t.carried);
        const temp = t.id.startsWith("temp-");
        return (
          <div
            key={t.id}
            className={`flex items-center gap-2 border-b border-white/6 ${rowHeight}`}
          >
            <TaskCheckbox
              checked={t.done}
              onToggle={() => onToggle(t.id)}
              label={t.done ? `Mark “${t.title}” not done` : `Mark “${t.title}” done`}
              disabled={temp}
            />
            <button
              type="button"
              disabled={temp}
              onClick={() => onOpen(t)}
              className={`flex min-w-0 flex-1 items-center self-stretch text-left leading-[1.3] ${
                wide ? "text-[0.90625rem]" : "text-[0.875rem]"
              } ${t.done ? "text-ink-600 line-through" : "text-ink-200"}`}
            >
              <span className="min-w-0 break-words">{t.title}</span>
              {t.description?.trim() && <NotesMark className="ml-2" />}
            </button>
            {subject && (
              <span
                className={`max-w-[5.5rem] flex-none truncate font-mono font-medium leading-none ${
                  wide ? "text-[0.65625rem]" : "text-[0.625rem]"
                }`}
                style={{ color: t.done ? "var(--ink-700)" : subjectColor(subject.color) }}
              >
                {subject.name}
              </span>
            )}
            <DuePillView pill={pill} done={t.done} wide={wide} />
          </div>
        );
      })}
      {foldable && (
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          className={`flex items-center gap-2.5 border-b border-white/6 text-left ${
            wide ? "min-h-[2.625rem]" : "min-h-10"
          }`}
        >
          <span className={`flex flex-none justify-center ${wide ? "w-5" : "w-[3.125rem]"}`}>
            <FoldChevron open={expanded} className="border-sage" />
          </span>
          <span className="text-[0.84375rem] font-medium leading-none text-sage">
            {expanded ? "Show fewer" : `${hidden} more due`}
          </span>
        </button>
      )}
    </div>
  );
}
