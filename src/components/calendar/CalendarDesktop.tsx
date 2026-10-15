"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";

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
import { PageLayout, SidebarToggles } from "@/components/layout/PageLayout";
import {
  SIDEBAR_FOCUS,
  SidebarIconButton,
  SidebarSection,
} from "@/components/layout/sidebar";
import {
  CALENDAR_VIEWS,
  isCalendarView,
  isWeekend,
  minToHHMM,
  monthBounds,
  rangeTitle,
  stepAnchor,
  visibleDays,
  type CalendarView,
} from "@/lib/calendar-grid";
import { localDateString } from "@/lib/dates";
import { isSubjectColor } from "@/lib/subjects";
import { usePersistentState } from "@/lib/hooks/use-persistent-state";
import { loadCachedThenRefresh, viewCacheKey } from "@/lib/indexeddb-cache";
import type { RangeCalendarEvent } from "@/server/calendar";

import {
  ICS_COLOR,
  OWN_EVENT_COLOR,
  type CalendarSelection,
} from "./calendar-items";
import { LayerRow, MiniMonth, UnscheduledChip } from "./CalendarSidebar";
import {
  EventDetails,
  eventSidebarLabel,
  type EventPatchInput,
} from "./EventDetails";
import { MonthGridDesktop } from "./MonthGridDesktop";
import { QuickAddEvent } from "./QuickAddEvent";
import { TimeGrid, type GridComposer } from "./TimeGrid";

/**
 * Desktop/tablet Calendar (md+; Notes Sidebars design §5c, tablet §6c).
 *
 *   [CALENDAR: mini month · Calendars · Unscheduled] [header + grid] [EVENT]
 *
 * - Views: Day / Week (default; Sun–Sat) / Month, persisted per device. At
 *   tablet widths (<1280px or a coarse pointer) Week is the Mon–Fri work week
 *   and Unscheduled folds into a chip row above the grid.
 * - Layers (persisted): own Events (+ one toggle per subject), the
 *   Subscribed ICS feed (only when configured) and due Tasks.
 * - Unscheduled tasks drag onto a day (due date) or a time slot (due date +
 *   time via scheduleTaskAction); click a chip to arm it for tap-to-place on
 *   touch/keyboard.
 * - Selecting an item opens the right-hand EVENT sidebar (controlled; closing
 *   deselects; Esc closes). Empty slot → the quick-add composer on that slot.
 *
 * Data: app-owned rows (getCalendarRangeDataAction) and the ICS feed
 * (listIcsEventsForRangeAction) load separately, so a slow feed never blocks
 * the grid. Same IndexedDB warm-cache keys as the phone views.
 */

const TABLET_QUERY = "(max-width: 1279.98px), (pointer: coarse)";

function subscribeTablet(cb: () => void) {
  const mq = window.matchMedia(TABLET_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function useCompactCalendar(): boolean {
  return useSyncExternalStore(
    subscribeTablet,
    () => window.matchMedia(TABLET_QUERY).matches,
    () => false,
  );
}

interface Layers {
  events: boolean;
  subscribed: boolean;
  tasks: boolean;
  /** Subject (tag) ids switched off. */
  hidden: string[];
}

const DEFAULT_LAYERS: Layers = {
  events: true,
  subscribed: true,
  tasks: true,
  hidden: [],
};

function isLayers(v: unknown): v is Layers {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.events === "boolean" &&
    typeof o.subscribed === "boolean" &&
    typeof o.tasks === "boolean" &&
    Array.isArray(o.hidden) &&
    o.hidden.every((x) => typeof x === "string")
  );
}

const VIEW_LABEL: Record<CalendarView, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
};

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.closest?.("input, textarea, select, [contenteditable='true']");
}

