"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type TouchEvent,
} from "react";
import Link from "next/link";
import {
  CalendarPlus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Check,
  FileText,
  LayoutGrid,
  Plus,
  X,
} from "lucide-react";

import {
  listTagsAction,
  listTasksUnscheduledAction,
  toggleTaskAction,
  type TagWithCountResult,
  type UnscheduledTaskResult,
} from "@/app/app/actions";
import {
  deleteEventAction,
  getCalendarRangeDataAction,
  listIcsEventsForRangeAction,
  updateEventAction,
  type CalendarRangeData,
  type CalendarRangeTask,
} from "@/app/app/calendar/actions";
import { scheduleTaskAction } from "@/app/app/calendar/task-actions";
import { BottomSheet } from "@/components/layout/BottomSheet";
import {
  monthBounds,
  monthCells,
  minToHHMM,
  stepAnchor,
  sundayOf,
} from "@/lib/calendar-grid";
import {
  addDays,
  formatLongDate,
  localDateString,
  parseLocalDate,
} from "@/lib/dates";
import { loadCachedThenRefresh, viewCacheKey } from "@/lib/indexeddb-cache";
import type { RangeCalendarEvent } from "@/server/calendar";

import {
  ICS_COLOR,
  OWN_EVENT_COLOR,
  type CalendarSelection,
} from "./calendar-items";
import {
  EventDetails,
  eventSidebarLabel,
  type EventPatchInput,
} from "./EventDetails";
import { PhoneMonthView } from "./PhoneMonthView";
import { PhonePlanRail } from "./PhonePlanRail";
import {
  buildDayItems,
  clockLabel,
  isHappeningNow,
  markedDays,
  nowDividerIndex,
  type PhoneItem,
} from "./phone-items";
import { QuickAddEvent } from "./QuickAddEvent";

/**
 * Phone Calendar (<md; Notes Sidebars design 6j): a day agenda under a
 * swipeable week strip.
 *
 *   [October ⌄            Today ‹ › +]
 *   [ S  M  T  W  T  F  S ]  week strip — swipe / ‹ › to page weeks
 *   FRIDAY · OCT 9 · 4 EVENTS
 *   all-day + untimed due tasks, then timed rows (start/end in mono, a
 *   subject color bar, a NOW divider on today)
 *   [ N unscheduled tasks — tap to place ]
 *
 * - Month name → a sheet with a mini month (jump to a day) and a link to the
 *   full month grid (the old phone Month view, PhoneMonthView).
 * - + → the quick-add composer for the selected day, in a sheet.
 * - A row opens its details in a sheet (the same EventDetails the desktop's
 *   right sidebar uses).
 * - Unscheduled tasks: tap the bar → pick a task → pick a day and a time (or
 *   "No time"); scheduleTaskAction is the same call the desktop's drag/arm
 *   flows make.
 * - Swiping the strip pages weeks, swiping the agenda pages days. Touches
 *   that begin at the very left edge are left to the nav drawer.
 *
 * Data: one 3-week window (previous, current, next week) so paging a week is
 * instant; own rows and the ICS feed load separately like CalendarDesktop,
 * through the same IndexedDB warm-cache keys.
 */

const LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const EDGE_GUARD = 28;
const ICON_BTN =
  "flex h-11 w-11 flex-none items-center justify-center rounded-full text-ink-300 transition-colors active:bg-white/8 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-sage/70";

