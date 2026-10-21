"use client";

import { useEffect, useRef, useState } from "react";

import type { TagResult } from "@/app/app/actions";
import {
  DOW_LETTER,
  dayOfMonth,
  formatClockInput,
  formatDuration,
  panelDateText,
  parseDurationInput,
  parseTimeInput,
} from "@/lib/agenda-today";
import { addDays, startOfWeek, weekDays } from "@/lib/dates";
import { nextSubjectColor } from "@/lib/subjects";

import { CheckGlyph, SubjectDot } from "./atoms";
import type { TodayAgenda } from "./useTodayAgenda";

/**
 * One event's or task's own page (NewEventPanel below is the same page for an
 * event that doesn't exist yet): rename it, set its time (and, for a task,
 * how long it takes — its block on the schedule), pick its subject or make a
 * new one, move it to another day, keep notes on it, tick it off or delete
 * it. A task's time is its block, not its reminder: the two are separate. A bottom sheet on phone; a panel sliding in from the
 * right on tablet/desktop.
 *
 * Title, time, duration and notes are drafts while you type and save when the field
 * loses focus or the panel closes, so a sentence of notes is one write, not
 * forty.
 */

export type PanelTarget = { kind: "event" | "task"; id: string };

/**
 * Phone: a bottom sheet. md+: a panel sliding in from the right — or, on a
 * screen with room to spare (wide AND tall), a centered modal, so the item
 * doesn't sit pinned to the far edge of a big monitor.
 */
