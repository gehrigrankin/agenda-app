"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, ListTodo, Trash2 } from "lucide-react";

import type { TagWithCountResult } from "@/app/app/actions";
import { hhmmToMin, minToHHMM } from "@/lib/calendar-grid";
import { formatLongDate } from "@/lib/dates";
import { isSubjectColor } from "@/lib/subjects";
import type { UserEvent } from "@/server/events";

import {
  ICS_COLOR,
  OWN_EVENT_COLOR,
  icsWindow,
  timeRangeLabel,
  type CalendarSelection,
} from "./calendar-items";

/**
 * Body of the right-hand EVENT sidebar (design §5c "Event details open on the
 * right"). Own quick-add events are editable in place — title, day, time or
 * all-day, subject, notes, delete — each field committing on blur/change
 * through the page's `onPatch` (updateEventAction). ICS events are read-only:
 * they live in the subscribed feed. A selected task shows its day/time with
 * a done toggle and an unschedule action.
 */

const FIELD =
  "w-full rounded-md border border-white/8 bg-white/[0.03] px-2 py-1 text-[0.8125rem] text-ink-100 focus:border-sage/50 focus:outline-none touch:min-h-11";
const LABEL =
  "text-[0.6875rem] font-semibold tracking-[0.1em] text-ink-500 uppercase";

export type EventPatchInput = {
  title?: string;
  localDate?: string;
  times?: { startMin: number | null; endMin: number | null };
  tagId?: string | null;
  notes?: string | null;
};

export function EventDetails({
  selection,
  tags,
  icsConfigured,
  onPatch,
  onDelete,
  onToggleTask,
  onScheduleTask,
}: {
  selection: CalendarSelection | null;
  tags: TagWithCountResult[];
  icsConfigured: boolean;
  onPatch: (id: string, patch: EventPatchInput) => void;
  onDelete: (id: string) => void;
  onToggleTask: (id: string, completed: boolean) => void;
  onScheduleTask: (
    id: string,
    date: string | null,
    time: string | null,
  ) => void;
}) {
  if (!selection) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <CalendarClock className="h-5 w-5 text-ink-600" />
        <p className="text-[0.8125rem] text-ink-500">
          Select an event to see its details.
        </p>
      </div>
    );
  }
  if (selection.kind === "event") {
    return (
      <OwnEventDetails
        key={selection.id}
        event={selection.snapshot}
        tags={tags}
        onPatch={(p) => onPatch(selection.id, p)}
        onDelete={() => onDelete(selection.id)}
      />
    );
  }
  if (selection.kind === "ics") {
    const e = selection.event;
    const when = e.allDay
      ? e.spanEnd > e.spanStart
        ? `${formatLongDate(e.spanStart)} – ${formatLongDate(e.spanEnd)}`
        : `${formatLongDate(e.date)} · all day`
      : `${formatLongDate(e.date)} · ${(() => {
          const w = icsWindow(e);
          return timeRangeLabel(w.start, w.end);
        })()}`;
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        <h3 className="text-[1.0625rem] leading-snug font-semibold text-ink-100">
          {e.title}
        </h3>
        <Row label="When">{when}</Row>
        <Row label="Calendar">
          <span className="flex items-center gap-2">
            <Swatch color={ICS_COLOR} />
            Subscribed{icsConfigured ? "" : " (feed removed)"}
          </span>
        </Row>
        <p className="text-[0.75rem] text-ink-500">
          From your subscribed calendar — read-only here. Edit it in the
          calendar it comes from.
        </p>
      </div>
    );
  }
  const t = selection.snapshot;
  return (
    <TaskDetails
      key={t.id}
      task={t}
      onToggle={(c) => onToggleTask(t.id, c)}
      onSchedule={(date, time) => onScheduleTask(t.id, date, time)}
    />
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className={LABEL}>{label}</span>
      <div className="text-[0.8125rem] text-ink-200">{children}</div>
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="h-2.5 w-2.5 flex-none rounded-[0.1875rem]"
      style={{ backgroundColor: color }}
    />
  );
}

