"use client";

import { formatClock, formatDuration, type EventPhase } from "@/lib/agenda-today";
import { subjectColor } from "@/lib/subjects";

import { CheckGlyph, NotesMark, SubjectDot } from "./atoms";
import type {
  DayBlock,
  DayEvent,
  DayScheduleEntry,
  HabitView,
} from "./useTodayAgenda";

/**
 * The day's schedule. Phone: a strip of event cards you swipe through, the
 * one on now (or next) outlined in blue, ending in a dashed + card. Tablet
 * and desktop have the height for a ruled list instead.
 *
 * Feed (ICS) events are printed but not editable, so they don't open the
 * item panel.
 *
 * All-day events head the schedule; everything timed follows by start.
 *
 * A task with a time sits in the schedule as a BLOCK: a dashed card (phone)
 * or a row with a square subject mark (md+), its length beside it. The block
 * is a picture of the task's time, not the task — there is no tick box here;
 * that stays on the task's row in Tasks. Tapping a block opens the task's
 * panel. Blocks take part in NOW/NEXT like events, but unlike an event a
 * block that has ended is NOT struck: only finishing the task strikes it.
 *
 * Habits with a start time sit in the schedule at that time, ticked off in
 * place (the untimed ones are the HabitsRow above it). They take no part in
 * NOW/NEXT.
 */

type Props = {
  /** Events and task blocks, already in order (useTodayAgenda's DayView). */
  schedule: DayScheduleEntry[];
  /** Past and done-for-today events are struck through only on today. */
  isToday: boolean;
  colorOf: (tagId: string | null) => string | null;
  onOpen: (event: DayEvent) => void;
  onOpenTask: (task: DayBlock) => void;
  /** Timed habits only. */
  habits: HabitView[];
  /** Habits tick off on today only. */
  habitsEditable: boolean;
  /** Untimed habits sit above: the day isn't empty, so no "Nothing scheduled". */
  habitsAbove: boolean;
  onToggleHabit: (id: string) => void;
};

type Slot = DayScheduleEntry | { kind: "habit"; habit: HabitView };

/** The schedule plus timed habits in one run by start; all-day events first. */
function slots(schedule: DayScheduleEntry[], habits: HabitView[]): Slot[] {
  const start = (s: Slot) =>
    (s.kind === "habit" ? s.habit.startMin : s.item.startMin) ??
    Number.NEGATIVE_INFINITY;
  // Stable: on a tie the schedule's own order (events, then blocks) holds.
  return [...schedule, ...habits.map((habit) => ({ kind: "habit" as const, habit }))].sort(
    (a, b) => {
      const sa = start(a);
      const sb = start(b);
      return sa === sb ? 0 : sa - sb;
    },
  );
}

/** "30m", "1h", "1h 15m". */
function durationText(item: { startMin: number | null; endMin: number | null }): string | null {
  if (item.startMin === null || item.endMin === null) return null;
  const mins = item.endMin - item.startMin;
  return mins > 0 ? formatDuration(mins) : null;
}

/** A task block's subject mark: square, where an event's is round. */
function BlockMark({ color, size }: { color: string | null | undefined; size: number }) {
  return (
    <span
      aria-hidden
      className="inline-block flex-none rounded-[0.0625rem]"
      style={{
        width: `${size / 16}rem`,
        height: `${size / 16}rem`,
        background: subjectColor(color),
      }}
    />
  );
}

function canOpenBlock(t: DayBlock): boolean {
  return !t.id.startsWith("temp-");
}