export type PanelVariant = "sheet" | "side" | "modal";

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
  variant: PanelVariant;
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
  const serverStart = (task ? task.startMin : event?.startMin) ?? null;
  const serverTime = formatClockInput(serverStart);
  const serverDuration =
    task?.durationMin != null ? formatDuration(task.durationMin) : "";

  const [title, setTitle] = useState(serverTitle);
  const [notes, setNotes] = useState(serverNotes);
  const [time, setTime] = useState(serverTime);
  const [duration, setDuration] = useState(serverDuration);

  // Latest drafts for the close-time flush (the handlers below close over
  // stale values otherwise).
  const drafts = useRef({ title, notes, time, duration });
  drafts.current = { title, notes, time, duration };

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
    if (task) {
      const parsed = parseTimeInput(drafts.current.time);
      if (parsed === "invalid") {
        setTime(formatClockInput(task.startMin));
        return;
      }
      if (parsed === task.startMin) return;
      // Clearing the time takes the task off the schedule, length and all.
      agenda.setTaskBlock(task.id, parsed, parsed === null ? null : task.durationMin);
      setTime(formatClockInput(parsed));
      if (parsed === null) setDuration("");
      return;
    }
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

  const commitDuration = () => {
    if (!task) return;
    // On close, `task` predates a time committed a moment ago: read the draft.
    const typed = parseTimeInput(drafts.current.time);
    const start = typed === "invalid" ? task.startMin : typed;
    if (start === null) return;
    const parsed = parseDurationInput(drafts.current.duration);
    const reset = task.durationMin != null ? formatDuration(task.durationMin) : "";
    if (parsed === "invalid") {
      setDuration(reset);
      return;
    }
    if (parsed === task.durationMin) {
      setDuration(reset);
      return;
    }
    agenda.setTaskBlock(task.id, start, parsed);
    setDuration(parsed === null ? "" : formatDuration(parsed));
  };

  const close = () => {
    commitTitle();
    commitNotes();
    // Time first: a duration only sticks to a task that has one.
    commitTime();
    commitDuration();
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

  // Null only for an undated Someday task: no day is picked, and the strip
  // shows this week to pick one from.
  const date = task
    ? (task.dueAt?.slice(0, 10) ?? null)
    : (event as NonNullable<typeof event>).localDate;
  const subjectId = task ? (task.tags[0]?.id ?? null) : (event?.tagId ?? null);
  const subject = subjectId ? agenda.subjectById.get(subjectId) ?? null : null;
  const done = task ? task.completedAt !== null : false;
  const days = weekDays(startOfWeek(date ?? today));
  const tomorrow = addDays(today, 1);

  const moveTo = (d: string) => {
    if (d === date) return;
    if (task) agenda.moveTask(task.id, d);
    else if (event) agenda.updateEvent(event.id, { localDate: d });
  };

  const pickSubject = (next: string | null) => {
    if (task) agenda.setTaskSubject(task.id, next);
    else if (event) agenda.updateEvent(event.id, { tagId: next });
  };

  // "Beta · due Tue, Jul 8 · late" / "Beta · Today · 11:30"
  const dateText = date === null ? null : panelDateText(date, today);
  const meta = task
    ? [
        subject?.name,
        dateText === null
          ? "no date"
          : `due ${dateText === "Today" || dateText === "Tomorrow" ? dateText.toLowerCase() : dateText}`,
        task.startMin === null ? null : formatClockInput(task.startMin),
        done
          ? "done"
          : task.someday
            ? "someday"
            : date !== null && date < today
              ? "late"
              : null,
      ]
    : [
        subject?.name,
        dateText,
        event?.startMin === null ? "All day" : formatClockInput(event?.startMin ?? null),
      ];
  const metaLine = meta.filter(Boolean).join(" · ");

  const pad = padFor(variant);

  return (
    <PanelFrame variant={variant} label={task ? "Task" : "Event"} onClose={close}>

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

      {/* Time. A task needs a day before it can have a time. */}
      {(event || date !== null) && (
        <TimeRow
          value={time}
          onChange={setTime}
          onCommit={commitTime}
          placeholder={task ? "None" : "All day"}
          pad={pad}
        />
      )}

      {/* Duration (a task with a time: how long its block is) */}
      {task && task.startMin !== null && (
        <div className={`flex flex-none items-center gap-3 pt-2.5 ${pad}`}>
          <span className={LABEL}>Duration</span>
          <span className="flex-1" />
          <span className="text-[0.75rem] leading-none text-ink-600">45m · 1h · 1h30</span>
          <input
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            onBlur={commitDuration}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            placeholder="15m"
            aria-label="Duration"
            className="h-10 w-24 rounded-[0.625rem] bg-white/5 px-3 text-right font-mono text-[0.9375rem] font-medium leading-none text-ink-100 outline-none placeholder:text-ink-600"
          />
        </div>
      )}

      <SubjectPicker agenda={agenda} selectedId={subjectId} onPick={pickSubject} pad={pad} />

      {/* Day / Due — tasks can also be parked in Someday or lose their date */}
      <div className={`flex flex-none flex-col gap-2.5 pt-[1.125rem] ${pad}`}>
        {task ? (
          <div className="-my-2.5 flex items-center">
            <span className={LABEL}>Due</span>
            <span className="flex-1" />
            <button
              type="button"
              aria-pressed={task.someday}
              onClick={() => {
                commitTitle();
                commitNotes();
                agenda.setTaskSomeday(task.id, !task.someday);
              }}
              className={`h-9 rounded-[0.625rem] px-2.5 text-[0.8125rem] font-medium leading-none ${
                task.someday ? "bg-white/8 text-ink-100" : "text-ink-400 hover:bg-white/4"
              }`}
            >
              Someday
            </button>
            {date !== null && (
              <button
                type="button"
                onClick={() => {
                  commitTitle();
                  commitNotes();
                  agenda.clearTaskDue(task.id);
                }}
                className="-mr-2.5 h-9 rounded-[0.625rem] px-2.5 text-[0.8125rem] font-medium leading-none text-ink-400 hover:bg-white/4"
              >
                No date
              </button>
            )}
          </div>
        ) : (
          <span className={LABEL}>Day</span>
        )}
        <DayStrip days={days} date={date} today={today} onPick={moveTo} />
      </div>

      <NotesBox
        value={notes}
        onChange={setNotes}
        onBlur={commitNotes}
        variant={variant}
        pad={pad}
      />

      <div className="mt-5 h-px flex-none bg-white/7" />
      <div className={`flex flex-none items-center pt-1 ${variant === "sheet" ? "px-3" : "px-3.5"}`}>
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
    </PanelFrame>
  );
}


// ---------------------------------------------------------------------------
// A new event: the same page, as a form
// ---------------------------------------------------------------------------

/**
 * "+ Add event" opens this: the item panel's page for an event that doesn't
 * exist yet. Nothing is written until Add; Cancel drops the draft. Closing
 * any other way (Escape, a tap outside) keeps it when it has a title, the
 * way the item panel saves its drafts on close.
 */
