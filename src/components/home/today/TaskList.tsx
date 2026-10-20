"use client";

import {
  duePill,
  foldTasks,
  formatClock,
  panelDateText,
  type DayRel,
} from "@/lib/agenda-today";
import { subjectColor } from "@/lib/subjects";

import { DuePillView, FoldChevron, NotesMark, TaskCheckbox } from "./atoms";
import type { DayTask, SomedayTask } from "./useTodayAgenda";

/**
 * The day's tasks as a plain checklist: tick box, title (tap to open its
 * panel), subject, its block's time when it has one (those rows come first),
 * and the due pill (Today / Due / LATE / → TODAY). A heavy
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
            {/* Its block's time; a LATE task's block stayed on its own day. */}
            {t.startMin !== null && !t.late && (
              <span
                className={`flex-none font-mono font-medium leading-none ${
                  wide ? "text-[0.65625rem]" : "text-[0.625rem]"
                } ${t.done ? "text-ink-700" : "text-ink-400"}`}
              >
                {formatClock(t.startMin)}
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

/**
 * Today's Someday group, under the day's tasks: parked tasks, folded by
 * default behind "Someday · N" so they stay out of the way but in reach.
 * Rows read like the checklist above, with the due day (if any) in place of
 * a pill — a parked task is never LATE.
 */
export function SomedayGroup({
  tasks,
  today,
  wide,
  open,
  onToggleOpen,
  onToggle,
  onOpen,
}: {
  tasks: SomedayTask[];
  today: string;
  wide: boolean;
  open: boolean;
  onToggleOpen: () => void;
  onToggle: (id: string) => void;
  onOpen: (task: SomedayTask) => void;
}) {
  if (tasks.length === 0) return null;
  const rowHeight = wide ? "min-h-[2.625rem]" : "min-h-[2.375rem]";
  const openCount = tasks.filter((t) => !t.done).length;

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={open}
        className={`flex items-center gap-2.5 border-b border-white/6 text-left ${
          wide ? "min-h-[2.625rem]" : "min-h-10"
        }`}
      >
        <span className={`flex flex-none justify-center ${wide ? "w-5" : "w-[3.125rem]"}`}>
          <FoldChevron open={open} />
        </span>
        <span className="text-[0.84375rem] font-medium leading-none text-ink-400">
          Someday · {openCount}
        </span>
      </button>
      {open &&
        tasks.map((t) => {
          const subject = t.tags[0] ?? null;
          const due = t.dueAt ? panelDateText(t.dueAt.slice(0, 10), today) : null;
          return (
            <div
              key={t.id}
              className={`flex items-center gap-2 border-b border-white/6 ${rowHeight}`}
            >
              <TaskCheckbox
                checked={t.done}
                onToggle={() => onToggle(t.id)}
                label={t.done ? `Mark “${t.title}” not done` : `Mark “${t.title}” done`}
              />
              <button
                type="button"
                onClick={() => onOpen(t)}
                className={`flex min-w-0 flex-1 items-center self-stretch text-left leading-[1.3] ${
                  wide ? "text-[0.90625rem]" : "text-[0.875rem]"
                } ${t.done ? "text-ink-600 line-through" : "text-ink-300"}`}
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
              {due && (
                <span
                  className={`flex-none font-mono leading-none text-ink-600 ${
                    wide ? "text-[0.65625rem]" : "text-[0.625rem]"
                  }`}
                >
                  {due}
                </span>
              )}
            </div>
          );
        })}
    </div>
  );
}
