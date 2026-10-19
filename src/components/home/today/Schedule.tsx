"use client";

import { formatClock, type EventPhase } from "@/lib/agenda-today";

import { CheckGlyph, NotesMark, SubjectDot } from "./atoms";
import type { DayEvent, HabitView } from "./useTodayAgenda";

/**
 * The day's schedule. Phone: a strip of event cards you swipe through, the
 * one on now (or next) outlined in blue, ending in a dashed + card. Tablet
 * and desktop have the height for a ruled list instead.
 *
 * Feed (ICS) events are printed but not editable, so they don't open the
 * item panel.
 *
 * Habits with a start time sit in the schedule at that time, ticked off in
 * place (the untimed ones are the HabitsRow above it). They take no part in
 * NOW/NEXT — that stays about events.
 */

type Props = {
  events: DayEvent[];
  phases: EventPhase[];
  /** Past and done-for-today events are struck through only on today. */
  isToday: boolean;
  colorOf: (tagId: string | null) => string | null;
  onOpen: (event: DayEvent) => void;
  /** Timed habits only. */
  habits: HabitView[];
  /** Habits tick off on today only. */
  habitsEditable: boolean;
  onToggleHabit: (id: string) => void;
};

type Slot =
  | { kind: "event"; event: DayEvent; phase: EventPhase }
  | { kind: "habit"; habit: HabitView };

/** Events and timed habits in one run by start time; all-day events last. */
function slots(events: DayEvent[], phases: EventPhase[], habits: HabitView[]): Slot[] {
  const start = (s: Slot) =>
    (s.kind === "event" ? s.event.startMin : s.habit.startMin) ??
    Number.POSITIVE_INFINITY;
  const all: Slot[] = [
    ...events.map((event, i) => ({ kind: "event" as const, event, phase: phases[i] })),
    ...habits.map((habit) => ({ kind: "habit" as const, habit })),
  ];
  // Stable: on a tie the event (already in sortEvents order) stays first.
  return all.sort((a, b) => {
    const sa = start(a);
    const sb = start(b);
    return sa === sb ? 0 : sa - sb;
  });
}

/** "30m", "1h", "1h 15m". */
function durationText(h: HabitView): string | null {
  if (h.startMin === null || h.endMin === null) return null;
  const mins = h.endMin - h.startMin;
  if (mins <= 0) return null;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
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
  events,
  phases,
  isToday,
  colorOf,
  onOpen,
  habits,
  habitsEditable,
  onToggleHabit,
  onAdd,
}: Props & { onAdd: () => void }) {
  return (
    <div
      data-noswipe
      className="flex flex-none gap-1.5 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {events.length === 0 && habits.length === 0 && (
        <span className="flex h-[3.125rem] flex-none items-center pr-1.5 text-[0.84375rem] leading-none text-ink-600">
          Nothing scheduled
        </span>
      )}
      {slots(events, phases, habits).map((slot) => {
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
        const e = slot.event;
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
  events,
  phases,
  isToday,
  colorOf,
  onOpen,
  habits,
  habitsEditable,
  onToggleHabit,
}: Props) {
  if (events.length === 0 && habits.length === 0) {
    return (
      <div className="flex min-h-11 items-center border-b border-white/6 text-[0.875rem] leading-none text-ink-400">
        Nothing scheduled
      </div>
    );
  }
  return (
    <div className="mb-2 flex flex-col">
      {slots(events, phases, habits).map((slot) => {
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
        const e = slot.event;
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