export function NewEventPanel({
  date: initialDate,
  agenda,
  today,
  variant,
  onClose,
}: {
  date: string;
  agenda: TodayAgenda;
  today: string;
  variant: PanelVariant;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [date, setDate] = useState(initialDate);
  const [notes, setNotes] = useState("");

  const startMin = parseTimeInput(time);
  const canAdd = title.trim() !== "";

  const add = () => {
    const t = title.trim();
    if (t) {
      agenda.addEvent(t, date, startMin === "invalid" ? null : startMin, subjectId, notes);
    }
    onClose();
  };
  const addRef = useRef(add);
  addRef.current = add;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") addRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pad = padFor(variant);
  const subject = subjectId ? agenda.subjectById.get(subjectId) ?? null : null;
  const meta = [
    subject?.name ?? "New event",
    panelDateText(date, today),
    startMin === null || startMin === "invalid" ? "All day" : formatClockInput(startMin),
  ].join(" · ");

  return (
    <PanelFrame variant={variant} label="New event" onClose={add}>
      <div className={`flex flex-none items-start gap-3 ${pad}`}>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <textarea
            autoFocus
            value={title}
            rows={2}
            onChange={(e) => setTitle(e.target.value.replace(/\n/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="New event"
            aria-label="Title"
            className="-mt-0.5 h-[3.125rem] resize-none overflow-hidden bg-transparent p-0 text-[1.25rem] font-semibold leading-[1.5625rem] tracking-[-0.0125rem] text-ink-100 outline-none placeholder:text-ink-600"
          />
          <span className="text-[0.8125rem] leading-[1.3] text-ink-400">{meta}</span>
        </div>
        <button
          type="button"
          onClick={add}
          disabled={!canAdd}
          className="-mr-2 -mt-2 h-11 flex-none px-2 text-[0.9375rem] font-semibold leading-none text-sage disabled:text-ink-600"
        >
          Add
        </button>
      </div>

      <div className="mt-[1.125rem] h-px flex-none bg-white/7" />

      <TimeRow
        value={time}
        onChange={setTime}
        onCommit={() => {
          if (startMin === "invalid") setTime("");
          else setTime(formatClockInput(startMin));
        }}
        placeholder="All day"
        pad={pad}
      />

      <SubjectPicker agenda={agenda} selectedId={subjectId} onPick={setSubjectId} pad={pad} />

      <div className={`flex flex-none flex-col gap-2.5 pt-[1.125rem] ${pad}`}>
        <span className={LABEL}>Day</span>
        <DayStrip
          days={weekDays(startOfWeek(date))}
          date={date}
          today={today}
          onPick={setDate}
        />
      </div>

      <NotesBox value={notes} onChange={setNotes} variant={variant} pad={pad} />

      <div className="mt-5 h-px flex-none bg-white/7" />
      <div className={`flex flex-none items-center pt-1 ${variant === "sheet" ? "px-3" : "px-3.5"}`}>
        <button
          type="button"
          onClick={onClose}
          className="h-12 px-2 text-[0.9375rem] font-medium leading-none text-ink-300"
        >
          Cancel
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={add}
          disabled={!canAdd}
          className="h-12 px-2 text-[0.9375rem] font-semibold leading-none text-sage disabled:text-ink-600"
        >
          Add event
        </button>
      </div>
    </PanelFrame>
  );
}

// ---------------------------------------------------------------------------
// Pieces shared by both pages
// ---------------------------------------------------------------------------

function padFor(variant: PanelVariant): string {
  return variant === "sheet" ? "px-5" : "px-[1.375rem]";
}

/** The backdrop and the sheet / side panel / modal around a page. */
function PanelFrame({
  variant,
  label,
  onClose,
  children,
}: {
  variant: PanelVariant;
  label: string;
  /** A tap on the backdrop. */
  onClose: () => void;
  children: React.ReactNode;
}) {
  const backdrop =
    variant === "sheet"
      ? "flex-col justify-end bg-[rgba(5,6,7,0.55)]"
      : variant === "modal"
        ? "items-center justify-center bg-[rgba(5,6,7,0.55)] p-8"
        : "justify-end bg-[rgba(5,6,7,0.45)]";
  const box =
    variant === "sheet"
      ? "agenda-sheet-in max-h-[92%] rounded-t-[1.75rem] pb-[calc(1.875rem+env(safe-area-inset-bottom))] pt-2.5 shadow-[0_-24px_60px_rgba(0,0,0,0.55)]"
      : variant === "modal"
        ? "agenda-modal-in max-h-[min(46rem,100%)] w-[34rem] max-w-full rounded-[1.25rem] border border-white/8 pb-3 pt-[1.375rem] shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
        : "agenda-panel-in relative h-full w-[25rem] max-w-full border-l border-white/8 pb-3 pt-[1.375rem] shadow-[-24px_0_60px_rgba(0,0,0,0.5)]";
  return (
    <div className={`fixed inset-0 z-50 flex ${backdrop}`} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        className={`flex flex-col overflow-y-auto bg-panel ${box}`}
      >
        {variant === "sheet" && (
          <span aria-hidden className="mb-3.5 h-[0.3125rem] w-9 flex-none self-center rounded-sm bg-white/18" />
        )}
        {children}
      </div>
    </div>
  );
}

function TimeRow({
  value,
  onChange,
  onCommit,
  placeholder,
  pad,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  placeholder: string;
  pad: string;
}) {
  return (
    <div className={`flex flex-none items-center gap-3 pt-3.5 ${pad}`}>
      <span className={LABEL}>Time</span>
      <span className="flex-1" />
      <span className="text-[0.75rem] leading-none text-ink-600">2:30 · 9a · 4pm</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        placeholder={placeholder}
        aria-label="Time"
        className="h-10 w-24 rounded-[0.625rem] bg-white/5 px-3 text-right font-mono text-[0.9375rem] font-medium leading-none text-ink-100 outline-none placeholder:text-ink-600"
      />
    </div>
  );
}

/**
 * The subject chips plus "+ New subject". Tapping the selected chip clears
 * it; a new subject is created and picked in one go.
 */
function SubjectPicker({
  agenda,
  selectedId,
  onPick,
  pad,
}: {
  agenda: TodayAgenda;
  selectedId: string | null;
  onPick: (id: string | null) => void;
  pad: string;
}) {
  const [naming, setNaming] = useState<string | null>(null);

  const commitNewSubject = async () => {
    const name = naming?.trim();
    setNaming(null);
    if (!name) return;
    const existing = agenda.subjects.find(
      (s) => s.name.toLowerCase() === name.toLowerCase(),
    );
    const tag = existing ?? (await agenda.createSubject(name));
    if (tag) onPick(tag.id);
  };

  return (
    <div className={`flex flex-none flex-col gap-2.5 pt-4 ${pad}`}>
      <span className={LABEL}>Subject</span>
      <div className="-ml-2.5 flex flex-wrap gap-1">
        {agenda.subjects.map((s: TagResult) => {
          const selected = s.id === selectedId;
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onPick(selected ? null : s.id)}
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
  );
}

/** One week's days, the picked one filled, today ringed. */
function DayStrip({
  days,
  date,
  today,
  onPick,
}: {
  days: string[];
  date: string | null;
  today: string;
  onPick: (d: string) => void;
}) {
  return (
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
            onClick={() => onPick(d)}
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
  );
}

/** Notes fill the side panel's height; the sheet and modal keep a fixed box. */
function NotesBox({
  value,
  onChange,
  onBlur,
  variant,
  pad,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  variant: PanelVariant;
  pad: string;
}) {
  const grow = variant === "side";
  return (
    <div
      className={`flex flex-col gap-2.5 pt-[1.125rem] ${pad} ${
        grow ? "flex-[1_0_auto]" : "flex-none"
      }`}
    >
      <span className={LABEL}>Notes</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder="Add details, links, what to bring…"
        aria-label="Notes"
        className={`w-full resize-none rounded-xl bg-white/4 px-3 py-2.5 text-[0.90625rem] leading-normal text-ink-200 outline-none placeholder:text-ink-600 ${
          grow
            ? "min-h-[8.75rem] flex-[1_0_8.75rem]"
            : variant === "modal"
              ? "h-32"
              : "h-20"
        }`}
      />
    </div>
  );
}
