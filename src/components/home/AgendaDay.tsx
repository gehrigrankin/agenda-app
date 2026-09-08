"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  Bell,
  Check,
  ChevronRight,
  CornerLeftUp,
  FileText,
  Plus,
  Repeat,
  Settings2,
} from "lucide-react";

import type {
  AgendaLineResult,
  AgendaTaskResult,
  TagResult,
} from "@/app/app/actions";
import { NOTES_TOOLS_HOST_ID } from "@/components/home/DailyNoteWidget";
import { ImportantStar } from "@/components/tasks/ImportantStar";
import { TagChip } from "@/components/tasks/TaskTagPicker";
import { groupIntoLines, minutesToHHMM } from "@/lib/agenda-lines";
import { addDays, parseLocalDate } from "@/lib/dates";
import { formatTimeShort, recurrenceChipLabel } from "@/lib/recurrence";
import type { RangeCalendarEvent } from "@/server/calendar";
import type { UserEvent } from "@/server/events";

/**
 * The open page of the paper agenda: one day, printed rather than listed.
 *
 * A school agenda's day is not a to-do list — it is a page with a shape you
 * meet again every morning: what is scheduled at the top, then the subjects
 * ruled down the page (Work, Gym, Errands — the owner's pinned tags), each
 * ending in a blank slot you write on, and a notes margin at the foot. That
 * shape is the product: an empty line is not an empty state to be hidden, it
 * is the invitation, so every line renders even with nothing on it.
 *
 * Today's page is writable; a past page is a RECORD — done struck, undone
 * dimmed with a "carried" chip, no blank slots to write in, quieter ink — but
 * still tickable, because remembering yesterday is a real thing to do.
 *
 * The component is presentational: the parent owns week state, so toggles,
 * stars and creates are callbacks and every optimistic patch happens up there.
 */

/** Section label — the one used across the home surfaces. */
const SECTION_LABEL =
  "text-[0.625rem] font-medium uppercase tracking-[0.0875rem] text-ink-600";

/** Horizontal rhythm of every band. The phone loses 4px because the ruled
 * grid's label column already eats a third of a narrow screen. */
const BAND_X = "px-4 md:px-5";

/** A ruled row: comfortable to tap on phone, tight and printed on desktop. */
const RULED_ROW =
  "min-h-[2.125rem] max-md:min-h-11 md:min-h-[1.875rem] border-b border-white/6";

/** The right-hand "Calendar →" / "Edit lines" links on a section label row. */
const LABEL_LINK =
  "flex items-center gap-1 text-[0.65625rem] text-ink-400 hover:text-ink-300";

/**
 * The two past-due piles, kept identical to TasksWidget's OVERDUE_GROUPS:
 * red is spent only on tasks the user starred, everything else that slipped
 * reads calm blue and collapses, so a long tail of low-stakes carried work
 * never crowds out the day you actually opened.
 */
const OVERDUE_GROUPS = [
  {
    key: "important",
    label: "Overdue",
    header: "text-overdue",
    row: "border-overdue/20 bg-overdue/5",
    title: "text-[#DDB4AD]",
    box: "border-[#6B4F4B] hover:bg-overdue/20",
  },
  {
    key: "calm",
    label: "Carried over",
    header: "text-overdue-calm",
    row: "border-overdue-calm/20 bg-overdue-calm/5",
    title: "text-[#B3C6D6]",
    box: "border-[#4A5A66] hover:bg-overdue-calm/20",
  },
] as const;

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

/** The standardized "carried 3d" label, taking its tone from the star. */
function CarriedChip({
  dueAt,
  day,
  important,
}: {
  dueAt: string;
  day: string;
  important: boolean;
}) {
  return (
    <span
      className={`flex-none rounded px-1.5 py-0.5 text-[0.625rem] font-medium ${
        important
          ? "bg-overdue/10 text-overdue"
          : "bg-overdue-calm/10 text-overdue-calm"
      }`}
    >
      carried {carriedDays(dueAt, day)}d
    </span>
  );
}

