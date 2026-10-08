"use client";

import {
  DOW_SHORT,
  dayOfMonth,
  duePill,
  formatClock,
  plural,
  weekdayIndex,
} from "@/lib/agenda-today";
import { addDays, formatWeekRange, isoWeekNumber } from "@/lib/dates";

import { CheckGlyph, NotesMark, PageArrow, TaskCheckbox, DuePillView } from "./atoms";
import { DayTab, dayDot } from "./DayTabs";
import type { DayTask, DayView, HabitView } from "./useTodayAgenda";

/**
 * The week, two ways. Phone: its own screen (Day | Week), a card per day —
 * past days shrink to a line, today opens fully, later days show what's on
 * and what's due. Tablet/desktop: a scrolling panel beside the day, or folded
 * to a strip of date tabs.
 */

export type WeekDay = {
  date: string;
  view: DayView | null;
  /** First line(s) of the day's note, plain text; "" when none. */
  noteText: string;
};

function WeekTitle({
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
// Phone week
// ---------------------------------------------------------------------------

function carriedText(view: DayView, today: string): {
  text: string;
  open: boolean;
} | null {
  const carried = view.tasks.filter((t) => t.carried);
  if (carried.length === 0) return null;
  const open = carried.filter((t) => !t.done).length;
  if (open === 0) return { text: `${carried.length} carried · done`, open: false };
  const to =
    view.date === addDays(today, -1) ? "today" : DOW_SHORT[weekdayIndex(today)];
  return { text: `${open} carried to ${to}`, open: true };
}

export function PhoneWeek({
  weekStart,
  days,
  today,
  habits,
  limit,
  onPrevWeek,
  onNextWeek,
  onOpenDay,
  onToggleTask,
  onToggleHabit,
}: {
  weekStart: string;
  days: WeekDay[];
  today: string;
  habits: HabitView[];
  limit: number;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onOpenDay: (date: string) => void;
  onToggleTask: (id: string) => void;
  onToggleHabit: (id: string) => void;
}) {
  const weekdays = days.slice(0, 5);
  const weekend = days.slice(5);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WeekTitle weekStart={weekStart} onPrev={onPrevWeek} onNext={onNextWeek} wide={false} />
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {weekdays.map((d, i) => {
          const rel = d.view?.rel ?? (d.date < today ? "past" : d.date > today ? "future" : "today");
          if (rel === "today") {
            return (
              <TodayCard
                key={d.date}
                day={d}
                index={i}
                today={today}
                habits={habits}
                limit={limit}
                onOpen={() => onOpenDay(d.date)}
                onToggleTask={onToggleTask}
                onToggleHabit={onToggleHabit}
              />
            );
          }
          if (rel === "past") {
            const view = d.view;
            const done = view ? view.tasks.filter((t) => t.done && !t.carried).length : 0;
            const carried = view ? carriedText(view, today) : null;
            const doneText = done > 0 ? `${done} done` : carried ? "" : "Nothing logged";
            return (
              <button
                key={d.date}
                type="button"
                onClick={() => onOpenDay(d.date)}
                className="grid min-h-11 grid-cols-[3.125rem_1fr] rounded-xl border border-white/6 text-left"
              >
                <span className="flex flex-col items-center justify-center gap-[0.3125rem] border-r border-white/6">
                  <span className="font-mono text-[0.59375rem] font-medium leading-none text-ink-700">
                    {DOW_SHORT[i]}
                  </span>
                  <span className="text-[0.8125rem] font-semibold leading-none text-ink-600">
                    {dayOfMonth(d.date)}
                  </span>
                </span>
                <span className="flex items-center gap-1 px-3 text-[0.8125rem] leading-[1.3] text-ink-600">
                  {doneText}
                  {doneText && carried && " · "}
                  {carried && (
                    <span className={carried.open ? "text-overdue" : "text-ink-600"}>
                      {carried.text}
                    </span>
                  )}
                </span>
              </button>
            );
          }
          return <FutureCard key={d.date} day={d} index={i} onOpen={() => onOpenDay(d.date)} />;
        })}

        {/* Saturday and Sunday share a box, like the printed weekend. */}
        <div className="grid min-h-14 grid-cols-2 rounded-xl border border-white/9 bg-white/2">
          {weekend.map((d, j) => {
            const view = d.view;
            const events = view?.events.length ?? 0;
            const due = view?.tasks.length ?? 0;
            const parts = [
              events > 0 ? plural(events, "event") : null,
              due > 0 ? `${due} due` : null,
            ].filter(Boolean);
            return (
              <button
                key={d.date}
                type="button"
                onClick={() => onOpenDay(d.date)}
                className={`flex items-center gap-2 px-3.5 text-left ${
                  j === 0 ? "border-r border-white/7" : ""
                }`}
              >
                <span
                  className={`font-mono text-[0.59375rem] font-medium leading-none ${
                    d.date === today ? "text-sage" : "text-ink-500"
                  }`}
                >
                  {j === 0 ? "SAT" : "SUN"}
                </span>
                <span
                  className={`text-base font-semibold leading-none ${
                    d.date === today ? "text-sage" : "text-ink-350"
                  }`}
                >
                  {dayOfMonth(d.date)}
                </span>
                <span
                  className={`ml-auto truncate text-[0.75rem] leading-none ${
                    parts.length ? "text-ink-350" : "text-ink-700"
                  }`}
                >
                  {parts.length ? parts.join(" · ") : "—"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FutureCard({
  day,
  index,
  onOpen,
}: {
  day: WeekDay;
  index: number;
  onOpen: () => void;
}) {
  const events = day.view?.events ?? [];
  const dues = day.view?.tasks ?? [];
  const rest = Math.max(0, events.length - 2) + Math.max(0, dues.length - 2);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid min-h-14 grid-cols-[3.125rem_1fr] rounded-xl border border-white/9 bg-white/2 text-left"
    >
      <span className="flex flex-col items-center justify-center gap-[0.3125rem] border-r border-white/6">
        <span className="font-mono text-[0.59375rem] font-medium leading-none text-ink-500">
          {DOW_SHORT[index]}
        </span>
        <span className="text-base font-semibold leading-none text-ink-200">
          {dayOfMonth(day.date)}
        </span>
      </span>
      <span className="flex flex-col justify-center px-3 py-2">
        {events.slice(0, 2).map((e) => (
          <span key={e.key} className="flex min-h-7 items-center gap-2.5">
            <span className="w-[2.375rem] flex-none font-mono text-[0.65625rem] font-medium leading-none text-ink-400">
              {e.startMin === null ? "—" : formatClock(e.startMin)}
            </span>
            <span className="truncate text-[0.84375rem] leading-[1.3] text-ink-300">{e.title}</span>
          </span>
        ))}
        {dues.slice(0, 2).map((t) => (
          <span key={t.id} className="flex min-h-7 items-center gap-2.5">
            <span className="w-[2.375rem] flex-none font-mono text-[0.65625rem] font-medium leading-none text-steel">
              DUE
            </span>
            <span
              className={`truncate text-[0.84375rem] leading-[1.3] ${
                t.done ? "text-ink-600 line-through" : "text-ink-300"
              }`}
            >
              {t.title}
            </span>
          </span>
        ))}
        {events.length === 0 && dues.length === 0 && (
          <span className="text-[0.84375rem] leading-[1.3] text-ink-600">Free</span>
        )}
        {rest > 0 && (
          <span className="pl-12 text-[0.75rem] font-medium leading-[1.6] text-steel">
            +{rest} more
          </span>
        )}
      </span>
    </button>
  );
}

function TodayCard({
  day,
  index,
  today,
  habits,
  limit,
  onOpen,
  onToggleTask,
  onToggleHabit,
}: {
  day: WeekDay;
  index: number;
  today: string;
  habits: HabitView[];
  limit: number;
  onOpen: () => void;
  onToggleTask: (id: string) => void;
  onToggleHabit: (id: string) => void;
}) {
  const view = day.view;
  const preview = day.noteText.trim();
  return (
    <div className="grid grid-cols-[3.125rem_1fr] overflow-hidden rounded-xl border-[1.5px] border-sage/55 bg-sage/4">
      <button
        type="button"
        onClick={onOpen}
        className="flex flex-col items-center gap-1.5 bg-sage pt-3.5 text-sage-ink"
      >
        <span className="font-mono text-[0.59375rem] font-semibold leading-none">{DOW_SHORT[index]}</span>
        <span className="text-[1.375rem] font-bold leading-none">{dayOfMonth(day.date)}</span>
        <span className="mt-1 font-mono text-[0.5625rem] font-semibold leading-none">OPEN</span>
      </button>
      <div className="flex min-w-0 flex-col px-3">
        {habits.length > 0 && (
          <div className="flex h-10 items-center gap-3.5 overflow-hidden whitespace-nowrap border-b border-white/7">
            {habits.map((h) => (
              <button
                key={h.id}
                type="button"
                role="checkbox"
                aria-checked={h.done}
                onClick={() => onToggleHabit(h.id)}
                className="flex flex-none items-center gap-2"
              >
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded ${
                    h.done ? "bg-sage" : "border-[1.5px] border-solid border-ink-700"
                  }`}
                >
                  {h.done && <CheckGlyph size="sm" />}
                </span>
                <span
                  className={`text-[0.78125rem] font-medium leading-none ${
                    h.done ? "text-sage-soft" : "text-ink-350"
                  }`}
                >
                  {h.title}
                </span>
              </button>
            ))}
          </div>
        )}
        {view?.events.map((e, i) => {
          const phase = view.phases[i];
          const hot = phase === "now" || phase === "next";
          const past = phase === "past";
          return (
            <div
              key={e.key}
              className="flex h-[1.875rem] items-center gap-2.5 border-b border-white/5"
            >
              <span
                className={`w-[2.375rem] flex-none font-mono text-[0.6875rem] leading-none ${
                  hot ? "font-semibold text-steel" : past ? "text-ink-700" : "text-ink-400"
                }`}
              >
                {e.startMin === null ? "—" : formatClock(e.startMin)}
              </span>
              <span
                className={`min-w-0 flex-1 truncate text-[0.84375rem] leading-none ${
                  hot
                    ? "font-semibold text-ink-100"
                    : past
                      ? "text-ink-600 line-through"
                      : "text-ink-200"
                }`}
              >
                {e.title}
              </span>
              {hot && <span aria-hidden className="h-1.5 w-1.5 flex-none rounded-full bg-steel" />}
            </div>
          );
        })}
        {view?.tasks.slice(0, Math.min(4, limit)).map((t: DayTask) => (
          <div key={t.id} className="flex min-h-11 items-center gap-2">
            <TaskCheckbox
              checked={t.done}
              onToggle={() => onToggleTask(t.id)}
              label={t.title}
              disabled={t.id.startsWith("temp-")}
            />
            <span
              className={`min-w-0 flex-1 text-[0.84375rem] leading-[1.3] ${
                t.done ? "text-ink-600 line-through" : "text-ink-200"
              }`}
            >
              {t.title}
            </span>
            <span className="text-[0.59375rem]">
              <DuePillView
                pill={duePill(t.dueAt.slice(0, 10), day.date, today, t.carried)}
                done={t.done}
                wide={false}
              />
            </span>
          </div>
        ))}
        <div className="flex flex-col gap-1.5 pb-3 pt-2.5">
          <p className="line-clamp-2 text-[0.84375rem] leading-[1.55] text-ink-300">
            {preview
              ? preview.length > 86
                ? `${preview.slice(0, 86).trimEnd()}…`
                : preview
              : "No note yet."}
          </p>
          <button
            type="button"
            onClick={onOpen}
            className="flex items-center gap-1.5 self-start text-[0.75rem] font-medium leading-none text-sage"
          >
            Open today
            <span aria-hidden className="block h-1.5 w-1.5 rotate-45 border-r-[1.5px] border-t-[1.5px] border-sage" />
          </button>
        </div>
      </div>
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
