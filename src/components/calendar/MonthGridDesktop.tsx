"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";

import type { CalendarRangeTask } from "@/app/app/calendar/actions";
import { monthCells } from "@/lib/calendar-grid";
import { spanSegmentsForDay, type EventSpan } from "@/lib/event-spans";
import type { RangeCalendarEvent } from "@/server/calendar";
import type { UserEvent } from "@/server/events";

import {
  ICS_COLOR,
  OWN_EVENT_COLOR,
  TASK_DRAG_TYPE,
  icsSpanKey,
  icsTimedKey,
  isoToLocalMin,
  isSpanned,
  minutesToHHMM,
  tintStyle,
  userSpanKey,
  type CalendarSelection,
} from "./calendar-items";
import { formatTimeShort } from "@/lib/recurrence";

/**
 * Month view of the desktop/tablet Calendar: the month grid the page always
 * had, restyled to the docked layout — flush cells with hairline borders,
 * subject-colored chips, multi-day span bars bled across cells. Clicking a
 * chip selects it (EVENT sidebar); the day number opens Day view; the rest
 * of a cell keeps its old job (opens that day's home page). Cells accept
 * dropped/armed tasks (sets the due day).
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_ROWS = 4;

interface CellItem {
  key: string;
  sort: number;
  title: string;
  time: string | null;
  color: string;
  kind: "event" | "ics" | "task";
  completed?: boolean;
  select: CalendarSelection;
}

export function MonthGridDesktop({
  anchor,
  today,
  events,
  ics,
  tasks,
  noteDays,
  colorOf,
  selectedKey,
  armed,
  onSelect,
  onPlace,
  onOpenDay,
}: {
  anchor: string;
  today: string | null;
  events: UserEvent[];
  ics: RangeCalendarEvent[];
  tasks: CalendarRangeTask[];
  noteDays: Set<string>;
  colorOf: (tagId: string | null) => string | null;
  selectedKey: string | null;
  armed: boolean;
  onSelect: (sel: CalendarSelection) => void;
  onPlace: (taskId: string | null, date: string) => void;
  onOpenDay: (date: string) => void;
}) {
  const router = useRouter();
  const [dropDay, setDropDay] = useState<string | null>(null);
  const cells = monthCells(anchor);

  // Spans (one bar per multi-day event) + their selection targets.
  const spanSel = new Map<
    string,
    { color: string; select: CalendarSelection }
  >();
  const spans: EventSpan[] = [];
  for (const e of events) {
    if (!isSpanned(e)) continue;
    const key = userSpanKey(e);
    spans.push({
      key,
      title: e.title,
      start: e.localDate,
      end: e.endLocalDate!,
    });
    spanSel.set(key, {
      color: colorOf(e.tagId) ?? OWN_EVENT_COLOR,
      select: { kind: "event", id: e.id, snapshot: e },
    });
  }
  for (const e of ics) {
    if (!isSpanned(e)) continue;
    const key = icsSpanKey(e);
    if (spanSel.has(key)) continue;
    spans.push({ key, title: e.title, start: e.spanStart, end: e.spanEnd });
    spanSel.set(key, {
      color: ICS_COLOR,
      select: { kind: "ics", key, event: e },
    });
  }

  const itemsByDay = new Map<string, CellItem[]>();
  const add = (d: string, it: CellItem) => {
    const list = itemsByDay.get(d);
    if (list) list.push(it);
    else itemsByDay.set(d, [it]);
  };
  for (const e of events) {
    if (isSpanned(e)) continue;
    add(e.localDate, {
      key: `u:${e.id}`,
      sort: e.startMin ?? -1,
      title: e.title,
      time:
        e.startMin !== null ? formatTimeShort(minutesToHHMM(e.startMin)) : null,
      color: colorOf(e.tagId) ?? OWN_EVENT_COLOR,
      kind: "event",
      select: { kind: "event", id: e.id, snapshot: e },
    });
  }
  for (const e of ics) {
    if (isSpanned(e)) continue;
    const timed = !e.allDay && e.startIso;
    const key = timed ? icsTimedKey(e) : icsSpanKey(e);
    add(e.date, {
      key,
      sort: timed ? isoToLocalMin(e.startIso!) : -2,
      title: e.title,
      time: timed
        ? formatTimeShort(minutesToHHMM(isoToLocalMin(e.startIso!)))
        : null,
      color: ICS_COLOR,
      kind: "ics",
      select: { kind: "ics", key, event: e },
    });
  }
  for (const t of tasks) {
    add(t.due, {
      key: `t:${t.id}`,
      sort: t.remindAt ? 2000 : 3000,
      title: t.title,
      time: t.remindAt ? formatTimeShort(t.remindAt) : null,
      color: "var(--sage)",
      kind: "task",
      completed: t.completed,
      select: { kind: "task", id: t.id, snapshot: t },
    });
  }

  const rows = cells.length / 7;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid flex-none grid-cols-7 border-b border-white/6">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="border-l border-white/6 px-2.5 py-2 text-[0.75rem] font-medium text-ink-500 first:border-l-0"
          >
            {d}
          </div>
        ))}
      </div>
      <div
        className="grid min-h-0 flex-1 grid-cols-7 overflow-y-auto"
        style={{ gridTemplateRows: `repeat(${rows}, minmax(6.5rem, 1fr))` }}
      >
        {cells.map((d, i) => {
          const first = i % 7 === 0;
          if (d === null) {
            return (
              <div
                key={`pad-${i}`}
                className={`border-b border-white/6 bg-white/[0.012] ${first ? "" : "border-l"}`}
              />
            );
          }
          const isToday = d === today;
          const isPast = today !== null && d < today;
          const segs = spanSegmentsForDay(spans, d, first);
          const items = (itemsByDay.get(d) ?? []).sort(
            (a, b) => a.sort - b.sort,
          );
          const room = Math.max(1, MAX_ROWS - Math.min(segs.length, 2));
          const shown = items.slice(0, room);
          const hidden =
            items.length - shown.length + Math.max(0, segs.length - 2);
          const dayNum = Number(d.slice(8));
          return (
            <div
              key={d}
              data-day-cell={d}
              role="button"
              tabIndex={-1}
              title="Open day"
              onClick={(e) => {
                if (e.target !== e.currentTarget) return;
                if (armed) onPlace(null, d);
                else router.push(isToday ? "/app" : `/app?d=${d}`);
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(TASK_DRAG_TYPE)) return;
                e.preventDefault();
                setDropDay(d);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                  setDropDay(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDropDay(null);
                onPlace(e.dataTransfer.getData(TASK_DRAG_TYPE) || null, d);
              }}
              className={`flex min-h-0 min-w-0 cursor-pointer flex-col gap-0.5 overflow-hidden border-b border-white/6 px-1.5 pt-1 pb-1.5 transition-colors ${
                first ? "" : "border-l"
              } ${isToday ? "bg-white/[0.03]" : "hover:bg-white/[0.02]"} ${
                dropDay === d ? "bg-sage/10" : ""
              } ${armed ? "cursor-copy" : ""}`}
            >
              <div className="pointer-events-none flex flex-none items-center gap-1">
                <button
                  type="button"
                  onClick={() => (armed ? onPlace(null, d) : onOpenDay(d))}
                  aria-label={`Open ${d} in Day view`}
                  className={`pointer-events-auto flex h-6 min-w-6 items-center justify-center rounded-full px-1 font-mono text-[0.75rem] focus-visible:outline-2 focus-visible:outline-sage/70 touch:h-9 touch:min-w-9 ${
                    isToday
                      ? "bg-sage font-semibold text-sage-ink"
                      : isPast
                        ? "text-ink-500 hover:bg-white/6"
                        : "text-ink-250 hover:bg-white/6"
                  }`}
                >
                  {dayNum}
                </button>
                {noteDays.has(d) && (
                  <FileText
                    aria-label="Daily note exists"
                    className="ml-auto h-3 w-3 flex-none text-ink-600"
                  />
                )}
              </div>
              {segs.slice(0, 2).map((s) => {
                const meta = spanSel.get(s.key);
                const color = meta?.color ?? OWN_EVENT_COLOR;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => meta && onSelect(meta.select)}
                    title={`${s.title} · ${s.start} – ${s.end}`}
                    className={`-mx-1.5 flex-none truncate px-1.5 text-left text-[0.6875rem] leading-[1.125rem] font-medium text-ink-100 focus-visible:outline-2 focus-visible:outline-sage/70 ${
                      s.isStart ? "ml-0 rounded-l-[0.3125rem] border-l-2" : ""
                    } ${s.isEnd ? "mr-0 rounded-r-[0.3125rem]" : ""}`}
                    style={tintStyle(
                      color,
                      selectedKey === s.key ? "selected" : "rest",
                    )}
                  >
                    {s.showLabel ? s.title : " "}
                  </button>
                );
              })}
              {shown.map((it) => (
                <button
                  key={it.key}
                  type="button"
                  draggable={it.kind === "task"}
                  onDragStart={
                    it.kind === "task"
                      ? (e) => {
                          e.dataTransfer.setData(
                            TASK_DRAG_TYPE,
                            it.key.slice(2),
                          );
                          e.dataTransfer.effectAllowed = "move";
                        }
                      : undefined
                  }
                  onClick={() => onSelect(it.select)}
                  title={it.title}
                  className={`flex min-w-0 flex-none items-center gap-1 rounded-[0.25rem] px-1 text-left text-[0.71875rem] leading-[1.125rem] focus-visible:outline-2 focus-visible:outline-sage/70 ${
                    it.kind === "task" ? "border border-dashed" : "border-l-2"
                  }`}
                  style={
                    it.kind === "task"
                      ? {
                          borderColor: `color-mix(in srgb, var(--sage) 40%, transparent)`,
                          backgroundColor:
                            selectedKey === it.key
                              ? "color-mix(in srgb, var(--sage) 16%, transparent)"
                              : undefined,
                        }
                      : tintStyle(
                          it.color,
                          selectedKey === it.key ? "selected" : "rest",
                        )
                  }
                >
                  {it.kind === "task" && (
                    <span
                      aria-hidden
                      className={`h-2 w-2 flex-none rounded-[0.125rem] border ${
                        it.completed ? "border-sage bg-sage" : "border-ink-400"
                      }`}
                    />
                  )}
                  {it.time && (
                    <span className="flex-none font-mono text-[0.625rem] text-ink-400">
                      {it.time}
                    </span>
                  )}
                  <span
                    className={`min-w-0 truncate ${
                      it.completed
                        ? "text-ink-500 line-through"
                        : "text-ink-200"
                    }`}
                  >
                    {it.title}
                  </span>
                </button>
              ))}
              {hidden > 0 && (
                <button
                  type="button"
                  onClick={() => onOpenDay(d)}
                  className="self-start rounded px-1 text-[0.6875rem] text-ink-500 hover:bg-white/6 hover:text-ink-300 focus-visible:outline-2 focus-visible:outline-sage/70"
                >
                  +{hidden} more
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
