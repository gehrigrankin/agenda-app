"use client";

import { DOW_SHORT, dayOfMonth, formatClock } from "@/lib/agenda-today";
import { formatWeekRange, isoWeekNumber } from "@/lib/dates";

import { NotesMark, PageArrow } from "./atoms";
import { DayTab, dayDot } from "./DayTabs";
import type { DayView } from "./useTodayAgenda";

/**
 * The week on tablet/desktop: a scrolling panel beside the day, or folded to
 * a strip of date tabs. (The phone's week screen is the spread —
 * WeekSpread.tsx — which borrows `WeekTitle` from here.)
 */

export type WeekDay = {
  date: string;
  view: DayView | null;
  /** First line(s) of the day's note, plain text; "" when none. */
  noteText: string;
};

export function WeekTitle({
  weekStart,
  onPrev,
  onNext,
  wide,
}: {
  weekStart: string;
  onPrev: () => void;
  onNext: () => void;
  wide: boolean;
}) {
  return (
    <div
      className={`flex flex-none items-center ${
        wide ? "h-[4.25rem] gap-0.5 px-1.5" : "gap-1 px-2 pb-2"
      }`}
    >
      <PageArrow dir="prev" onClick={onPrev} label="Previous week" large={!wide} />
      <div
        className={`flex flex-1 justify-center ${
          wide ? "flex-col items-center gap-1.5" : "items-baseline gap-2"
        }`}
      >
        <span
          className={`font-semibold leading-none text-ink-100 ${
            wide ? "text-[0.9375rem]" : "text-[1.0625rem]"
          }`}
        >
          Week {isoWeekNumber(weekStart)}
        </span>
        <span
          className={`font-mono font-medium uppercase leading-none tracking-[0.075rem] text-ink-500 ${
            wide ? "text-[0.625rem]" : "text-[0.65625rem]"
          }`}
        >
          {formatWeekRange(weekStart)}
        </span>
      </div>
      <PageArrow dir="next" onClick={onNext} label="Next week" large={!wide} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tablet/desktop week panel
// ---------------------------------------------------------------------------

type Line = { key: string; label: string; labelTone: string; text: string; textTone: string };

function panelLines(view: DayView | null): Line[] {
  if (!view) return [];
  const lines: Line[] = [];
  view.events.forEach((e, i) => {
    const phase = view.phases[i];
    const struck = phase === "past" && view.rel === "today";
    lines.push({
      key: e.key,
      label: e.startMin === null ? "—" : formatClock(e.startMin),
      labelTone:
        phase === "now" || phase === "next"
          ? "text-steel"
          : view.rel === "past"
            ? "text-ink-700"
            : "text-ink-400",
      text: e.title,
      textTone: `${view.rel === "past" ? "text-ink-500" : "text-ink-300"} ${struck ? "line-through" : ""}`,
    });
  });
  for (const t of view.tasks) {
    const label = t.done ? "DONE" : t.late ? "LATE" : t.carried ? "MOVED" : "DUE";
    lines.push({
      key: t.id,
      label,
      labelTone:
        label === "DONE" ? "text-ink-700" : label === "DUE" ? "text-steel" : "text-overdue",
      text: t.title,
      textTone: t.done ? "text-ink-600 line-through" : "text-ink-300",
    });
  }
  return lines;
}

export function WeekPanel({
  weekStart,
  days,
  today,
  selected,
  onPrevWeek,
  onNextWeek,
  onSelect,
}: {
  weekStart: string;
  days: WeekDay[];
  today: string;
  selected: string;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onSelect: (date: string) => void;
}) {
  return (
    <aside
      aria-label="Week"
      className="flex w-[18.25rem] flex-none flex-col border-r border-white/7 bg-bar"
    >
      <WeekTitle weekStart={weekStart} onPrev={onPrevWeek} onNext={onNextWeek} wide />
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2.5 pb-3.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {days.map((d, i) => {
          const isSel = d.date === selected;
          const isToday = d.date === today;
          const past = d.date < today;
          const all = panelLines(d.view);
          const shown = all.length > 4 ? all.slice(0, 3) : all;
          const card = isSel
            ? isToday
              ? "border-[1.5px] border-sage bg-sage/7"
              : "border-[1.5px] border-ink-100/55 bg-white/5"
            : isToday
              ? "border border-sage/45"
              : "border border-white/6 hover:bg-white/2";
          return (
            <button
              key={d.date}
              type="button"
              onClick={() => onSelect(d.date)}
              aria-pressed={isSel}
              className={`grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2.5 rounded-xl py-2.5 pl-1.5 pr-2.5 text-left ${card}`}
            >
              <span className="flex flex-col items-center gap-[0.3125rem]">
                <span
                  className={`font-mono text-[0.59375rem] font-semibold leading-none ${
                    isToday ? "text-sage" : past ? "text-ink-700" : "text-ink-500"
                  }`}
                >
                  {DOW_SHORT[i]}
                </span>
                <span
                  className={`flex h-[1.875rem] min-w-[1.875rem] items-center justify-center rounded-lg px-1 text-base font-semibold leading-none ${
                    isToday
                      ? "bg-sage text-sage-ink"
                      : isSel
                        ? "bg-ink-100 text-sage-ink"
                        : past
                          ? "text-ink-600"
                          : "text-ink-200"
                  }`}
                >
                  {dayOfMonth(d.date)}
                </span>
              </span>
              <span className="flex min-w-0 flex-col justify-center gap-1.5 pt-px">
                {shown.map((l) => (
                  <span key={l.key} className="flex min-w-0 items-center gap-[0.4375rem]">
                    <span
                      className={`w-[2.125rem] flex-none font-mono text-[0.59375rem] font-semibold leading-none ${l.labelTone}`}
                    >
                      {l.label}
                    </span>
                    <span className={`min-w-0 truncate text-[0.78125rem] leading-[1.25] ${l.textTone}`}>
                      {l.text}
                    </span>
                  </span>
                ))}
                {all.length > 4 && (
                  <span className="pl-[2.5625rem] text-[0.71875rem] font-medium leading-none text-steel">
                    +{all.length - 3} more
                  </span>
                )}
                {all.length === 0 && (
                  <span className="text-[0.78125rem] leading-[1.25] text-ink-700">
                    {past ? "Nothing logged" : "Free"}
                  </span>
                )}
                {d.noteText.trim() && (
                  <span className="flex min-w-0 items-center gap-[0.4375rem] pt-0.5">
                    <span className="flex w-[2.125rem] flex-none">
                      <NotesMark />
                    </span>
                    <span className="min-w-0 truncate text-[0.75rem] leading-[1.25] text-ink-400">
                      {d.noteText.trim()}
                    </span>
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

/** The week panel folded down to a strip of date tabs. */
export function WeekStripFolded({
  days,
  today,
  selected,
  onSelect,
}: {
  days: WeekDay[];
  today: string;
  selected: string;
  onSelect: (date: string) => void;
}) {
  return (
    <aside
      aria-label="Week"
      className="flex w-[4.125rem] flex-none flex-col items-center gap-1 overflow-y-auto border-r border-white/7 bg-bar py-3.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {days.map((d, i) => (
        <DayTab
          key={d.date}
          date={d.date}
          today={today}
          index={i}
          selected={d.date === selected}
          dot={dayDot(d.view)}
          onSelect={() => onSelect(d.date)}
          narrow
        />
      ))}
    </aside>
  );
}
