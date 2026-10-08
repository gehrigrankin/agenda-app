"use client";

import { useEffect, useRef, useState } from "react";

import type { TagResult } from "@/app/app/actions";
import {
  DOW_LETTER,
  dayOfMonth,
  formatClockInput,
  panelDateText,
  parseTimeInput,
} from "@/lib/agenda-today";
import { addDays, startOfWeek, weekDays } from "@/lib/dates";
import { nextSubjectColor } from "@/lib/subjects";

import { CheckGlyph, SubjectDot } from "./atoms";
import type { TodayAgenda } from "./useTodayAgenda";

/**
 * One event's or task's own page: rename it, set its time (events), pick its
 * subject or make a new one, move it to another day, keep notes on it, tick
 * it off or delete it. A bottom sheet on phone; a panel sliding in from the
 * right on tablet/desktop.
 *
 * Title, time and notes are drafts while you type and save when the field
 * loses focus or the panel closes, so a sentence of notes is one write, not
 * forty.
 */

export type PanelTarget = { kind: "event" | "task"; id: string };

const LABEL = "text-[0.8125rem] font-medium leading-none text-ink-400";

export function ItemPanel({
  target,
  agenda,
  today,
  variant,
  onClose,
}: {
  target: PanelTarget;
  agenda: TodayAgenda;
  today: string;
  variant: "sheet" | "side";
  onClose: () => void;
}) {
  const task = target.kind === "task" ? agenda.findTask(target.id) : null;
  const event = target.kind === "event" ? agenda.findEvent(target.id) : null;
  const item = task ?? event;

  // Deleted elsewhere (or by us): nothing left to show.
  useEffect(() => {
    if (!item) onClose();
  }, [item, onClose]);

  const serverTitle = item?.title ?? "";
  const serverNotes = (task ? task.description : event?.notes) ?? "";
  const serverTime = event ? formatClockInput(event.startMin) : "";

  const [title, setTitle] = useState(serverTitle);
  const [notes, setNotes] = useState(serverNotes);
  const [time, setTime] = useState(serverTime);
  const [naming, setNaming] = useState<string | null>(null);

  // Latest drafts for the close-time flush (the handlers below close over
  // stale values otherwise).
  const drafts = useRef({ title, notes, time });
  drafts.current = { title, notes, time };

  const commitTitle = () => {
    const next = drafts.current.title.trim();
    if (!item || !next || next === item.title) return;
    if (task) agenda.renameTask(task.id, next);
    else if (event) agenda.updateEvent(event.id, { title: next });
  };
  const commitNotes = () => {
    const next = drafts.current.notes;
    if (!item || next === serverNotes) return;
    if (task) agenda.setTaskNotes(task.id, next);
    else if (event) agenda.updateEvent(event.id, { notes: next });
  };
  const commitTime = () => {
    if (!event) return;
    const parsed = parseTimeInput(drafts.current.time);
    if (parsed === "invalid") {
      setTime(formatClockInput(event.startMin));
      return;
    }
    if (parsed === event.startMin) return;
    // Keep the event's length when it moves; a new all-day drops the end.
    const length =
      event.startMin !== null && event.endMin !== null
        ? event.endMin - event.startMin
        : null;
    agenda.updateEvent(event.id, {
      times: {
        startMin: parsed,
        endMin: parsed !== null && length !== null ? parsed + length : null,
      },
    });
    setTime(formatClockInput(parsed));
  };

  const close = () => {
    commitTitle();
    commitNotes();
    commitTime();
    onClose();
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!item) return null;

  const date = task ? task.dueAt.slice(0, 10) : (event as NonNullable<typeof event>).localDate;
  const subjectId = task ? (task.tags[0]?.id ?? null) : (event?.tagId ?? null);
  const subject = subjectId ? agenda.subjectById.get(subjectId) ?? null : null;
  const done = task ? task.completedAt !== null : false;
  const days = weekDays(startOfWeek(date));
  const tomorrow = addDays(today, 1);

  const moveTo = (d: string) => {
    if (d === date) return;
    if (task) agenda.moveTask(task.id, d);
    else if (event) agenda.updateEvent(event.id, { localDate: d });
  };

  const pickSubject = (s: TagResult) => {
    const next = s.id === subjectId ? null : s.id;
    if (task) agenda.setTaskSubject(task.id, next);
    else if (event) agenda.updateEvent(event.id, { tagId: next });
  };

  const commitNewSubject = async () => {
    const name = naming?.trim();
    setNaming(null);
    if (!name) return;
    const existing = agenda.subjects.find(
      (s) => s.name.toLowerCase() === name.toLowerCase(),
    );
    const tag = existing ?? (await agenda.createSubject(name));
    if (!tag) return;
    if (task) agenda.setTaskSubject(task.id, tag.id);
    else if (event) agenda.updateEvent(event.id, { tagId: tag.id });
  };

  // "Beta · due Tue, Jul 8 · late" / "Beta · Today · 11:30"
  const dateText = panelDateText(date, today);
  const meta = task
    ? [
        subject?.name,
        `due ${dateText === "Today" || dateText === "Tomorrow" ? dateText.toLowerCase() : dateText}`,
        done ? "done" : date < today ? "late" : null,
      ]
    : [
        subject?.name,
        dateText,
        event?.startMin === null ? "All day" : formatClockInput(event?.startMin ?? null),
      ];
  const metaLine = meta.filter(Boolean).join(" · ");

  const pad = variant === "side" ? "px-[1.375rem]" : "px-5";

  const panel = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={task ? "Task" : "Event"}
      onClick={(e) => e.stopPropagation()}
      className={
        variant === "sheet"
          ? "agenda-sheet-in flex max-h-[92%] flex-col overflow-y-auto rounded-t-[1.75rem] bg-panel pb-[calc(1.875rem+env(safe-area-inset-bottom))] pt-2.5 shadow-[0_-24px_60px_rgba(0,0,0,0.55)]"
          : "agenda-panel-in relative flex h-full w-[25rem] max-w-full flex-col overflow-y-auto border-l border-white/8 bg-panel pb-3 pt-[1.375rem] shadow-[-24px_0_60px_rgba(0,0,0,0.5)]"
      }
    >
      {variant === "sheet" && (
        <span aria-hidden className="mb-3.5 h-[0.3125rem] w-9 flex-none self-center rounded-sm bg-white/18" />
      )}

      {/* Header: done circle (tasks), title, meta line, Done */}
      <div className={`flex flex-none items-start gap-3 ${pad}`}>
        {task && (
          <button
            type="button"
            role="checkbox"
            aria-checked={done}
            aria-label={done ? "Mark not done" : "Mark done"}
            onClick={() => agenda.toggleTask(task.id)}
            className="-mb-0 -ml-2.5 -mr-2 -mt-1.5 flex h-11 w-11 flex-none items-center justify-center"
          >
            <span
              className={`flex h-[1.625rem] w-[1.625rem] items-center justify-center rounded-full ${
                done ? "bg-sage" : "border-[1.75px] border-solid border-ink-600"
              }`}
            >
              {done && <CheckGlyph size="lg" />}
            </span>
          </button>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <textarea
            value={title}
            rows={2}
            onChange={(e) => setTitle(e.target.value.replace(/\n/g, ""))}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
            placeholder="Untitled"
            aria-label="Title"
            className={`-mt-0.5 h-[3.125rem] resize-none overflow-hidden bg-transparent p-0 text-[1.25rem] font-semibold leading-[1.5625rem] tracking-[-0.0125rem] outline-none placeholder:text-ink-600 ${
              done ? "text-ink-400 line-through" : "text-ink-100"
            }`}
          />
          <span className="text-[0.8125rem] leading-[1.3] text-ink-400">{metaLine}</span>
        </div>
        <button
          type="button"
          onClick={close}
          className="-mr-2 -mt-2 h-11 flex-none px-2 text-[0.9375rem] font-semibold leading-none text-sage"
        >
          Done
        </button>
      </div>

      <div className="mt-[1.125rem] h-px flex-none bg-white/7" />

      {/* Time (events) */}
      {event && (
        <div className={`flex flex-none items-center gap-3 pt-3.5 ${pad}`}>
          <span className={LABEL}>Time</span>
          <span className="flex-1" />
          <span className="text-[0.75rem] leading-none text-ink-600">2:30 · 9a · 4pm</span>
          <input
            value={time}
            onChange={(e) => setTime(e.target.value)}
            onBlur={commitTime}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            placeholder="All day"
            aria-label="Time"
            className="h-10 w-24 rounded-[0.625rem] bg-white/5 px-3 text-right font-mono text-[0.9375rem] font-medium leading-none text-ink-100 outline-none placeholder:text-ink-600"
          />
        </div>
      )}

      {/* Subject */}
      <div className={`flex flex-none flex-col gap-2.5 pt-4 ${pad}`}>
        <span className={LABEL}>Subject</span>
        <div className="-ml-2.5 flex flex-wrap gap-1">
          {agenda.subjects.map((s) => {
            const selected = s.id === subjectId;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={selected}
                onClick={() => pickSubject(s)}
                className={`flex h-9 items-center gap-[0.4375rem] rounded-[0.625rem] px-2.5 text-[0.875rem] font-medium leading-none ${
                  selected ? "bg-white/8 text-ink-100" : "text-ink-400 hover:bg-white/4"
                }`}
              >
                <SubjectDot color={s.color} size={8} />
                {s.name}
              </button>
            );
          })}
          {naming === null ? (
            <button
              type="button"
              onClick={() => setNaming("")}
              className="flex h-9 items-center rounded-[0.625rem] px-2.5 text-[0.875rem] font-medium leading-none text-sage hover:bg-white/4"
            >
              + New subject
            </button>
          ) : (
            <span className="flex h-9 items-center gap-[0.4375rem] rounded-[0.625rem] bg-white/6 pl-2.5 pr-1">
              <SubjectDot
                color={nextSubjectColor(agenda.subjects.map((s) => s.color))}
                size={8}
              />
              <input
                autoFocus
                value={naming}
                onChange={(e) => setNaming(e.target.value)}
                onBlur={() => void commitNewSubject()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void commitNewSubject();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setNaming(null);
                  }
                }}
                placeholder="Name it"
                aria-label="New subject name"
                maxLength={32}
                className="h-[2.125rem] w-24 bg-transparent text-[0.875rem] font-medium leading-none text-ink-100 outline-none placeholder:text-ink-600"
              />
            </span>
          )}
        </div>
      </div>

      {/* Day / Due */}
      <div className={`flex flex-none flex-col gap-2.5 pt-[1.125rem] ${pad}`}>
        <span className={LABEL}>{task ? "Due" : "Day"}</span>
        <div className="grid grid-cols-7">
          {days.map((d, i) => {
            const selected = d === date;
            const isToday = d === today;
            return (
              <button
                key={d}
                type="button"
                aria-pressed={selected}
                aria-label={panelDateText(d, today)}
                onClick={() => moveTo(d)}
                className="flex flex-col items-center gap-1.5"
              >
                <span
                  className={`text-[0.6875rem] font-medium leading-none ${
                    selected ? "text-sage" : "text-ink-500"
                  }`}
                >
                  {DOW_LETTER[i]}
                </span>
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-full text-[0.9375rem] font-semibold leading-none ${
                    selected
                      ? "bg-sage text-sage-ink"
                      : isToday
                        ? "text-sage shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--sage)_60%,transparent)]"
                        : "text-ink-200 hover:bg-white/5"
                  }`}
                >
                  {dayOfMonth(d)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Notes */}
      <div
        className={`flex flex-col gap-2.5 pt-[1.125rem] ${pad} ${
          variant === "side" ? "flex-[1_0_auto]" : "flex-none"
        }`}
      >
        <span className={LABEL}>Notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={commitNotes}
          placeholder="Add details, links, what to bring…"
          aria-label="Notes"
          className={`w-full resize-none rounded-xl bg-white/4 px-3 py-2.5 text-[0.90625rem] leading-normal text-ink-200 outline-none placeholder:text-ink-600 ${
            variant === "side" ? "min-h-[8.75rem] flex-[1_0_8.75rem]" : "h-20"
          }`}
        />
      </div>

      <div className="mt-5 h-px flex-none bg-white/7" />
      <div className={`flex flex-none items-center pt-1 ${variant === "side" ? "px-3.5" : "px-3"}`}>
        {date !== tomorrow && (
          <button
            type="button"
            onClick={() => moveTo(tomorrow)}
            className="h-12 px-2 text-[0.9375rem] font-medium leading-none text-ink-200"
          >
            Move to tomorrow
          </button>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => {
            if (task) agenda.deleteTask(task.id);
            else if (event) agenda.deleteEvent(event.id);
            onClose();
          }}
          className="h-12 px-2 text-[0.9375rem] font-medium leading-none text-overdue"
        >
          Delete
        </button>
      </div>
    </div>
  );

  return (
    <div
      className={`fixed inset-0 z-50 flex ${
        variant === "sheet"
          ? "flex-col justify-end bg-[rgba(5,6,7,0.55)]"
          : "justify-end bg-[rgba(5,6,7,0.45)]"
      }`}
      onClick={close}
    >
      {panel}
    </div>
  );
}