/** Horizontal swipe → callbacks. Ignores vertical scrolls and edge starts. */
function useSwipe(onLeft: () => void, onRight: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const left = useRef(onLeft);
  const right = useRef(onRight);
  left.current = onLeft;
  right.current = onRight;
  return {
    onTouchStart: (e: TouchEvent) => {
      const t = e.touches[0];
      start.current =
        e.touches.length === 1 && t && t.clientX > EDGE_GUARD
          ? { x: t.clientX, y: t.clientY }
          : null;
    },
    onTouchEnd: (e: TouchEvent) => {
      const s = start.current;
      start.current = null;
      const t = e.changedTouches[0];
      if (!s || !t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      if (dx < 0) left.current();
      else right.current();
    },
  };
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function PhoneCalendar({
  cacheScope,
  active,
}: {
  cacheScope: string;
  /** False on md+: the tree still renders (hidden) but loads nothing. */
  active: boolean;
}) {
  // Client-local today + the current minute (for the NOW divider).
  const [today, setToday] = useState<string | null>(null);
  const [nowMin, setNowMin] = useState(0);
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setToday(localDateString(now));
      setNowMin(now.getHours() * 60 + now.getMinutes());
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (today && !selected) setSelected(today);
  }, [today, selected]);

  const [screen, setScreen] = useState<"day" | "month">("day");
  const [monthSheet, setMonthSheet] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [unschedOpen, setUnschedOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [selection, setSelection] = useState<CalendarSelection | null>(null);

  // --- Data ------------------------------------------------------------------

  const weekStart = selected ? sundayOf(selected) : null;
  const winStart = weekStart ? addDays(weekStart, -7) : null;
  const winEnd = weekStart ? addDays(weekStart, 13) : null;
  const winKey = winStart && winEnd ? `${winStart}:${winEnd}` : null;

  const [local, setLocal] = useState<{
    start: string;
    end: string;
    data: CalendarRangeData;
  } | null>(null);
  const [ics, setIcs] = useState<{
    start: string;
    end: string;
    events: RangeCalendarEvent[];
    configured: boolean;
  } | null>(null);
  const [version, setVersion] = useState(0);
  const refetch = useCallback(() => setVersion((v) => v + 1), []);
  const localRef = useRef(local);
  localRef.current = local;

  useEffect(() => {
    if (!active || !winStart || !winEnd || !winKey) return;
    let cancelled = false;
    void loadCachedThenRefresh({
      key: viewCacheKey(cacheScope, "calendar-local", winKey),
      refresh: () => getCalendarRangeDataAction(winStart, winEnd),
      onValue: (data, source) => {
        // A warm-cache paint after our own edit would flash the old rows.
        const cur = localRef.current;
        if (source === "cache" && cur?.start === winStart) return;
        setLocal({ start: winStart, end: winEnd, data });
      },
      onError: (err) => console.error("[calendar] phone load failed:", err),
      cancelled: () => cancelled,
    });
    return () => {
      cancelled = true;
    };
  }, [active, winStart, winEnd, winKey, cacheScope, version]);

  useEffect(() => {
    if (!active || !winStart || !winEnd || !winKey) return;
    let cancelled = false;
    void loadCachedThenRefresh({
      key: viewCacheKey(cacheScope, "calendar-ics", winKey),
      refresh: () => listIcsEventsForRangeAction(winStart, winEnd),
      onValue: (r) => setIcs({ start: winStart, end: winEnd, ...r }),
      onError: (err) => console.error("[calendar] phone ICS failed:", err),
      cancelled: () => cancelled,
    });
    return () => {
      cancelled = true;
    };
  }, [active, winStart, winEnd, winKey, cacheScope]);

  const [unscheduled, setUnscheduled] = useState<
    UnscheduledTaskResult[] | null
  >(null);
  const [tags, setTags] = useState<TagWithCountResult[]>([]);
  const loadUnscheduled = useCallback(() => {
    listTasksUnscheduledAction()
      .then(setUnscheduled)
      .catch((err) => {
        console.error("[calendar] unscheduled load failed:", err);
        setUnscheduled((u) => u ?? []);
      });
  }, []);
  useEffect(() => {
    if (!active) return;
    loadUnscheduled();
    listTagsAction()
      .then(setTags)
      .catch((err) => console.error("[calendar] tags load failed:", err));
  }, [active, loadUnscheduled]);

  // The loaded window must cover the whole shown week, else it's still the
  // previous window's rows (fine for a day that's inside it, a skeleton else).
  const covers = (w: { start: string; end: string } | null) =>
    !!w &&
    !!weekStart &&
    w.start <= weekStart &&
    w.end >= addDays(weekStart, 6);
  const data = covers(local) ? local!.data : null;
  const feed = covers(ics) ? ics : null;
  const loading = !data;
  const icsConfigured = ics?.configured ?? false;

  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const colorOf = useCallback(
    (tagId: string | null) =>
      tagId ? (tagById.get(tagId)?.color ?? null) : null,
    [tagById],
  );

  const weekDays = useMemo(
    () =>
      weekStart
        ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
        : [],
    [weekStart],
  );
  const marks = useMemo(
    () =>
      markedDays(
        data?.events ?? [],
        feed?.events ?? [],
        data?.tasks ?? [],
        data?.notes ?? [],
      ),
    [data, feed],
  );

  const day = useMemo(
    () =>
      selected
        ? buildDayItems(
            selected,
            data?.events ?? [],
            feed?.events ?? [],
            data?.tasks ?? [],
          )
        : null,
    [selected, data, feed],
  );
  const note =
    selected && data ? data.notes.find((n) => n.date === selected) : undefined;

  // --- Details sheet ---------------------------------------------------------

  const liveSelection = useMemo<CalendarSelection | null>(() => {
    if (!selection || !data) return selection;
    if (selection.kind === "event") {
      const row = data.events.find((e) => e.id === selection.id);
      return row ? { ...selection, snapshot: row } : selection;
    }
    if (selection.kind === "task") {
      const row = data.tasks.find((t) => t.id === selection.id);
      return row ? { ...selection, snapshot: row } : selection;
    }
    return selection;
  }, [selection, data]);

  const openItem = (item: PhoneItem) => {
    const s = item.source;
    setSelection(
      s.kind === "event"
        ? { kind: "event", id: s.event.id, snapshot: s.event }
        : s.kind === "ics"
          ? { kind: "ics", key: s.key, event: s.event }
          : { kind: "task", id: s.task.id, snapshot: s.task },
    );
  };

  // --- Mutations (same shapes as CalendarDesktop) ------------------------------

  const patchLocal = (fn: (d: CalendarRangeData) => CalendarRangeData) =>
    setLocal((prev) => (prev ? { ...prev, data: fn(prev.data) } : prev));

  const patchEvent = (id: string, patch: EventPatchInput) => {
    patchLocal((d) => ({
      ...d,
      events: d.events.map((e) =>
        e.id !== id
          ? e
          : {
              ...e,
              ...(patch.title !== undefined && { title: patch.title }),
              ...(patch.localDate !== undefined && {
                localDate: patch.localDate,
              }),
              ...(patch.times && {
                startMin: patch.times.startMin,
                endMin: patch.times.endMin,
              }),
              ...(patch.tagId !== undefined && { tagId: patch.tagId }),
              ...(patch.notes !== undefined && { notes: patch.notes }),
            },
      ),
    }));
    updateEventAction(id, patch)
      .then((row) => {
        if (row) {
          patchLocal((d) => ({
            ...d,
            events: d.events.map((e) => (e.id === id ? row : e)),
          }));
          setSelection((s) =>
            s?.kind === "event" && s.id === id ? { ...s, snapshot: row } : s,
          );
        }
        if (patch.localDate !== undefined) refetch();
      })
      .catch((err) => {
        console.error("[calendar] update event failed:", err);
        refetch();
      });
  };

  const deleteEvent = (id: string) => {
    patchLocal((d) => ({ ...d, events: d.events.filter((e) => e.id !== id) }));
    setSelection(null);
    deleteEventAction(id).catch((err) => {
      console.error("[calendar] delete event failed:", err);
      refetch();
    });
  };

  const toggleTask = (id: string, completed: boolean) => {
    patchLocal((d) => ({
      ...d,
      tasks: d.tasks.map((t) => (t.id === id ? { ...t, completed } : t)),
    }));
    toggleTaskAction(id, completed).catch((err) => {
      console.error("[calendar] toggle task failed:", err);
      refetch();
    });
  };

  /** Due day (+ optional time) for a task; null date unschedules it. */
  const scheduleTask = (
    taskId: string,
    date: string | null,
    time: string | null,
  ) => {
    const fromUnscheduled = unscheduled?.find((t) => t.id === taskId);
    const fromRange = data?.tasks.find((t) => t.id === taskId);
    const title = fromUnscheduled?.title ?? fromRange?.title ?? "";
    const inRange =
      date !== null &&
      !!winStart &&
      !!winEnd &&
      date >= winStart &&
      date <= winEnd;

    setUnscheduled((u) => {
      if (!u) return u;
      const rest = u.filter((t) => t.id !== taskId);
      if (date === null && fromRange) {
        return [
          {
            id: fromRange.id,
            title: fromRange.title,
            createdAt: new Date().toISOString(),
            important: false,
            noteId: null,
            noteTitle: null,
            boardTitle: null,
            boardColor: null,
            tags: [],
          },
          ...rest,
        ];
      }
      return rest;
    });
    patchLocal((d) => {
      const others = d.tasks.filter((t) => t.id !== taskId);
      if (!inRange || date === null) return { ...d, tasks: others };
      const row: CalendarRangeTask = {
        id: taskId,
        title,
        due: date,
        completed: fromRange?.completed ?? false,
        remindAt: time,
      };
      return { ...d, tasks: [...others, row] };
    });
    setSelection((s) => {
      if (s?.kind !== "task" || s.id !== taskId) return s;
      if (date === null) return null;
      return { ...s, snapshot: { ...s.snapshot, due: date, remindAt: time } };
    });
    scheduleTaskAction(taskId, date, time)
      .then(() => {
        loadUnscheduled();
        refetch();
      })
      .catch((err) => {
        console.error("[calendar] schedule task failed:", err);
        loadUnscheduled();
        refetch();
      });
  };

  // --- Navigation --------------------------------------------------------------

  const go = (delta: number) => setSelected((s) => (s ? addDays(s, delta) : s));
  const goToday = () => today && setSelected(today);
  const stripSwipe = useSwipe(
    () => go(7),
    () => go(-7),
  );
  const agendaSwipe = useSwipe(
    () => go(1),
    () => go(-1),
  );

  if (screen === "month" && selected) {
    return (
      <PhoneMonthView
        cacheScope={cacheScope}
        today={today}
        selected={selected}
        onBack={() => setScreen("day")}
        onPick={(d) => {
          setSelected(d);
          setScreen("day");
        }}
      />
    );
  }

  const selDate = selected ? parseLocalDate(selected) : null;
  const monthLabel = selDate
    ? selDate.toLocaleDateString("en-US", {
        month: "long",
        ...(today && selected && selected.slice(0, 4) !== today.slice(0, 4)
          ? { year: "numeric" as const }
          : {}),
      })
    : "";
  const weekdayLabel = selDate
    ? selDate.toLocaleDateString("en-US", { weekday: "long" })
    : "";
  const dateLabel = selDate
    ? selDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "";
  const isToday = !!selected && selected === today;
  const unschedCount = unscheduled?.length ?? 0;
  const timed = day?.timed ?? [];
  const nowAt = isToday ? nowDividerIndex(timed, nowMin) : -1;
  const anyNow = isToday && timed.some((t) => isHappeningNow(t, nowMin));

  return (
    <div className="flex h-full min-h-0 flex-col md:hidden">
      {/* Header: month name → mini month sheet; paging; + new event. */}
      <header className="flex h-14 flex-none items-center gap-0.5 pr-2 pl-4">
        <button
          type="button"
          onClick={() => setMonthSheet(true)}
          disabled={!selected}
          aria-haspopup="dialog"
          aria-expanded={monthSheet}
          aria-label={`${monthLabel} — open month calendar`}
          className="-ml-1 flex min-h-11 min-w-0 items-center gap-1 rounded-lg px-1 text-left focus-visible:outline-2 focus-visible:outline-sage/70"
        >
          {selected ? (
            <>
              <h1 className="truncate text-[1.5rem] leading-none font-semibold text-ink-100">
                {monthLabel}
              </h1>
              <ChevronDown
                className="mt-0.5 h-5 w-5 flex-none text-ink-400"
                aria-hidden
              />
            </>
          ) : (
            <span className="h-6 w-28 animate-pulse rounded bg-white/6" />
          )}
        </button>
        <span className="min-w-0 flex-1" />
        {selected && !isToday && (
          <button
            type="button"
            onClick={goToday}
            className="flex h-11 flex-none items-center rounded-full px-3 text-[0.9375rem] font-medium text-sage focus-visible:outline-2 focus-visible:outline-sage/70"
          >
            Today
          </button>
        )}
        <button
          type="button"
          aria-label="Previous week"
          onClick={() => go(-7)}
          disabled={!selected}
          className={ICON_BTN}
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Next week"
          onClick={() => go(7)}
          disabled={!selected}
          className={ICON_BTN}
        >
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="New event"
          onClick={() => setAddOpen(true)}
          disabled={!selected || !today}
          className="flex h-11 w-11 flex-none items-center justify-center rounded-full text-sage transition-colors active:bg-sage/16 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-sage/70"
        >
          <Plus className="h-6 w-6" aria-hidden />
        </button>
      </header>

      {/* Week strip. */}
      <div
        {...stripSwipe}
        role="group"
        aria-label={weekStart ? `Week of ${formatLongDate(weekStart)}` : "Week"}
        className="grid flex-none touch-pan-y grid-cols-7 gap-0.5 border-b border-white/6 px-2 pb-2"
      >
        {weekDays.length === 0
          ? LETTERS.map((_, i) => (
              <div key={i} className="h-[4.25rem] animate-pulse rounded-xl" />
            ))
          : weekDays.map((d) => {
              const sel = d === selected;
              const isTod = d === today;
              const dt = parseLocalDate(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setSelected(d)}
                  aria-pressed={sel}
                  aria-current={isTod ? "date" : undefined}
                  aria-label={`${formatLongDate(d)}${
                    isTod ? ", today" : ""
                  }${marks.has(d) ? ", has items" : ""}`}
                  className={`flex min-h-[4.25rem] flex-col items-center justify-center gap-1 rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-sage/70 ${
                    sel ? "bg-sage text-sage-ink" : "text-ink-200"
                  }`}
                >
                  <span
                    className={`font-mono text-[0.6875rem] leading-none ${
                      sel ? "font-semibold" : "text-ink-500"
                    }`}
                  >
                    {LETTERS[dt.getDay()]}
                  </span>
                  <span
                    className={`text-[1.0625rem] leading-none tabular-nums ${
                      sel
                        ? "font-semibold"
                        : isTod
                          ? "font-semibold text-sage"
                          : "font-medium"
                    }`}
                  >
                    {dt.getDate()}
                  </span>
                  <span
                    aria-hidden
                    className={`h-1 w-1 rounded-full ${
                      marks.has(d)
                        ? sel
                          ? "bg-sage-ink"
                          : isTod
                            ? "bg-sage"
                            : "bg-ink-500"
                        : "bg-transparent"
                    }`}
                  />
                </button>
              );
            })}
      </div>

      {/* Day agenda. */}
      <div
        {...agendaSwipe}
        className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-y-contain"
      >
        <div key={selected ?? "none"} className="animate-overlay-fade-in pb-4">
          {selected && (
            <div
              className={`px-4 pt-3 pb-1.5 text-[0.6875rem] font-semibold tracking-[0.12em] uppercase ${
                isToday ? "text-sage" : "text-ink-500"
              }`}
            >
              {isToday && "Today · "}
              {weekdayLabel} · {dateLabel}
              {day && (
                <>
                  {" · "}
                  {plural(day.eventCount, "event")}
                  {day.taskCount > 0 && ` · ${plural(day.taskCount, "task")}`}
                </>
              )}
            </div>
          )}

          {loading || !day ? (
            <div className="flex flex-col gap-2 px-4 pt-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-14 animate-pulse rounded-xl bg-white/4"
                />
              ))}
            </div>
          ) : (
            <>
              {day.top.length === 0 && timed.length === 0 && (
                <p className="px-4 py-6 text-[0.9375rem] text-ink-500">
                  Nothing scheduled
                  {isToday ? " today" : ""}. Tap + to add an event.
                </p>
              )}
              <ul className="list-none">
                {day.top.map((item) => (
                  <AgendaRow
                    key={item.key}
                    item={item}
                    color={rowColor(item, colorOf)}
                    subject={subjectName(item, tagById)}
                    nowMin={nowMin}
                    isToday={false}
                    onOpen={() => openItem(item)}
                    onToggle={toggleTask}
                  />
                ))}
                {timed.map((item, i) => (
                  <AgendaRowWithDivider
                    key={item.key}
                    showDivider={!anyNow && nowAt === i}
                    nowMin={nowMin}
                  >
                    <AgendaRow
                      item={item}
                      color={rowColor(item, colorOf)}
                      subject={subjectName(item, tagById)}
                      nowMin={nowMin}
                      isToday={isToday}
                      onOpen={() => openItem(item)}
                      onToggle={toggleTask}
                    />
                  </AgendaRowWithDivider>
                ))}
                {!anyNow &&
                  isToday &&
                  nowAt === timed.length &&
                  timed.length > 0 && <NowDivider nowMin={nowMin} />}
              </ul>

              {/* Daily note, the day's home page, and the old "Plan the day". */}
              <div className="mt-2 flex flex-col px-4">
                {note && (
                  <Link
                    href={`/app/notes/${note.id}`}
                    className="flex min-h-11 items-center gap-2.5 border-t border-white/6 py-2 text-[0.9375rem] text-ink-200 focus-visible:outline-2 focus-visible:outline-sage/70"
                  >
                    <FileText
                      className="h-4 w-4 flex-none text-steel"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {note.title || "Daily note"}
                    </span>
                    <span className="text-[0.75rem] text-ink-500">
                      daily note
                    </span>
                  </Link>
                )}
                <Link
                  href={isToday ? "/app" : `/app?d=${selected}`}
                  className="flex min-h-11 items-center gap-2.5 border-t border-white/6 py-2 text-[0.9375rem] text-ink-300 focus-visible:outline-2 focus-visible:outline-sage/70"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {isToday ? "Open Today" : `Open ${dateLabel} in Today`}
                  </span>
                  <ChevronRight
                    className="h-4 w-4 flex-none text-ink-600"
                    aria-hidden
                  />
                </Link>
                {isToday && today && (
                  <div className="border-t border-white/6">
                    <button
                      type="button"
                      onClick={() => setPlanOpen((o) => !o)}
                      aria-expanded={planOpen}
                      className="flex min-h-11 w-full items-center gap-2.5 py-2 text-left text-[0.9375rem] text-ink-300 focus-visible:outline-2 focus-visible:outline-sage/70"
                    >
                      <span className="min-w-0 flex-1">Plan the day</span>
                      {planOpen ? (
                        <ChevronUp
                          className="h-4 w-4 text-ink-600"
                          aria-hidden
                        />
                      ) : (
                        <ChevronDown
                          className="h-4 w-4 text-ink-600"
                          aria-hidden
                        />
                      )}
                    </button>
                    {planOpen && (
                      <div className="pb-2">
                        <PhonePlanRail today={today} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Unscheduled tasks wait at the bottom (above the tab bar). */}
      {unschedCount > 0 && (
        <div className="flex-none px-4 pt-2 pb-3">
          <button
            type="button"
            onClick={() => setUnschedOpen(true)}
            className="flex min-h-12 w-full items-center gap-2.5 rounded-xl border border-dashed border-white/16 px-3 text-left text-[0.9375rem] text-ink-300 transition-colors active:bg-white/4 focus-visible:outline-2 focus-visible:outline-sage/70"
          >
            <CalendarPlus
              className="h-[1.125rem] w-[1.125rem] flex-none text-ink-400"
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">
              {plural(unschedCount, "unscheduled task")} — tap to place
            </span>
            <ChevronUp
              className="h-[1.125rem] w-[1.125rem] flex-none text-ink-500"
              aria-hidden
            />
          </button>
        </div>
      )}

      {/* Sheets. */}
      {monthSheet && selected && (
        <MonthSheet
          cacheScope={cacheScope}
          selected={selected}
          today={today}
          onPick={(d) => {
            setSelected(d);
            setMonthSheet(false);
          }}
          onMonthGrid={() => {
            setMonthSheet(false);
            setScreen("month");
          }}
          onClose={() => setMonthSheet(false)}
        />
      )}

      {addOpen && selected && today && (
        <BottomSheet
          label="New event"
          header={
            <div className="px-4 pb-2">
              <h2 className="text-[1.0625rem] font-semibold text-ink-100">
                New event
              </h2>
              <p className="text-[0.8125rem] text-ink-500">
                {formatLongDate(selected)}
              </p>
            </div>
          }
          onClose={() => setAddOpen(false)}
        >
          <div className="px-4 pb-2">
            <QuickAddEvent
              roomy
              expanded
              fallbackDay={selected}
              today={today}
              onClose={() => setAddOpen(false)}
              onCreated={refetch}
            />
          </div>
        </BottomSheet>
      )}

      {liveSelection && (
        <BottomSheet
          label={eventSidebarLabel(liveSelection)}
          header={
            <div className="flex items-center justify-between px-4">
              <h2 className="text-[0.6875rem] font-semibold tracking-[0.12em] text-ink-500 uppercase">
                {eventSidebarLabel(liveSelection)}
              </h2>
              <button
                type="button"
                aria-label="Close details"
                onClick={() => setSelection(null)}
                className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-ink-400 focus-visible:outline-2 focus-visible:outline-sage/70"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
          }
          onClose={() => setSelection(null)}
        >
          <EventDetails
            selection={liveSelection}
            tags={tags}
            icsConfigured={icsConfigured}
            onPatch={patchEvent}
            onDelete={deleteEvent}
            onToggleTask={toggleTask}
            onScheduleTask={scheduleTask}
          />
        </BottomSheet>
      )}

      {unschedOpen && selected && today && (
        <UnscheduledSheet
          tasks={unscheduled ?? []}
          today={today}
          selected={selected}
          onPlace={(id, date, time) => {
            scheduleTask(id, date, time);
            setSelected(date);
            setUnschedOpen(false);
          }}
          onClose={() => setUnschedOpen(false)}
        />
      )}
    </div>
  );
}

// --- Agenda rows ---------------------------------------------------------------

function rowColor(
  item: PhoneItem,
  colorOf: (tagId: string | null) => string | null,
): string {
  if (item.source.kind === "ics") return ICS_COLOR;
  if (item.source.kind === "task") return "var(--sage)";
  return colorOf(item.tagId) ?? OWN_EVENT_COLOR;
}

/** The subline: subject name and the first line of the event's notes. */
function subjectName(
  item: PhoneItem,
  tagById: Map<string, TagWithCountResult>,
): string {
  if (item.source.kind === "ics") return "Subscribed";
  // Tasks say so with their checkbox; a subline only repeats it.
  if (item.source.kind === "task") return "";
  const parts: string[] = [];
  const tag = item.tagId ? tagById.get(item.tagId) : undefined;
  if (tag) parts.push(tag.name);
  const firstLine = item.notes?.split("\n").find((l) => l.trim());
  if (firstLine) parts.push(firstLine.trim());
  if (item.multiDay && item.source.kind === "event") {
    const e = item.source.event;
    if (e.endLocalDate)
      parts.push(
        `${parseLocalDate(e.localDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${parseLocalDate(e.endLocalDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
      );
  }
  return parts.join(" · ");
}

function NowDivider({ nowMin }: { nowMin: number }) {
  return (
    <li
      aria-label={`Now, ${clockLabel(nowMin)}`}
      className="flex items-center gap-2 px-4 py-1"
    >
      <span className="w-[3.25rem] flex-none font-mono text-[0.6875rem] font-semibold text-sage">
        NOW
      </span>
      <span className="h-px flex-1 bg-sage/70" />
      <span className="h-1.5 w-1.5 flex-none rounded-full bg-sage" />
    </li>
  );
}

function AgendaRowWithDivider({
  showDivider,
  nowMin,
  children,
}: {
  showDivider: boolean;
  nowMin: number;
  children: React.ReactNode;
}) {
  return (
    <>
      {showDivider && <NowDivider nowMin={nowMin} />}
      {children}
    </>
  );
}

function AgendaRow({
  item,
  color,
  subject,
  nowMin,
  isToday,
  onOpen,
  onToggle,
}: {
  item: PhoneItem;
  color: string;
  subject: string;
  nowMin: number;
  isToday: boolean;
  onOpen: () => void;
  onToggle: (id: string, completed: boolean) => void;
}) {
  const isTask = item.source.kind === "task";
  const live = isToday && isHappeningNow(item, nowMin);
  const timeCol = (
    <span
      className="flex w-[3.25rem] flex-none flex-col pt-0.5 font-mono leading-tight"
      aria-hidden={item.startMin === null ? undefined : true}
    >
      {item.startMin === null ? (
        <span className="text-[0.6875rem] text-ink-500 uppercase">
          {isTask ? "due" : "all day"}
        </span>
      ) : (
        <>
          <span
            className={`text-[0.8125rem] ${live ? "text-sage" : "text-ink-100"}`}
          >
            {clockLabel(item.startMin)}
          </span>
          {item.endMin !== null && item.endMin > item.startMin && (
            <span className="text-[0.75rem] text-ink-500">
              {clockLabel(Math.min(item.endMin, 1439))}
            </span>
          )}
        </>
      )}
    </span>
  );
  const timeText =
    item.startMin === null
      ? isTask
        ? "Due"
        : "All day"
      : `${clockLabel(item.startMin)}${
          item.endMin !== null && item.endMin > item.startMin
            ? ` to ${clockLabel(Math.min(item.endMin, 1439))}`
            : ""
        }`;

  const text = (
    <span className="min-w-0 flex-1">
      <span
        className={`block truncate text-[0.9375rem] leading-snug ${
          item.completed ? "text-ink-500 line-through" : "text-ink-100"
        }`}
      >
        {item.title}
      </span>
      {subject && (
        <span className="block truncate text-[0.8125rem] leading-snug text-ink-500">
          {subject}
        </span>
      )}
    </span>
  );

  return (
    <li className="border-b border-white/6 last:border-b-0">
      {isTask ? (
        <div className="flex min-h-12 items-start gap-0 px-4">
          <div className="flex items-start py-3 pr-0">{timeCol}</div>
          <button
            type="button"
            role="checkbox"
            aria-checked={item.completed}
            aria-label={`${item.completed ? "Mark not done" : "Mark done"}: ${item.title}`}
            onClick={() =>
              item.source.kind === "task" &&
              onToggle(item.source.task.id, !item.completed)
            }
            className="-ml-1 flex min-h-12 w-11 flex-none items-center justify-center focus-visible:outline-2 focus-visible:outline-sage/70"
          >
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-md border-[1.5px] ${
                item.completed
                  ? "border-sage bg-sage"
                  : "border-dashed border-sage/70"
              }`}
            >
              {item.completed && (
                <Check className="h-3.5 w-3.5 text-sage-ink" strokeWidth={3} />
              )}
            </span>
          </button>
          <button
            type="button"
            onClick={onOpen}
            aria-label={`${item.title}, task, ${timeText}`}
            className="flex min-h-12 min-w-0 flex-1 items-center py-2 text-left focus-visible:outline-2 focus-visible:outline-sage/70"
          >
            {text}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`${item.title}, ${timeText}${subject ? `, ${subject}` : ""}`}
          className="flex min-h-14 w-full items-start gap-0 px-4 py-3 text-left transition-colors active:bg-white/4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sage/70"
        >
          {timeCol}
          <span
            aria-hidden
            className="mr-3 w-[3px] flex-none self-stretch rounded-full"
            style={{ backgroundColor: color }}
          />
          {text}
          {live && (
            <span className="ml-2 flex-none pt-0.5 font-mono text-[0.6875rem] font-semibold text-sage">
              NOW
            </span>
          )}
        </button>
      )}
    </li>
  );
}