export function CalendarDesktop({
  cacheScope,
  active,
}: {
  cacheScope: string;
  /** False on phones: the tree still renders (hidden) but loads nothing. */
  active: boolean;
}) {
  const compact = useCompactCalendar();

  // Client-local today + the current minute (for the now line).
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

  const [view, setView] = usePersistentState<CalendarView>(
    "agenda.calendar.view",
    "week",
    isCalendarView,
  );
  const [layers, setLayers] = usePersistentState<Layers>(
    "agenda.calendar.layers",
    DEFAULT_LAYERS,
    isLayers,
  );

  const [anchor, setAnchor] = useState<string | null>(null);
  const [miniMonth, setMiniMonth] = useState<string | null>(null);
  useEffect(() => {
    if (!today || anchor) return;
    setAnchor(today);
    setMiniMonth(today);
  }, [today, anchor]);

  const workWeek = compact && view === "week";
  const days = useMemo(
    () => (anchor ? visibleDays(anchor, view, workWeek) : []),
    [anchor, view, workWeek],
  );
  const range = useMemo(() => {
    if (!anchor || days.length === 0) return null;
    return view === "month"
      ? monthBounds(anchor)
      : { start: days[0], end: days[days.length - 1] };
  }, [anchor, view, days]);
  const rangeKey = range ? `${range.start}:${range.end}` : null;

  // Keep the mini month showing the anchor's month as the main view pages.
  useEffect(() => {
    if (anchor) setMiniMonth(anchor);
  }, [anchor]);

  // --- Data ------------------------------------------------------------------

  const [local, setLocal] = useState<{
    key: string;
    data: CalendarRangeData;
  } | null>(null);
  const [icsState, setIcsState] = useState<{
    key: string;
    configured: boolean;
    events: RangeCalendarEvent[];
  } | null>(null);
  const [version, setVersion] = useState(0);
  const refetch = useCallback(() => setVersion((v) => v + 1), []);
  const localRef = useRef(local);
  localRef.current = local;

  useEffect(() => {
    if (!active || !range || !rangeKey) return;
    let cancelled = false;
    void loadCachedThenRefresh({
      key: viewCacheKey(cacheScope, "calendar-local", rangeKey),
      refresh: () => getCalendarRangeDataAction(range.start, range.end),
      onValue: (data, source) => {
        // A warm-cache paint after our own edit would flash the old rows.
        if (source === "cache" && localRef.current?.key === rangeKey) return;
        setLocal({ key: rangeKey, data });
      },
      onError: (err) => console.error("[calendar] range load failed:", err),
      cancelled: () => cancelled,
    });
    return () => {
      cancelled = true;
    };
  }, [active, range, rangeKey, cacheScope, version]);

  useEffect(() => {
    if (!active || !range || !rangeKey) return;
    let cancelled = false;
    void loadCachedThenRefresh({
      key: viewCacheKey(cacheScope, "calendar-ics", rangeKey),
      refresh: () => listIcsEventsForRangeAction(range.start, range.end),
      onValue: (r) => setIcsState({ key: rangeKey, ...r }),
      onError: (err) => console.error("[calendar] ICS load failed:", err),
      cancelled: () => cancelled,
    });
    return () => {
      cancelled = true;
    };
  }, [active, range, rangeKey, cacheScope]);

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

  // Rows for the current range only (a stale range's rows would draw on the
  // wrong days while the new range loads).
  const data = local && local.key === rangeKey ? local.data : null;
  const ics = icsState && icsState.key === rangeKey ? icsState : null;
  const icsConfigured = icsState?.configured ?? false;

  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const colorOf = useCallback(
    (tagId: string | null) =>
      tagId ? (tagById.get(tagId)?.color ?? null) : null,
    [tagById],
  );

  const hidden = useMemo(() => new Set(layers.hidden), [layers.hidden]);
  const visEvents = useMemo(
    () =>
      layers.events && data
        ? data.events.filter((e) => !(e.tagId && hidden.has(e.tagId)))
        : [],
    [data, layers.events, hidden],
  );
  const visIcs = useMemo(
    () => (layers.subscribed && ics ? ics.events : []),
    [ics, layers.subscribed],
  );
  const visTasks = useMemo(
    () => (layers.tasks && data ? data.tasks : []),
    [data, layers.tasks],
  );
  const noteDays = useMemo(
    () => new Set(data?.notes.map((n) => n.date) ?? []),
    [data],
  );

  // Subjects for the CALENDARS list: tags with a subject color (made via
  // "+ New subject") plus any tag an event in view carries.
  const subjectRows = useMemo(() => {
    const used = new Set(
      (data?.events ?? []).map((e) => e.tagId).filter(Boolean) as string[],
    );
    return tags.filter((t) => isSubjectColor(t.color) || used.has(t.id));
  }, [tags, data]);

  // --- Selection + details sidebar -------------------------------------------

  const [selection, setSelection] = useState<CalendarSelection | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const select = (sel: CalendarSelection) => {
    setSelection(sel);
    setDetailsOpen(true);
    setComposer(null);
  };
  const closeDetails = () => {
    setDetailsOpen(false);
    setSelection(null);
  };

  // Keep the panel on the freshest copy of the selected row.
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

  const selectedKey = !selection
    ? null
    : selection.kind === "event"
      ? `u:${selection.id}`
      : selection.kind === "task"
        ? `t:${selection.id}`
        : selection.key;

  // --- Composers ---------------------------------------------------------------

  const [composer, setComposer] = useState<GridComposer | null>(null);
  const [headerAddOpen, setHeaderAddOpen] = useState(false);

  // --- Tap-to-place + drag state -----------------------------------------------

  const [armedId, setArmedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const armedTask = unscheduled?.find((t) => t.id === armedId) ?? null;

  // --- Keyboard: N = new event, Esc closes the top-most thing ------------------

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        if (isTyping(e.target)) return;
        if (armedId) setArmedId(null);
        else if (composer || headerAddOpen) {
          // The composer handles its own Escape.
        } else if (detailsOpen) closeDetails();
        return;
      }
      if (e.key !== "n" && e.key !== "N") return;
      if (isTyping(e.target)) return;
      e.preventDefault();
      setComposer(null);
      setHeaderAddOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // --- Mutations -----------------------------------------------------------------

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
        // A moved day or retimed span can change what this range holds.
        if (patch.localDate !== undefined) refetch();
      })
      .catch((err) => {
        console.error("[calendar] update event failed:", err);
        refetch();
      });
  };

  const deleteEvent = (id: string) => {
    patchLocal((d) => ({ ...d, events: d.events.filter((e) => e.id !== id) }));
    closeDetails();
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
      range !== null &&
      date >= range.start &&
      date <= range.end;

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
    if (
      date === null &&
      selection?.kind === "task" &&
      selection.id === taskId
    ) {
      setDetailsOpen(false);
    }
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

  /** Drop / tap-to-place from the grid. `taskId` null = the armed task. */
  const place = (
    taskId: string | null,
    date: string,
    startMin: number | null,
  ) => {
    const id = taskId ?? armedId;
    if (!id) return;
    setArmedId(null);
    setDragging(false);
    // A day drop (month cell, strip, day name) means "that day, no time".
    scheduleTask(id, date, startMin === null ? null : minToHHMM(startMin));
  };

  // --- Navigation ---------------------------------------------------------------

  const step = (delta: number) =>
    setAnchor((a) => (a ? stepAnchor(a, view, delta) : a));
  const goToday = () => today && setAnchor(today);
  const openDay = (d: string) => {
    setAnchor(d);
    setView("day");
  };
  const pickMini = (d: string) => {
    setAnchor(d);
    if (view === "month") setView("week");
    else if (view === "week" && compact && isWeekend(d)) setView("day");
  };

  const { title, subline } = useMemo(
    () =>
      days.length > 0
        ? rangeTitle(days, view, workWeek)
        : { title: "", subline: "" },
    [days, view, workWeek],
  );
  const rangeSet = useMemo(() => new Set(days), [days]);
  const loading = !anchor || !data;

  // --- Render -----------------------------------------------------------------------

  const composerNode =
    composer && today ? (
      <QuickAddEvent
        expanded
        fallbackDay={composer.date}
        today={today}
        defaultStartMin={composer.startMin}
        defaultEndMin={Math.min(1440, composer.startMin + 60)}
        placeholder="New event — e.g. Lunch w/ Sam"
        onClose={() => setComposer(null)}
        onCreated={refetch}
      />
    ) : null;

  const headerFallbackDay =
    today && rangeSet.has(today) ? today : (anchor ?? today);

  const unscheduledList = unscheduled ?? [];

  const sidebar1 = {
    label: "Calendar",
    defaultWidth: 20,
    minWidth: 16,
    maxWidth: 28,
    children: (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {miniMonth && (
          <MiniMonth
            month={miniMonth}
            onMonth={setMiniMonth}
            today={today}
            rangeDays={rangeSet}
            onPick={pickMini}
          />
        )}
        <div className="border-t border-white/6" />
        <SidebarSection label="Calendars" storageKey="calendar.calendars">
          <div className="pb-2">
            <LayerRow
              label="Events"
              color={OWN_EVENT_COLOR}
              checked={layers.events}
              onChange={(v) => setLayers({ ...layers, events: v })}
            />
            {subjectRows.map((t) => (
              <LayerRow
                key={t.id}
                indent
                label={t.name}
                color={t.color ?? OWN_EVENT_COLOR}
                disabled={!layers.events}
                checked={layers.events && !hidden.has(t.id)}
                onChange={(v) =>
                  setLayers({
                    ...layers,
                    hidden: v
                      ? layers.hidden.filter((id) => id !== t.id)
                      : [...layers.hidden, t.id],
                  })
                }
              />
            ))}
            {icsConfigured && (
              <LayerRow
                label="Subscribed"
                color={ICS_COLOR}
                checked={layers.subscribed}
                onChange={(v) => setLayers({ ...layers, subscribed: v })}
              />
            )}
            <LayerRow
              label="Tasks"
              color="var(--sage)"
              dashed
              checked={layers.tasks}
              onChange={(v) => setLayers({ ...layers, tasks: v })}
            />
          </div>
        </SidebarSection>
        {!compact && (
          <>
            <div className="border-t border-white/6" />
            <SidebarSection
              label="Unscheduled"
              count={unscheduled ? unscheduledList.length : undefined}
              storageKey="calendar.unscheduled"
              actions={
                <span className="text-[0.75rem] text-ink-600">
                  drag onto a day
                </span>
              }
            >
              <div className="flex flex-col gap-1.5 px-3 pb-3">
                {unscheduled === null ? (
                  <>
                    <div className="h-[2.3rem] animate-pulse rounded-md bg-white/4" />
                    <div className="h-[2.3rem] animate-pulse rounded-md bg-white/4" />
                  </>
                ) : unscheduledList.length === 0 ? (
                  <p className="px-1 text-[0.8125rem] text-ink-600">
                    Every open task has a day.
                  </p>
                ) : (
                  unscheduledList.map((t) => (
                    <UnscheduledChip
                      key={t.id}
                      task={t}
                      armed={armedId === t.id}
                      onArm={() =>
                        setArmedId((a) => (a === t.id ? null : t.id))
                      }
                      onDragState={setDragging}
                    />
                  ))
                )}
              </div>
            </SidebarSection>
          </>
        )}
      </div>
    ),
  };

  const sidebar2 = {
    label: eventSidebarLabel(selection),
    defaultWidth: 22,
    minWidth: 18,
    maxWidth: 32,
    open: detailsOpen,
    onOpenChange: (open: boolean) => {
      if (open) setDetailsOpen(true);
      else closeDetails();
    },
    children: (
      <EventDetails
        selection={liveSelection}
        tags={tags}
        icsConfigured={icsConfigured}
        onPatch={patchEvent}
        onDelete={deleteEvent}
        onToggleTask={toggleTask}
        onScheduleTask={scheduleTask}
      />
    ),
  };

  return (
    <div className="hidden h-full min-h-0 md:flex">
      <PageLayout
        pageKey="calendar"
        sidebar1={sidebar1}
        sidebar2={sidebar2}
        sidebar2Position="right"
      >
        {/* Content header */}
        <header className="relative flex h-[3.25rem] flex-none items-center gap-2 border-b border-white/6 pr-2 pl-3 touch:h-[3.75rem]">
          <SidebarToggles />
          <div className="flex min-w-0 flex-1 flex-col justify-center pl-1">
            {title ? (
              <>
                <h1 className="truncate text-[1.125rem] leading-tight font-semibold text-ink-100">
                  {title}
                </h1>
                {subline && (
                  <span className="truncate text-[0.75rem] leading-tight text-ink-500">
                    {subline}
                  </span>
                )}
              </>
            ) : (
              <div className="h-4 w-40 animate-pulse rounded bg-white/6" />
            )}
          </div>

          <div
            role="radiogroup"
            aria-label="Calendar view"
            className="flex flex-none items-center rounded-lg bg-white/4 p-0.5"
          >
            {CALENDAR_VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                onClick={() => setView(v)}
                className={`h-7 rounded-md px-3 text-[0.8125rem] transition-colors touch:h-11 touch:px-4 ${SIDEBAR_FOCUS} ${
                  view === v
                    ? "bg-white/10 font-medium text-ink-100"
                    : "text-ink-400 hover:text-ink-200"
                }`}
              >
                {VIEW_LABEL[v]}
              </button>
            ))}
          </div>

          <div className="flex flex-none items-center gap-0.5">
            <SidebarIconButton
              icon={ChevronLeft}
              label={`Previous ${view}`}
              onClick={() => step(-1)}
              disabled={!anchor}
            />
            <button
              type="button"
              onClick={goToday}
              disabled={!today}
              className={`h-7 rounded-md px-2.5 text-[0.8125rem] text-ink-300 hover:bg-white/6 hover:text-ink-100 disabled:opacity-40 touch:h-11 ${SIDEBAR_FOCUS}`}
            >
              Today
            </button>
            <SidebarIconButton
              icon={ChevronRight}
              label={`Next ${view}`}
              onClick={() => step(1)}
              disabled={!anchor}
            />
          </div>

          <button
            type="button"
            onClick={() => {
              setComposer(null);
              setHeaderAddOpen(true);
            }}
            disabled={!today}
            title="New event (N)"
            className={`flex h-7 flex-none items-center gap-1 rounded-md bg-sage/14 px-2 text-[0.8125rem] font-medium text-sage hover:bg-sage/22 disabled:opacity-40 touch:h-11 ${SIDEBAR_FOCUS}`}
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">New event</span>
            <kbd className="ml-0.5 hidden rounded border border-sage/35 px-1 font-mono text-[0.625rem] lg:inline">
              N
            </kbd>
          </button>
          <SidebarToggles side="right" />

          {headerAddOpen && today && headerFallbackDay && (
            <div className="absolute top-full right-2 z-40 mt-1.5 w-[24rem] max-w-[calc(100%-1rem)] rounded-xl bg-panel shadow-[0_12px_32px_rgba(0,0,0,0.45)]">
              <QuickAddEvent
                expanded
                fallbackDay={headerFallbackDay}
                today={today}
                onClose={() => setHeaderAddOpen(false)}
                onCreated={refetch}
              />
            </div>
          )}
        </header>

        {/* Tablet: Unscheduled as a chip row above the grid (design §6c). */}
        {compact && unscheduledList.length > 0 && (
          <div className="flex flex-none items-center gap-2 overflow-x-auto border-b border-white/6 px-3 py-2">
            <span className="flex-none text-[0.6875rem] font-semibold tracking-[0.1em] text-ink-500 uppercase">
              Unscheduled
            </span>
            {unscheduledList.map((t) => (
              <UnscheduledChip
                key={t.id}
                inline
                task={t}
                armed={armedId === t.id}
                onArm={() => setArmedId((a) => (a === t.id ? null : t.id))}
                onDragState={setDragging}
              />
            ))}
          </div>
        )}

        {armedTask && (
          <div className="flex flex-none items-center gap-2 border-b border-sage/25 bg-sage/8 px-3 py-1.5 text-[0.8125rem] text-ink-200">
            <span className="min-w-0 flex-1 truncate">
              Placing{" "}
              <span className="font-medium text-ink-100">
                {armedTask.title}
              </span>{" "}
              —{" "}
              {view === "month"
                ? "pick a day"
                : "pick a time, or a day name for no time"}
            </span>
            <SidebarIconButton
              icon={X}
              label="Cancel placing"
              onClick={() => setArmedId(null)}
            />
          </div>
        )}

        {loading || !anchor ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
            <div className="h-8 animate-pulse rounded bg-white/4" />
            <div className="min-h-0 flex-1 animate-pulse rounded bg-white/[0.03]" />
          </div>
        ) : view === "month" ? (
          <MonthGridDesktop
            anchor={anchor}
            today={today}
            events={visEvents}
            ics={visIcs}
            tasks={visTasks}
            noteDays={noteDays}
            colorOf={colorOf}
            selectedKey={selectedKey}
            armed={armedTask !== null}
            onSelect={select}
            onPlace={(id, d) => place(id, d, null)}
            onOpenDay={openDay}
          />
        ) : (
          <TimeGrid
            days={days}
            today={today}
            nowMin={nowMin}
            events={visEvents}
            ics={visIcs}
            tasks={visTasks}
            noteDays={noteDays}
            colorOf={colorOf}
            selectedKey={selectedKey}
            armedTitle={armedTask?.title ?? null}
            dragging={dragging}
            composer={composer}
            composerNode={composerNode}
            onSelect={select}
            onSlot={(date, startMin) => {
              setHeaderAddOpen(false);
              setComposer({ date, startMin });
            }}
            onPlace={place}
            onOpenDay={openDay}
          />
        )}
      </PageLayout>
    </div>
  );
}