/** Quiet recurring/reminder chip for an open row — recurring wins. */
function TaskChip({ task }: { task: AgendaTaskResult }) {
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
 * One chip and a "+N", never the whole set: a ruled row is a line of writing,
 * and three chips that refuse to shrink push the task's own words off it.
 */
function WidgetTagChips({ tags }: { tags: TagResult[] }) {
  if (tags.length === 0) return null;
  const [first, ...rest] = tags;
  return (
    <span className="flex flex-none items-center gap-1">
      <TagChip tag={first} maxWidth="max-w-[4.5rem]" />
      {rest.length > 0 && (
        <span
          title={rest.map((t) => `#${t.name}`).join(" ")}
          className="flex-none text-[0.625rem] font-medium text-ink-600"
        >
          +{rest.length}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ header */

/** "Today" / "Yesterday" / "Tomorrow" / "Record" — where the page sits in
 * time, in one word. Future days past tomorrow get nothing: they are just
 * days, and a pill on each of them would say only "not now". */
function DayStatusPill({ dateStr, today }: { dateStr: string; today: string }) {
  if (dateStr === today) {
    return (
      <span className="flex-none rounded-full bg-sage/16 px-2 py-0.5 text-[0.625rem] font-medium text-sage">
        Today
      </span>
    );
  }
  if (dateStr === addDays(today, -1) || dateStr === addDays(today, 1)) {
    return (
      <span className="flex-none rounded-full bg-white/6 px-2 py-0.5 text-[0.625rem] font-medium text-ink-400">
        {dateStr < today ? "Yesterday" : "Tomorrow"}
      </span>
    );
  }
  if (dateStr < today) {
    return (
      <span className="flex-none text-[0.625rem] font-medium uppercase tracking-[0.0875rem] text-ink-600">
        Record
      </span>
    );
  }
  return null;
}

/* ---------------------------------------------------------------- schedule */

/** A schedule row, after user events and ICS occurrences are made one shape. */
type ScheduleRow = {
  key: string;
  title: string;
  allDay: boolean;
  /** Minutes since local midnight; null when all-day (sorts first). */
  startMin: number | null;
  /** "9 AM – 10 AM", or null when all-day. */
  time: string | null;
};

/** Local "HH:MM" of an instant — ICS carries instants, the band shows clock
 * time, and the clock that matters is the reader's. */
function isoHHMM(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

function timeRange(startHHMM: string, endHHMM: string | null): string {
  const start = formatTimeShort(startHHMM);
  return endHHMM ? `${start} – ${formatTimeShort(endHHMM)}` : start;
}

function scheduleRows(
  dateStr: string,
  events: UserEvent[],
  icsEvents: RangeCalendarEvent[],
): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  for (const event of events) {
    // A multi-day event's start time belongs to its first day only — printing
    // "9 AM" on day three of a trip is a lie the eye believes.
    const continuation =
      event.endLocalDate !== null && event.localDate !== dateStr;
    const start = continuation ? null : event.startMin;
    rows.push({
      key: `user:${event.id}`,
      title: event.title,
      allDay: start === null,
      startMin: start,
      time:
        start === null
          ? null
          : timeRange(
              minutesToHHMM(start),
              event.endMin === null || continuation
                ? null
                : minutesToHHMM(event.endMin),
            ),
    });
  }
  for (const event of icsEvents) {
    const startIso = event.startIso;
    const timed = !event.allDay && startIso !== null;
    const startHHMM = timed && startIso ? isoHHMM(startIso) : null;
    rows.push({
      key: `ics:${event.uid}:${event.date}`,
      title: event.title,
      allDay: !timed,
      startMin: startHHMM
        ? Number(startHHMM.slice(0, 2)) * 60 + Number(startHHMM.slice(3, 5))
        : null,
      time: startHHMM
        ? timeRange(startHHMM, event.endIso ? isoHHMM(event.endIso) : null)
        : null,
    });
  }
  // All-day first (they frame the whole page), then the clock.
  return rows.sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return (a.startMin ?? 0) - (b.startMin ?? 0);
  });
}

function ScheduleBand({
  dateStr,
  events,
  icsEvents,
}: {
  dateStr: string;
  events: UserEvent[];
  icsEvents: RangeCalendarEvent[];
}) {
  const rows = scheduleRows(dateStr, events, icsEvents);
  if (rows.length === 0) return null;
  return (
    <section className={`${BAND_X} pb-1 pt-3.5`}>
      <div className="flex items-center pb-1.5">
        <span className={SECTION_LABEL}>Schedule</span>
        <Link href="/app/calendar" className={`ml-auto ${LABEL_LINK}`}>
          Calendar →
        </Link>
      </div>
      <div className="flex flex-col">
        {rows.map((row) => (
          <div
            key={row.key}
            className="flex min-h-[1.75rem] max-md:min-h-11 items-center gap-2.5"
          >
            <span className="h-1.5 w-1.5 flex-none rounded-full bg-event" />
            {row.allDay ? (
              <span className="w-[6.5rem] flex-none text-[0.65625rem] text-ink-600">
                all day
              </span>
            ) : (
              <span className="w-[6.5rem] flex-none tabular-nums text-[0.6875rem] text-ink-400">
                {row.time}
              </span>
            )}
            <span className="min-w-0 flex-1 break-words text-[0.8125rem] text-ink-200 md:text-[0.78125rem]">
              {row.title}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- carried */

function CarriedBand({
  carried,
  today,
  onToggle,
  onStar,
}: {
  carried: AgendaTaskResult[];
  today: string;
  onToggle: (task: AgendaTaskResult, done: boolean) => void;
  onStar: (taskId: string, important: boolean) => void;
}) {
  const [calmOpen, setCalmOpen] = useState(false);
  if (carried.length === 0) return null;
  return (
    // id: the plan card's "N carried from earlier days" deep link lands here
    // (it anchored the tasks widget before the agenda took carried tasks in).
    <section id="tasks-widget" className={`${BAND_X} scroll-mt-4 pt-1`}>
      {OVERDUE_GROUPS.map((group) => {
        const tasks = carried.filter((t) =>
          group.key === "important" ? t.important : !t.important,
        );
        if (tasks.length === 0) return null;
        const collapsible = group.key === "calm";
        const open = !collapsible || calmOpen;
        return (
          <div key={group.key}>
            {collapsible ? (
              <button
                type="button"
                aria-expanded={calmOpen}
                onClick={() => setCalmOpen((prev) => !prev)}
                className={`flex w-full items-center gap-1.5 pb-1 pt-2.5 text-left ${SECTION_LABEL} ${group.header}`}
              >
                <CornerLeftUp className="h-3 w-3" />
                {group.label}
                <span className="opacity-70">· {tasks.length}</span>
                <ChevronRight
                  className={`ml-auto h-3 w-3 transition-transform ${
                    calmOpen ? "rotate-90" : ""
                  }`}
                />
              </button>
            ) : (
              <div
                className={`flex items-center gap-1.5 pb-1 pt-2.5 ${SECTION_LABEL} ${group.header}`}
              >
                <CornerLeftUp className="h-3 w-3" />
                {group.label}
              </div>
            )}
            {open && (
              <div className="flex flex-col gap-1">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className={`flex items-start gap-2.5 rounded-lg border px-2.5 py-2 ${group.row}`}
                  >
                    <button
                      type="button"
                      aria-label={`Mark “${task.title}” complete`}
                      onClick={() => onToggle(task, true)}
                      className={`mt-0.5 h-[0.9375rem] w-[0.9375rem] flex-none rounded-[0.25rem] border-[1.5px] ${group.box}`}
                    />
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span
                        className={`min-w-[8rem] flex-1 whitespace-pre-wrap break-words text-[0.78125rem] ${group.title}`}
                      >
                        {task.title}
                      </span>
                      <span className="ml-auto flex flex-none items-center gap-2.5">
                        <WidgetTagChips tags={task.tags} />
                        <TaskChip task={task} />
                        <ImportantStar
                          important={task.important}
                          overdue
                          onToggle={(next) => onStar(task.id, next)}
                        />
                        <CarriedChip
                          dueAt={task.dueAt}
                          day={today}
                          important={task.important}
                        />
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

/* ------------------------------------------------------------------- lines */

function TaskRow({
  task,
  lineTagId,
  isPast,
  onToggle,
  onStar,
}: {
  task: AgendaTaskResult;
  /** The line's own tag — it is the row's address, not news, so it is the one
   * chip a row never repeats. */
  lineTagId: string | null;
  isPast: boolean;
  onToggle: (task: AgendaTaskResult, done: boolean) => void;
  onStar: (taskId: string, important: boolean) => void;
}) {
  const done = task.completedAt !== null;
  const extraTags = task.tags.filter((t) => t.id !== lineTagId);
  return (
    <div
      className={`flex items-center gap-2.5 ${RULED_ROW} ${
        isPast && !done ? "opacity-70" : ""
      }`}
    >
      {done ? (
        <button
          type="button"
          aria-label={`Mark “${task.title}” incomplete`}
          onClick={() => onToggle(task, false)}
          className="flex h-[0.9375rem] w-[0.9375rem] flex-none items-center justify-center rounded-[0.25rem] bg-sage"
        >
          <Check className="h-2.5 w-2.5 text-sage-ink" />
        </button>
      ) : (
        <button
          type="button"
          aria-label={`Mark “${task.title}” complete`}
          onClick={() => onToggle(task, true)}
          className="h-[0.9375rem] w-[0.9375rem] flex-none rounded-[0.25rem] border-[1.5px] border-ink-700 hover:bg-sage/15"
        />
      )}
      <span
        className={`min-w-0 flex-1 whitespace-pre-wrap break-words text-[0.8125rem] leading-[1.35] md:text-[0.78125rem] ${
          done ? "strike-muted text-ink-500 line-through" : "text-ink-200"
        }`}
      >
        {task.title}
      </span>
      <span className="flex flex-none items-center gap-2.5">
        <WidgetTagChips tags={extraTags} />
        {!done && <TaskChip task={task} />}
        {isPast && !done && (
          <span className="flex-none rounded bg-overdue-calm/10 px-1.5 py-0.5 text-[0.625rem] font-medium text-overdue-calm">
            carried
          </span>
        )}
        <ImportantStar
          important={task.important}
          onToggle={(next) => onStar(task.id, next)}
        />
        {task.noteId && (
          <Link
            href={`/app/notes/${task.noteId}`}
            aria-label="Open containing note"
            className="flex-none rounded p-0.5 text-ink-600 hover:text-ink-300"
          >
            <FileText className="h-3.5 w-3.5" />
          </Link>
        )}
      </span>
    </div>
  );
}

/**
 * The blank slot at the end of every line — the whole point of a ruled page.
 * The write is optimistic in the only way that matters here: the words leave
 * the input the instant you press Enter, so the next thought can go straight
 * in, and they come back with an apology if the server refused them.
 */
function AddSlot({
  lineId,
  lineName,
  onAdd,
}: {
  lineId: string | null;
  lineName: string;
  onAdd: (title: string, lineId: string | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const submit = () => {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    setFailed(false);
    onAdd(title, lineId).catch((err) => {
      console.error("[agenda] add failed:", err);
      setDraft((current) => (current ? current : title));
      setFailed(true);
    });
  };

  return (
    <>
      {/* The row is the target, not the caret-width input: on a printed line
          you write where the line is. */}
      <div
        className={`flex cursor-text items-center gap-2.5 ${RULED_ROW}`}
        onClick={() => inputRef.current?.focus()}
      >
        <Plus className="h-3 w-3 flex-none text-ink-700" />
        <input
          ref={inputRef}
          value={draft}
          aria-label={`Write on the ${lineName} line`}
          placeholder="Write here…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              e.currentTarget.blur();
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-[0.8125rem] text-ink-100 outline-none placeholder:text-ink-700 md:text-[0.78125rem]"
        />
      </div>
      {failed && (
        <p className="pt-1 text-[0.65625rem] text-overdue">
          Couldn’t save that — press Enter to try again.
        </p>
      )}
    </>
  );
}

function LineBlock({
  line,
  tasks,
  dateStr,
  today,
  onToggle,
  onStar,
  onAdd,
}: {
  /** Null for the trailing unlabeled line. */
  line: AgendaLineResult | null;
  tasks: AgendaTaskResult[];
  dateStr: string;
  today: string;
  onToggle: (task: AgendaTaskResult, done: boolean) => void;
  onStar: (taskId: string, important: boolean) => void;
  onAdd: (title: string, lineId: string | null) => Promise<void>;
}) {
  const isPast = dateStr < today;
  // Open work first, finished work after it: the page reads as what is left.
  const ordered = [
    ...tasks.filter((t) => t.completedAt === null),
    ...tasks.filter((t) => t.completedAt !== null),
  ];
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] md:grid-cols-[7.5rem_minmax(0,1fr)]">
      <div className="pr-3 pt-2">
        {line ? (
          <span
            className={`block break-words text-[0.6875rem] font-semibold uppercase tracking-[0.06em] ${
              line.color ? "" : "text-ink-400"
            }`}
            style={line.color ? { color: line.color } : undefined}
          >
            {line.name}
          </span>
        ) : (
          <span className="block text-[0.6875rem] font-semibold text-ink-700">
            —<span className="sr-only">Unlabeled</span>
          </span>
        )}
      </div>
      <div className="flex flex-col">
        {ordered.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            lineTagId={line?.id ?? null}
            isPast={isPast}
            onToggle={onToggle}
            onStar={onStar}
          />
        ))}
        {isPast ? (
          // A record still shows its ruling — a line with nothing written on
          // it is information about that day.
          ordered.length === 0 && <div className={RULED_ROW} />
        ) : (
          <AddSlot
            lineId={line?.id ?? null}
            lineName={line ? line.name : "unlabeled"}
            onAdd={onAdd}
          />
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- first run */

/** Before any line exists the page is honest but blank, and a blank page
 * doesn't explain itself. One card, one sentence, one input. */
function FirstRunCard({
  onCreateLine,
}: {
  onCreateLine: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    setPending(true);
    onCreateLine(trimmed)
      .then(() => setName(""))
      .catch((err) => console.error("[agenda] create line failed:", err))
      .finally(() => setPending(false));
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="mb-3 rounded-xl border border-white/8 bg-white/3 px-3.5 py-3"
    >
      <p className="text-[0.8125rem] font-semibold text-ink-200">
        Print your lines
      </p>
      <p className="pt-1 text-[0.71875rem] leading-[1.45] text-ink-500">
        Lines are the subjects printed on every day — Work, Gym, Errands. Add a
        few and they show up here every day.
      </p>
      <div className="flex items-center gap-2 pt-2.5">
        <input
          value={name}
          aria-label="New line name"
          placeholder="Work"
          onChange={(e) => setName(e.target.value)}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-white/7 bg-input px-2.5 text-[0.78125rem] text-ink-100 outline-none placeholder:text-ink-600 md:min-h-8"
        />
        <button
          type="submit"
          disabled={pending || name.trim() === ""}
          className="min-h-11 flex-none rounded-lg bg-white/8 px-3 text-[0.71875rem] font-medium text-ink-200 hover:bg-white/12 disabled:opacity-40 md:min-h-8"
        >
          Add line
        </button>
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------- skeleton */

/** Three ruled lines' worth of grey, in the page's own grid so nothing jumps
 * when the real day lands. */
function LinesSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="grid grid-cols-[6.5rem_minmax(0,1fr)] md:grid-cols-[7.5rem_minmax(0,1fr)]"
        >
          <div className="pr-3 pt-2">
            <div className="h-2.5 w-14 animate-pulse rounded bg-white/6" />
          </div>
          <div className="flex flex-col">
            <div className="flex min-h-[1.875rem] items-center border-b border-white/6">
              <div className="h-2.5 w-3/5 animate-pulse rounded bg-white/6" />
            </div>
            <div className="flex min-h-[1.875rem] items-center border-b border-white/6">
              <div className="h-2.5 w-2/5 animate-pulse rounded bg-white/6" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- the page */

export function AgendaDay({
  dateStr,
  today,
  lines,
  tasks,
  carried,
  events,
  icsEvents,
  loading,
  onToggle,
  onStar,
  onAdd,
  onCreateLine,
  notesSlot,
  hideHeader,
}: {
  dateStr: string;
  today: string;
  lines: AgendaLineResult[];
  /** Tasks DUE on dateStr, open and done. */
  tasks: AgendaTaskResult[];
  /** Overdue open tasks; the parent passes [] unless dateStr === today. */
  carried: AgendaTaskResult[];
  /** Quick-add events covering dateStr (parent already filtered by span). */
  events: UserEvent[];
  /** ICS occurrences on dateStr (parent already filtered). */
  icsEvents: RangeCalendarEvent[];
  loading: boolean;
  onToggle: (task: AgendaTaskResult, done: boolean) => void;
  onStar: (taskId: string, important: boolean) => void;
  /** Resolves when the task exists; rejects on failure (restore the draft). */
  onAdd: (title: string, lineId: string | null) => Promise<void>;
  /** Create a pinned tag by name (first-run "add a line"). */
  onCreateLine: (name: string) => Promise<void>;
  /** The daily note editor, rendered by the parent, shown as the Notes margin. */
  notesSlot: React.ReactNode;
  /** Phone hides the big header (the phone page header owns the date). */
  hideHeader?: boolean;
}): React.JSX.Element {
  const isPast = dateStr < today;
  const day = parseLocalDate(dateStr);
  const groups = groupIntoLines(tasks, lines);
  const lineById = new Map(lines.map((line) => [line.id, line]));

  return (
    <div
      data-agenda-day={dateStr}
      data-record={isPast ? "1" : undefined}
      className="flex min-h-0 flex-1 flex-col"
    >
      {!hideHeader && (
        <div className="flex flex-none items-center gap-2.5 border-b border-white/7 px-5 py-3">
          <span className="text-lg font-semibold text-ink-100">
            {day.toLocaleDateString("en-US", { weekday: "long" })}
          </span>
          <span className="min-w-0 truncate text-ink-500">
            {day.toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </span>
          <span className="ml-auto flex-none">
            <DayStatusPill dateStr={dateStr} today={today} />
          </span>
        </div>
      )}

      <div
        className={`min-h-0 flex-1 overflow-y-auto pb-6 ${
          isPast ? "text-ink-300" : ""
        }`}
      >
        {loading ? (
          <div className={`${BAND_X} pt-4`}>
            <LinesSkeleton />
          </div>
        ) : (
          <>
            <ScheduleBand
              dateStr={dateStr}
              events={events}
              icsEvents={icsEvents}
            />

            <CarriedBand
              carried={carried}
              today={today}
              onToggle={onToggle}
              onStar={onStar}
            />

            <section className={`${BAND_X} pt-3.5`}>
              <div className="flex items-center pb-1.5">
                <span className={SECTION_LABEL}>Lines</span>
                <Link
                  href="/app/settings#agenda-lines"
                  className={`ml-auto ${LABEL_LINK}`}
                >
                  <Settings2 className="h-3 w-3" />
                  Edit lines
                </Link>
              </div>

              {lines.length === 0 && <FirstRunCard onCreateLine={onCreateLine} />}

              <div className="flex flex-col gap-4">
                {groups.map((group) => (
                  <LineBlock
                    key={group.lineId ?? "unlabeled"}
                    line={
                      group.lineId ? (lineById.get(group.lineId) ?? null) : null
                    }
                    tasks={group.tasks}
                    dateStr={dateStr}
                    today={today}
                    onToggle={onToggle}
                    onStar={onStar}
                    onAdd={onAdd}
                  />
                ))}
              </div>
            </section>
          </>
        )}

        {/* The margin stays mounted through a day's load: the parent's editor
            lives in it, and remounting a document to show a spinner loses
            what is being typed. */}
        <div className={`${BAND_X} pt-5`}>
          <div className="flex items-center pb-1.5">
            <span className={SECTION_LABEL}>
              {isPast ? "Notes · as written" : "Notes"}
            </span>
            {/* The embedded daily editor portals its tool cluster (save chip,
                view toggles, voice, timeline, add block) in here — the label
                row is its header now. Rendered before the slot so the host
                exists by the time the editor mounts. */}
            <div
              id={NOTES_TOOLS_HOST_ID}
              className="ml-auto flex items-center gap-2"
            />
          </div>
        </div>
        <div className="flex min-h-[16rem] flex-col border-t border-white/7 md:min-h-[18rem]">
          {notesSlot}
        </div>
      </div>
    </div>
  );
}