function OwnEventDetails({
  event,
  tags,
  onPatch,
  onDelete,
}: {
  event: UserEvent;
  tags: TagWithCountResult[];
  onPatch: (p: EventPatchInput) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(event.title);
  const [notes, setNotes] = useState(event.notes ?? "");
  // Re-sync when the stored row changes underneath (another edit landed).
  useEffect(() => setTitle(event.title), [event.title]);
  useEffect(() => setNotes(event.notes ?? ""), [event.notes]);

  const allDay = event.startMin === null;
  const commitTitle = () => {
    const next = title.trim();
    if (!next) setTitle(event.title);
    else if (next !== event.title) onPatch({ title: next });
  };
  const setTimes = (startMin: number | null, endMin: number | null) =>
    onPatch({ times: { startMin, endMin } });

  const subjects = tags.filter(
    (t) => isSubjectColor(t.color) || t.id === event.tagId,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
      <input
        aria-label="Event title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setTitle(event.title);
            e.currentTarget.blur();
          }
        }}
        className="-mx-1 rounded-md bg-transparent px-1 py-0.5 text-[1.0625rem] font-semibold text-ink-100 hover:bg-white/4 focus:bg-white/4 focus:outline-none"
      />

      <div className="flex flex-col gap-1">
        <label htmlFor="cal-ev-date" className={LABEL}>
          {event.endLocalDate ? "Starts" : "Day"}
        </label>
        <input
          id="cal-ev-date"
          type="date"
          value={event.localDate}
          onChange={(e) => {
            if (e.target.value) onPatch({ localDate: e.target.value });
          }}
          className={FIELD}
        />
        {event.endLocalDate && (
          <span className="text-[0.75rem] text-ink-500">
            Through {formatLongDate(event.endLocalDate)}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={LABEL}>Time</span>
        <label className="flex items-center gap-2 text-[0.8125rem] text-ink-300 touch:min-h-11">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) =>
              e.target.checked ? setTimes(null, null) : setTimes(540, 600)
            }
            className="h-3.5 w-3.5 accent-[var(--sage)]"
          />
          All day
        </label>
        {!allDay && (
          <div className="flex items-center gap-1.5">
            <input
              aria-label="Start time"
              type="time"
              step={300}
              defaultValue={minToHHMM(event.startMin!)}
              key={`s-${event.startMin}`}
              onBlur={(e) => {
                const start = hhmmToMin(e.target.value);
                if (start === null || start === event.startMin) return;
                // Keep the duration when the start moves.
                const dur =
                  event.endMin !== null ? event.endMin - event.startMin! : 60;
                setTimes(start, Math.min(1440, start + dur));
              }}
              className={`${FIELD} font-mono`}
            />
            <span className="text-ink-500">–</span>
            <input
              aria-label="End time"
              type="time"
              step={300}
              defaultValue={
                event.endMin !== null ? minToHHMM(event.endMin) : ""
              }
              key={`e-${event.endMin}`}
              onBlur={(e) => {
                const end = hhmmToMin(e.target.value);
                if (end === event.endMin) return;
                if (end !== null && end <= event.startMin!) {
                  e.target.value =
                    event.endMin !== null ? minToHHMM(event.endMin) : "";
                  return;
                }
                setTimes(event.startMin, end);
              }}
              className={`${FIELD} font-mono`}
            />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={LABEL}>Calendar</span>
        <div
          className="flex flex-wrap gap-1"
          role="radiogroup"
          aria-label="Subject"
        >
          <SubjectChip
            label="Events"
            color={OWN_EVENT_COLOR}
            active={event.tagId === null}
            onClick={() => event.tagId !== null && onPatch({ tagId: null })}
          />
          {subjects.map((t) => (
            <SubjectChip
              key={t.id}
              label={t.name}
              color={t.color ?? OWN_EVENT_COLOR}
              active={event.tagId === t.id}
              onClick={() => event.tagId !== t.id && onPatch({ tagId: t.id })}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="cal-ev-notes" className={LABEL}>
          Notes
        </label>
        <textarea
          id="cal-ev-notes"
          value={notes}
          rows={4}
          placeholder="Add notes…"
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== (event.notes ?? ""))
              onPatch({ notes: notes || null });
          }}
          className={`${FIELD} resize-y leading-relaxed`}
        />
      </div>

      <div className="mt-auto pt-2">
        <button
          type="button"
          onClick={onDelete}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[0.8125rem] text-ink-400 hover:bg-white/6 hover:text-[color:var(--area-coral)] focus-visible:outline-2 focus-visible:outline-sage/70 touch:min-h-11"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete event
        </button>
      </div>
    </div>
  );
}

