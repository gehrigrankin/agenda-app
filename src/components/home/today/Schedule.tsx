"use client";

import { formatClock, type EventPhase } from "@/lib/agenda-today";

import { NotesMark, SubjectDot } from "./atoms";
import type { DayEvent } from "./useTodayAgenda";

/**
 * The day's schedule. Phone: a strip of event cards you swipe through, the
 * one on now (or next) outlined in blue, ending in a dashed + card. Tablet
 * and desktop have the height for a ruled list instead.
 *
 * Feed (ICS) events are printed but not editable, so they don't open the
 * item panel.
 */

type Props = {
  events: DayEvent[];
  phases: EventPhase[];
  /** Past and done-for-today events are struck through only on today. */
  isToday: boolean;
  colorOf: (tagId: string | null) => string | null;
  onOpen: (event: DayEvent) => void;
};

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
  onAdd,
}: Props & { onAdd: () => void }) {
  return (
    <div
      data-noswipe
      className="flex flex-none gap-1.5 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {events.length === 0 && (
        <span className="flex h-[3.125rem] flex-none items-center pr-1.5 text-[0.84375rem] leading-none text-ink-600">
          Nothing scheduled
        </span>
      )}
      {events.map((e, i) => {
        const phase = phases[i];
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

export function EventList({ events, phases, isToday, colorOf, onOpen }: Props) {
  if (events.length === 0) {
    return (
      <div className="flex min-h-11 items-center border-b border-white/6 text-[0.875rem] leading-none text-ink-400">
        Nothing scheduled
      </div>
    );
  }
  return (
    <div className="mb-2 flex flex-col">
      {events.map((e, i) => {
        const phase = phases[i];
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