/** The habit tick box, sized to sit where an event's subject dot does. */
function HabitBox({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-3 w-3 flex-none items-center justify-center rounded-[0.1875rem] ${
        done ? "bg-sage" : "border-[1.5px] border-solid border-ink-600"
      }`}
    >
      {done && <CheckGlyph size="sm" />}
    </span>
  );
}

function phaseLabel(phase: EventPhase): string | null {
  if (phase === "now") return "NOW";
  if (phase === "next") return "NEXT";
  return null;
}

function canOpen(e: DayEvent): boolean {
  return e.source === "user" && !e.id.startsWith("temp-");
}

export function EventStrip({
  schedule,
  isToday,
  colorOf,
  onOpen,
  onOpenTask,
  habits,
  habitsEditable,
  onToggleHabit,
  habitsAbove,
  onAdd,
}: Props & { onAdd: () => void }) {
  return (
    <div
      data-noswipe
      className="flex flex-none gap-1.5 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {schedule.length === 0 && habits.length === 0 && !habitsAbove && (
        <span className="flex h-[3.125rem] flex-none items-center pr-1.5 text-[0.84375rem] leading-none text-ink-600">
          Nothing scheduled
        </span>
      )}
      {slots(schedule, habits).map((slot) => {
        if (slot.kind === "task") {
          const t = slot.item;
          const hot = slot.phase === "now" || slot.phase === "next";
          const label = phaseLabel(slot.phase);
          const duration = durationText(t);
          return (
            <button
              key={`task:${t.id}`}
              type="button"
              disabled={!canOpenBlock(t)}
              onClick={() => onOpenTask(t)}
              className={`flex h-[3.125rem] flex-none flex-col justify-center gap-1.5 rounded-[0.625rem] border border-dashed px-3 text-left disabled:cursor-default ${
                hot ? "border-steel/70 bg-steel/8" : t.done ? "border-white/10" : "border-white/22"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <BlockMark color={t.tags[0]?.color} size={6} />
                <span
                  className={`font-mono text-[0.65625rem] font-semibold leading-none ${
                    hot ? "text-steel" : t.done ? "text-ink-700" : "text-ink-400"
                  }`}
                >
                  {formatClock(t.startMin)}
                  {label ? ` · ${label}` : duration && ` · ${duration}`}
                </span>
              </span>
              <span
                className={`whitespace-nowrap text-[0.8125rem] font-medium leading-none ${
                  t.done ? "text-ink-600 line-through" : hot ? "text-ink-100" : "text-ink-200"
                }`}
              >
                {t.title}
              </span>
            </button>
          );
        }
        if (slot.kind === "habit") {
          const h = slot.habit;
          const duration = durationText(h);
          return (
            <button
              key={`habit:${h.id}`}
              type="button"
              role="checkbox"
              aria-checked={h.done}
              disabled={!habitsEditable}
              onClick={() => onToggleHabit(h.id)}
              className={`flex h-[3.125rem] flex-none flex-col justify-center gap-1.5 rounded-[0.625rem] border px-3 text-left disabled:cursor-default ${
                h.done ? "border-sage/30" : "border-white/12"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <HabitBox done={h.done} />
                <span className="font-mono text-[0.65625rem] font-semibold leading-none text-ink-400">
                  {formatClock(h.startMin)}
                  {duration && ` · ${duration}`}
                </span>
              </span>
              <span
                className={`whitespace-nowrap text-[0.8125rem] font-medium leading-none ${
                  h.done ? "text-sage-soft" : "text-ink-200"
                }`}
              >
                {h.title}
              </span>
            </button>
          );
        }
        const e = slot.item;
        const phase = slot.phase;
        const hot = phase === "now" || phase === "next";
        const past = phase === "past";
        const label = phaseLabel(phase);
        const hasNotes = Boolean(e.notes?.trim());
        const card = hot
          ? "border-steel/55 bg-steel/8"
          : past
            ? "border-white/6"
            : "border-white/12";
        const timeColor = hot ? "text-steel" : past ? "text-ink-700" : "text-ink-400";
        const titleColor = hot
          ? "text-ink-100"
          : past
            ? `text-ink-600 ${isToday ? "line-through" : ""}`
            : "text-ink-200";
        const content = (
          <>
            <span className="flex items-center gap-1.5">
              {e.source === "user" ? (
                <SubjectDot color={colorOf(e.tagId)} />
              ) : (
                <span aria-hidden className="h-1.5 w-1.5 flex-none rounded-full border border-ink-500" />
              )}
              <span className={`font-mono text-[0.65625rem] font-semibold leading-none ${timeColor}`}>
                {e.startMin === null ? "All day" : formatClock(e.startMin)}
                {label && ` · ${label}`}
              </span>
              {hasNotes && <NotesMark className="ml-0.5" />}
            </span>
            <span className={`whitespace-nowrap text-[0.8125rem] font-medium leading-none ${titleColor}`}>
              {e.title}
            </span>
          </>
        );
        const className = `flex h-[3.125rem] flex-none flex-col justify-center gap-1.5 rounded-[0.625rem] border px-3 text-left ${card}`;
        return canOpen(e) ? (
          <button key={e.key} type="button" onClick={() => onOpen(e)} className={className}>
            {content}
          </button>
        ) : (
          <div key={e.key} className={className} title={e.source === "ics" ? "From your calendar feed" : undefined}>
            {content}
          </div>
        );
      })}
      <button
        type="button"
        onClick={onAdd}
        aria-label="Add event"
        className="flex h-[3.125rem] w-[3.125rem] flex-none items-center justify-center rounded-[0.625rem] border border-dashed border-sage/50 text-[1.5rem] font-light leading-none text-sage"
      >
        +
      </button>
    </div>
  );
}

export function EventList({
  schedule,
  isToday,
  colorOf,
  onOpen,
  onOpenTask,
  habits,
  habitsEditable,
  onToggleHabit,
  habitsAbove,
}: Props) {
  if (schedule.length === 0 && habits.length === 0) {
    if (habitsAbove) return null;
    return (
      <div className="flex min-h-11 items-center border-b border-white/6 text-[0.875rem] leading-none text-ink-400">
        Nothing scheduled
      </div>
    );
  }
  return (
    <div className="mb-2 flex flex-col">
      {slots(schedule, habits).map((slot) => {
        if (slot.kind === "task") {
          const t = slot.item;
          const hot = slot.phase === "now" || slot.phase === "next";
          const label = phaseLabel(slot.phase);
          const weight = hot ? "font-semibold" : "font-normal";
          return (
            <button
              key={`task:${t.id}`}
              type="button"
              disabled={!canOpenBlock(t)}
              onClick={() => onOpenTask(t)}
              className={`-mx-1.5 grid min-h-11 grid-cols-[3.25rem_0.5rem_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-1.5 text-left disabled:cursor-default ${
                hot
                  ? "border-b-2 border-steel bg-steel/8"
                  : "border-b border-dashed border-white/12 hover:bg-white/3"
              }`}
            >
              <span
                className={`font-mono text-[0.71875rem] leading-none ${weight} ${
                  hot ? "text-steel" : t.done ? "text-ink-700" : "text-ink-400"
                }`}
              >
                {formatClock(t.startMin)}
              </span>
              <BlockMark color={t.tags[0]?.color} size={7} />
              <span
                className={`truncate text-[0.90625rem] leading-[1.3] ${weight} ${
                  t.done ? "text-ink-600 line-through" : hot ? "text-ink-100" : "text-ink-200"
                }`}
              >
                {t.title}
              </span>
              <span
                className={`font-mono text-[0.59375rem] font-semibold leading-none tracking-[0.0625rem] ${
                  label ? "text-steel" : "text-ink-500"
                }`}
              >
                {label ?? durationText(t) ?? ""}
              </span>
            </button>
          );
        }
        if (slot.kind === "habit") {
          const h = slot.habit;
          const duration = durationText(h);
          return (
            <button
              key={`habit:${h.id}`}
              type="button"
              role="checkbox"
              aria-checked={h.done}
              disabled={!habitsEditable}
              onClick={() => onToggleHabit(h.id)}
              className="-mx-1.5 grid min-h-11 grid-cols-[3.25rem_0.5rem_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border-b border-white/8 px-1.5 text-left hover:bg-white/3 disabled:cursor-default disabled:hover:bg-transparent"
            >
              <span className="font-mono text-[0.71875rem] leading-none text-ink-400">
                {formatClock(h.startMin)}
              </span>
              <span className="-ml-0.5 flex">
                <HabitBox done={h.done} />
              </span>
              <span
                className={`truncate text-[0.90625rem] leading-[1.3] ${
                  h.done ? "text-sage-soft" : "text-ink-200"
                }`}
              >
                {h.title}
              </span>
              <span className="font-mono text-[0.59375rem] font-semibold leading-none tracking-[0.0625rem] text-ink-500">
                {duration ?? ""}
              </span>
            </button>
          );
        }
        const e = slot.item;
        const phase = slot.phase;
        const hot = phase === "now" || phase === "next";
        const past = phase === "past";
        const label = phaseLabel(phase);
        const hasNotes = Boolean(e.notes?.trim());
        const row = hot
          ? "border-b-2 border-steel bg-steel/8"
          : "border-b border-white/8 hover:bg-white/3";
        const timeColor = hot ? "text-steel" : past ? "text-ink-700" : "text-ink-400";
        const titleColor = hot
          ? "text-ink-100"
          : past
            ? `text-ink-600 ${isToday ? "line-through" : ""}`
            : "text-ink-200";
        const weight = hot ? "font-semibold" : "font-normal";
        const content = (
          <>
            <span className={`font-mono text-[0.71875rem] leading-none ${weight} ${timeColor}`}>
              {e.startMin === null ? "All day" : formatClock(e.startMin)}
            </span>
            {e.source === "user" ? (
              <SubjectDot color={colorOf(e.tagId)} size={7} />
            ) : (
              <span aria-hidden className="h-[0.4375rem] w-[0.4375rem] rounded-full border border-ink-500" />
            )}
            <span className={`flex min-w-0 items-center gap-2 text-[0.90625rem] leading-[1.3] ${weight} ${titleColor}`}>
              <span className="truncate">{e.title}</span>
              {hasNotes && <NotesMark />}
            </span>
            <span className="font-mono text-[0.59375rem] font-semibold leading-none tracking-[0.0625rem] text-steel">
              {label ?? ""}
            </span>
          </>
        );
        const className = `-mx-1.5 grid min-h-11 grid-cols-[3.25rem_0.5rem_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-1.5 text-left ${row}`;
        return canOpen(e) ? (
          <button key={e.key} type="button" onClick={() => onOpen(e)} className={className}>
            {content}
          </button>
        ) : (
          <div key={e.key} className={className} title={e.source === "ics" ? "From your calendar feed" : undefined}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