// --- Month sheet ---------------------------------------------------------------

function MonthSheet({
  cacheScope,
  selected,
  today,
  onPick,
  onMonthGrid,
  onClose,
}: {
  cacheScope: string;
  selected: string;
  today: string | null;
  onPick: (day: string) => void;
  onMonthGrid: () => void;
  onClose: () => void;
}) {
  const [month, setMonth] = useState(selected);
  const cells = useMemo(() => monthCells(month), [month]);
  const [marks, setMarks] = useState<{ key: string; set: Set<string> } | null>(
    null,
  );
  const range = useMemo(() => monthBounds(month), [month]);
  const key = `${range.start}:${range.end}`;

  // Dots: own rows + the ICS feed for the shown month (same warm-cache keys
  // as the month grid, so it's usually instant).
  useEffect(() => {
    let cancelled = false;
    let own: CalendarRangeData | null = null;
    let feedEvents: RangeCalendarEvent[] = [];
    const publish = () => {
      if (!own) return;
      setMarks({
        key,
        set: markedDays(own.events, feedEvents, own.tasks, own.notes),
      });
    };
    void loadCachedThenRefresh({
      key: viewCacheKey(cacheScope, "calendar-local", key),
      refresh: () => getCalendarRangeDataAction(range.start, range.end),
      onValue: (d) => {
        own = d;
        publish();
      },
      onError: (err) => console.error("[calendar] month dots failed:", err),
      cancelled: () => cancelled,
    });
    void loadCachedThenRefresh({
      key: viewCacheKey(cacheScope, "calendar-ics", key),
      refresh: () => listIcsEventsForRangeAction(range.start, range.end),
      onValue: (r) => {
        feedEvents = r.events;
        publish();
      },
      onError: (err) => console.error("[calendar] month ICS failed:", err),
      cancelled: () => cancelled,
    });
    return () => {
      cancelled = true;
    };
  }, [cacheScope, key, range.start, range.end]);

  const dots = marks?.key === key ? marks.set : null;
  const title = parseLocalDate(month).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <BottomSheet
      label="Choose a day"
      onClose={onClose}
      header={
        <div className="flex items-center gap-1 px-4 pb-1">
          <h2 className="min-w-0 flex-1 truncate text-[1.125rem] font-semibold text-ink-100">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setMonth(stepAnchor(month, "month", -1))}
            className={ICON_BTN}
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setMonth(stepAnchor(month, "month", 1))}
            className={`${ICON_BTN} -mr-2`}
          >
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
        </div>
      }
    >
      <div className="px-3 pb-1">
        <div className="grid grid-cols-7" role="grid" aria-label={title}>
          {LETTERS.map((l, i) => (
            <span
              key={i}
              aria-hidden
              className="py-1.5 text-center font-mono text-[0.75rem] text-ink-600"
            >
              {l}
            </span>
          ))}
          {cells.map((d, i) =>
            d === null ? (
              <span key={`p-${i}`} />
            ) : (
              <button
                key={d}
                type="button"
                onClick={() => onPick(d)}
                aria-label={formatLongDate(d)}
                aria-current={d === today ? "date" : undefined}
                aria-pressed={d === selected}
                className={`relative mx-auto flex h-11 w-11 items-center justify-center rounded-full text-[0.9375rem] tabular-nums focus-visible:outline-2 focus-visible:outline-sage/70 ${
                  d === selected
                    ? "bg-sage font-semibold text-sage-ink"
                    : d === today
                      ? "font-semibold text-sage ring-1 ring-sage/50"
                      : "text-ink-200"
                }`}
              >
                {Number(d.slice(8))}
                {dots?.has(d) && (
                  <span
                    aria-hidden
                    className={`absolute bottom-1 h-1 w-1 rounded-full ${
                      d === selected ? "bg-sage-ink" : "bg-ink-500"
                    }`}
                  />
                )}
              </button>
            ),
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 px-4 pt-1 pb-1">
        {today && (
          <button
            type="button"
            onClick={() => onPick(today)}
            className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-white/10 text-[0.9375rem] font-medium text-ink-200 focus-visible:outline-2 focus-visible:outline-sage/70"
          >
            Today
          </button>
        )}
        <button
          type="button"
          onClick={onMonthGrid}
          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 text-[0.9375rem] font-medium text-ink-200 focus-visible:outline-2 focus-visible:outline-sage/70"
        >
          <LayoutGrid className="h-4 w-4" aria-hidden />
          Month grid
        </button>
      </div>
    </BottomSheet>
  );
}