function SubjectChip({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[0.75rem] focus-visible:outline-2 focus-visible:outline-sage/70 touch:min-h-11 ${
        active
          ? "border-white/16 bg-white/8 text-ink-100"
          : "border-white/6 text-ink-400 hover:bg-white/4 hover:text-ink-200"
      }`}
    >
      <Swatch color={color} />
      {label}
    </button>
  );
}

function TaskDetails({
  task,
  onToggle,
  onSchedule,
}: {
  task: {
    id: string;
    title: string;
    due: string;
    completed: boolean;
    remindAt: string | null;
  };
  onToggle: (completed: boolean) => void;
  onSchedule: (date: string | null, time: string | null) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
      <label className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={task.completed}
          onChange={(e) => onToggle(e.target.checked)}
          className="mt-1 h-4 w-4 flex-none accent-[var(--sage)]"
          aria-label="Done"
        />
        <span
          className={`text-[1.0625rem] leading-snug font-semibold ${
            task.completed ? "text-ink-500 line-through" : "text-ink-100"
          }`}
        >
          {task.title}
        </span>
      </label>
      <div className="flex flex-col gap-1">
        <label htmlFor="cal-task-due" className={LABEL}>
          Due
        </label>
        <input
          id="cal-task-due"
          type="date"
          value={task.due}
          onChange={(e) => {
            if (e.target.value) onSchedule(e.target.value, task.remindAt);
          }}
          className={FIELD}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="cal-task-time" className={LABEL}>
          Time
        </label>
        <input
          id="cal-task-time"
          type="time"
          step={300}
          key={task.remindAt ?? "none"}
          defaultValue={task.remindAt ?? ""}
          onBlur={(e) => {
            const next = e.target.value || null;
            if (next !== task.remindAt) onSchedule(task.due, next);
          }}
          className={`${FIELD} font-mono`}
        />
        <span className="text-[0.75rem] text-ink-500">
          A time also sets the task&rsquo;s reminder.
        </span>
      </div>
      <div className="mt-auto flex flex-col items-start gap-1 pt-2">
        <button
          type="button"
          onClick={() => onSchedule(null, null)}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[0.8125rem] text-ink-400 hover:bg-white/6 hover:text-ink-200 focus-visible:outline-2 focus-visible:outline-sage/70 touch:min-h-11"
        >
          <CalendarClock className="h-3.5 w-3.5" />
          Unschedule
        </button>
        <Link
          href="/app/tasks"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[0.8125rem] text-ink-400 hover:bg-white/6 hover:text-ink-200 focus-visible:outline-2 focus-visible:outline-sage/70 touch:min-h-11"
        >
          <ListTodo className="h-3.5 w-3.5" />
          Open Tasks
        </Link>
      </div>
    </div>
  );
}

/** The sidebar's header label for a selection. */
export function eventSidebarLabel(selection: CalendarSelection | null): string {
  return selection?.kind === "task" ? "Task" : "Event";
}