// --- Unscheduled sheet ------------------------------------------------------------

const PLACE_HOURS = Array.from({ length: 15 }, (_, i) => 7 + i); // 7a – 9p

function UnscheduledSheet({
  tasks,
  today,
  selected,
  onPlace,
  onClose,
}: {
  tasks: UnscheduledTaskResult[];
  today: string;
  selected: string;
  onPlace: (taskId: string, date: string, time: string | null) => void;
  onClose: () => void;
}) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [date, setDate] = useState(selected);
  const [custom, setCustom] = useState("");
  const picked = tasks.find((t) => t.id === pickedId) ?? null;

  // Fourteen days from today, plus the selected day when it's outside them.
  const days = useMemo(() => {
    const list = Array.from({ length: 14 }, (_, i) => addDays(today, i));
    if (!list.includes(selected)) list.unshift(selected);
    return list;
  }, [today, selected]);

  if (!picked) {
    return (
      <BottomSheet
        label="Unscheduled tasks"
        onClose={onClose}
        header={
          <div className="px-4 pb-2">
            <h2 className="text-[1.0625rem] font-semibold text-ink-100">
              {plural(tasks.length, "unscheduled task")}
            </h2>
            <p className="text-[0.8125rem] text-ink-500">
              Tap one, then pick a day and a time.
            </p>
          </div>
        }
      >
        {tasks.length === 0 ? (
          <p className="px-4 pb-4 text-[0.9375rem] text-ink-500">
            Every open task has a day.
          </p>
        ) : (
          <ul className="list-none px-4 pb-2">
            {tasks.map((t) => (
              <li
                key={t.id}
                className="border-b border-white/6 last:border-b-0"
              >
                <button
                  type="button"
                  onClick={() => {
                    setPickedId(t.id);
                    setDate(selected);
                    setCustom("");
                  }}
                  className="flex min-h-12 w-full items-center gap-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-sage/70"
                >
                  <span
                    aria-hidden
                    className="h-4 w-4 flex-none rounded-md border-[1.5px] border-dashed border-sage/70"
                  />
                  <span className="min-w-0 flex-1 truncate text-[0.9375rem] text-ink-100">
                    {t.title}
                  </span>
                  <ChevronRight
                    className="h-4 w-4 flex-none text-ink-600"
                    aria-hidden
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </BottomSheet>
    );
  }

  return (
    <BottomSheet
      label={`Place ${picked.title}`}
      onClose={onClose}
      header={
        <div className="flex items-center gap-1 px-4 pb-2">
          <button
            type="button"
            aria-label="Back to unscheduled tasks"
            onClick={() => setPickedId(null)}
            className="-ml-2 flex h-11 w-11 flex-none items-center justify-center rounded-full text-ink-300 focus-visible:outline-2 focus-visible:outline-sage/70"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[0.6875rem] font-semibold tracking-[0.12em] text-ink-500 uppercase">
              Place on the calendar
            </p>
            <h2 className="truncate text-[1.0625rem] font-semibold text-ink-100">
              {picked.title}
            </h2>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3 pb-2">
        <div
          role="radiogroup"
          aria-label="Day"
          className="flex gap-1.5 overflow-x-auto px-4 pb-1"
        >
          {days.map((d) => {
            const dt = parseLocalDate(d);
            const on = d === date;
            return (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={formatLongDate(d)}
                onClick={() => setDate(d)}
                className={`flex min-h-[3.5rem] w-12 flex-none flex-col items-center justify-center rounded-xl border text-center focus-visible:outline-2 focus-visible:outline-sage/70 ${
                  on
                    ? "border-sage bg-sage text-sage-ink"
                    : "border-white/10 text-ink-200"
                }`}
              >
                <span
                  className={`font-mono text-[0.6875rem] uppercase ${
                    on ? "" : "text-ink-500"
                  }`}
                >
                  {d === today
                    ? "Today"
                    : dt.toLocaleDateString("en-US", { weekday: "short" })}
                </span>
                <span className="text-[1rem] font-semibold tabular-nums">
                  {dt.getDate()}
                </span>
              </button>
            );
          })}
        </div>

        <div className="px-4">
          <button
            type="button"
            onClick={() => onPlace(picked.id, date, null)}
            className="flex min-h-11 w-full items-center justify-center rounded-xl border border-sage/40 bg-sage/10 text-[0.9375rem] font-medium text-sage focus-visible:outline-2 focus-visible:outline-sage/70"
          >
            {formatLongDate(date)} — no time
          </button>
        </div>

        <div
          role="group"
          aria-label="Time"
          className="grid grid-cols-4 gap-1.5 px-4"
        >
          {PLACE_HOURS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => onPlace(picked.id, date, minToHHMM(h * 60))}
              className="flex min-h-11 items-center justify-center rounded-xl border border-white/10 font-mono text-[0.875rem] text-ink-100 active:bg-white/8 focus-visible:outline-2 focus-visible:outline-sage/70"
            >
              {clockLabel(h * 60)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 px-4">
          <label className="sr-only" htmlFor="phone-cal-time">
            Custom time
          </label>
          <input
            id="phone-cal-time"
            type="time"
            step={300}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 font-mono text-[1rem] text-ink-100 focus:border-sage/50 focus:outline-none"
          />
          <button
            type="button"
            disabled={!custom}
            onClick={() => onPlace(picked.id, date, custom)}
            className="flex min-h-11 flex-none items-center rounded-xl bg-sage/16 px-5 text-[0.9375rem] font-semibold text-sage disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-sage/70"
          >
            Place
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
