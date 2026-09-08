"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createAgendaLineAction,
  createAgendaTaskAction,
  getAgendaWeekAction,
  setTaskImportantAction,
  toggleTaskAction,
  type AgendaLineResult,
  type AgendaTaskResult,
  type AgendaWeekResult,
} from "@/app/app/actions";
import { listIcsEventsForRangeAction } from "@/app/app/calendar/actions";
import { TASKS_CHANGED_EVENT } from "@/components/layout/NavRail";
import type { RangeCalendarEvent } from "@/server/calendar";
import { addDays, startOfWeek } from "@/lib/dates";

/**
 * The agenda's data layer: one request per week, held in a cache the whole page
 * shares. The week strip and the opened day are two views of the same seven
 * days, so they must never fetch separately — ticking a task off inside the
 * open day has to redraw that day's strip cell in the same paint, and a second
 * copy of the week would let the two drift. Every write is optimistic against
 * the cache and rolled back on failure, the way the tasks widget does it.
 *
 * Weeks are kept in a ref-held map (a version counter in state is what
 * re-renders) so a write can read the current cache synchronously instead of
 * racing another in-flight toggle through a stale `prev`. Flipping to an
 * already-cached week paints instantly; the neighbours are prefetched behind
 * the viewed week so arrow-key paging feels free.
 *
 * ICS occurrences are fetched per week on their own, because the feed is an
 * external HTTP round trip that can be slow or down and must never hold up the
 * agenda itself; a failure just leaves that week with no feed events. Carried
 * tasks, by contrast, ride along in the week payload: they belong to no day in
 * the range but are drawn above it, and a second round trip for them would let
 * the carried band and the days disagree about what is done.
 */

export type AgendaWeekState = {
  /** Monday of the viewed week (null until today/viewed resolve). */
  weekStart: string | null;
  /** The viewed week's data; null while the first load for that week is in flight. */
  week: AgendaWeekResult | null;
  /** ICS occurrences for the viewed week (empty until loaded or when no feed is configured). */
  ics: RangeCalendarEvent[];
  loading: boolean;
  /** Optimistic complete/uncomplete. Updates the task in BOTH `tasks` and `carried`
   *  (a carried task may also be due inside the viewed week); done → completedAt = now ISO,
   *  and it leaves `carried`; undone → completedAt null, and it re-enters `carried` when its
   *  due day < today. Rolls back on failure. */
  toggle: (task: AgendaTaskResult, done: boolean) => void;
  star: (taskId: string, important: boolean) => void;
  /** Creates via createAgendaTaskAction and inserts the returned row into `tasks` when its due day
   *  is inside the viewed week (keep dueAt order). Rejects on failure. */
  add: (title: string, dateStr: string, lineId: string | null) => Promise<void>;
  /** createAgendaLineAction; on success replaces `week.lines` (in every cached week) with the
   *  new list — the returned line appended. Rejects on invalid/failed. */
  createLine: (name: string) => Promise<void>;
  /** Drop the cache and refetch the viewed week. */
  refresh: () => void;
};

/** Shared empty array so a week with no feed events keeps a stable identity. */
const EMPTY_ICS: RangeCalendarEvent[] = [];

/**
 * A cached week plus what it was fetched against: `token` rises on every
 * invalidation (a task changed elsewhere, or `refresh`), `today` because the
 * payload's carried pile is computed relative to it and goes stale at midnight.
 */
type WeekEntry = {
  token: number;
  today: string;
  week: AgendaWeekResult;
};

/** dueAt-ascending insert (replacing any existing copy of the row). */
function insertByDueAt(
  list: AgendaTaskResult[],
  row: AgendaTaskResult,
): AgendaTaskResult[] {
  return [...list.filter((t) => t.id !== row.id), row].sort((a, b) =>
    a.dueAt.localeCompare(b.dueAt),
  );
}

export function useAgendaWeek(
  viewed: string | null,
  today: string | null,
): AgendaWeekState {
  const weekStart = viewed === null ? null : startOfWeek(viewed);

  const weeksRef = useRef(new Map<string, WeekEntry>());
  const icsRef = useRef(new Map<string, RangeCalendarEvent[]>());
  const requestSeq = useRef(0);
  const [version, setVersion] = useState(0);
  const [token, setToken] = useState(0);
  const [loading, setLoading] = useState(true);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  /**
   * The single writer for the week cache: rewrite the entry for `start`, or
   * every cached week when `start` is null (a task's completion or the line set
   * is week-independent), then re-render. Reading the ref rather than a `prev`
   * snapshot is what lets two toggles in the same tick both land.
   */
  const patchWeek = useCallback(
    (
      start: string | null,
      fn: (week: AgendaWeekResult) => AgendaWeekResult,
    ) => {
      const cache = weeksRef.current;
      let changed = false;
      for (const [key, entry] of cache) {
        if (start !== null && key !== start) continue;
        const next = fn(entry.week);
        if (next === entry.week) continue;
        cache.set(key, { ...entry, week: next });
        changed = true;
      }
      if (changed) bump();
    },
    [bump],
  );

  useEffect(() => {
    if (weekStart === null || today === null) return;
    let cancelled = false;
    const requestId = (requestSeq.current += 1);
    const cached = weeksRef.current.get(weekStart);
    const fresh = (entry: WeekEntry | undefined) =>
      entry !== undefined && entry.token === token && entry.today === today;

    // Only a week with nothing cached blanks the page: a stale week (a task
    // changed elsewhere) keeps painting until its replacement lands.
    setLoading(cached === undefined);

    const load = async (start: string) => {
      const week = await getAgendaWeekAction(start, addDays(start, 6), today);
      weeksRef.current.set(start, { token, today, week });
      bump();
    };

    const run = async () => {
      if (!fresh(cached)) {
        try {
          await load(weekStart);
        } catch (err) {
          console.error(`[agenda] week load failed for ${weekStart}:`, err);
        }
      }
      if (cancelled || requestId !== requestSeq.current) return;
      setLoading(false);
      // Neighbours come after the viewed week has painted, and never touch
      // `loading` — paging an arrow should find them already there. Only
      // empty slots are filled: a neighbour that merely went stale refetches
      // when it is actually opened, rather than spending three requests every
      // time a task changes somewhere else in the app.
      for (const start of [addDays(weekStart, -7), addDays(weekStart, 7)]) {
        if (cancelled) return;
        if (weeksRef.current.get(start) !== undefined) continue;
        try {
          await load(start);
        } catch (err) {
          console.error(`[agenda] week prefetch failed for ${start}:`, err);
        }
      }
    };
    void run();

    return () => {
      cancelled = true;
    };
  }, [weekStart, today, token, bump]);

  useEffect(() => {
    if (weekStart === null) return;
    if (icsRef.current.has(weekStart)) return;
    let cancelled = false;
    const start = weekStart;
    listIcsEventsForRangeAction(start, addDays(start, 6))
      .then((result) => {
        if (cancelled) return;
        // No feed configured is a real, cacheable answer: no events, ever.
        icsRef.current.set(
          start,
          result.configured ? result.events : EMPTY_ICS,
        );
        bump();
      })
      .catch((err) => {
        // Left uncached so a later visit retries; the week reads as [] anyway.
        console.error(`[agenda] ICS load failed for ${start}:`, err);
      });
    return () => {
      cancelled = true;
    };
  }, [weekStart, token, bump]);

  // A task created or completed anywhere else (rail create menu, tasks page)
  // invalidates every cached week; the viewed one refetches without flicker.
  useEffect(() => {
    const onTasksChanged = () => setToken((t) => t + 1);
    window.addEventListener(TASKS_CHANGED_EVENT, onTasksChanged);
    return () => {
      window.removeEventListener(TASKS_CHANGED_EVENT, onTasksChanged);
    };
  }, []);

  /** Rewrite one task wherever it is cached — it can sit in `tasks` of the
   * week it is due in and in `carried` of every cached week at the same time. */
  const writeTask = useCallback(
    (taskId: string, fn: (task: AgendaTaskResult) => AgendaTaskResult) => {
      patchWeek(null, (week) => ({
        ...week,
        tasks: week.tasks.map((t) => (t.id === taskId ? fn(t) : t)),
        carried: week.carried.map((t) => (t.id === taskId ? fn(t) : t)),
      }));
    },
    [patchWeek],
  );

  /** Completion also moves the task in and out of `carried`, so it can't go
   * through `writeTask`. The cached copy wins as the template when there is
   * one: a star flipped since the toggle started must survive the rollback. */
  const writeCompletion = useCallback(
    (task: AgendaTaskResult, completedAt: string | null) => {
      const dueDay = task.dueAt.slice(0, 10);
      const carriedNow =
        completedAt === null && today !== null && dueDay < today;
      patchWeek(null, (week) => {
        const known =
          week.tasks.find((t) => t.id === task.id) ??
          week.carried.find((t) => t.id === task.id) ??
          task;
        const next: AgendaTaskResult = { ...known, completedAt };
        return {
          ...week,
          tasks: week.tasks.map((t) => (t.id === task.id ? next : t)),
          carried: carriedNow
            ? insertByDueAt(week.carried, next)
            : week.carried.filter((t) => t.id !== task.id),
        };
      });
    },
    [patchWeek, today],
  );

  const toggle = useCallback(
    (task: AgendaTaskResult, done: boolean) => {
      const previous = task.completedAt;
      writeCompletion(task, done ? new Date().toISOString() : null);
      toggleTaskAction(task.id, done).catch((err) => {
        console.error("[agenda] toggle failed:", err);
        writeCompletion(task, previous);
      });
    },
    [writeCompletion],
  );

  const star = useCallback(
    (taskId: string, important: boolean) => {
      writeTask(taskId, (t) => ({ ...t, important }));
      setTaskImportantAction(taskId, important).catch((err) => {
        console.error("[agenda] important toggle failed:", err);
        writeTask(taskId, (t) => ({ ...t, important: !important }));
      });
    },
    [writeTask],
  );

  const add = useCallback(
    async (title: string, dateStr: string, lineId: string | null) => {
      // The server parses "#tags" and the lone "!" out of the title, so the
      // returned row — not the typed text — is what gets rendered.
      const row = await createAgendaTaskAction(title, dateStr, lineId);
      // A no-op when that week isn't cached, which is the wanted behaviour:
      // it will be fetched with the new task already in it.
      patchWeek(startOfWeek(row.dueAt.slice(0, 10)), (week) => ({
        ...week,
        tasks: insertByDueAt(week.tasks, row),
      }));
    },
    [patchWeek],
  );

  const createLine = useCallback(
    async (name: string) => {
      const line = await createAgendaLineAction(name);
      if (line === null) throw new Error("Invalid line name");
      // Lines ride in every week payload, so every cached week gets the new
      // one; re-pinning an existing tag replaces it instead of doubling it.
      patchWeek(null, (week) => {
        const lines: AgendaLineResult[] = [
          ...week.lines.filter((l) => l.id !== line.id),
          line,
        ];
        return { ...week, lines };
      });
    },
    [patchWeek],
  );

  const refresh = useCallback(() => {
    weeksRef.current.clear();
    icsRef.current.clear();
    setToken((t) => t + 1);
    bump();
  }, [bump]);

  // Both caches live in refs; `version` is the render trigger and belongs in
  // these deps even though the reads below don't name it.
  const week = useMemo(
    () =>
      weekStart === null
        ? null
        : (weeksRef.current.get(weekStart)?.week ?? null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weekStart, version],
  );
  const ics = useMemo(
    () =>
      weekStart === null
        ? EMPTY_ICS
        : (icsRef.current.get(weekStart) ?? EMPTY_ICS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weekStart, version],
  );

  return {
    weekStart,
    week,
    ics,
    loading,
    toggle,
    star,
    add,
    createLine,
    refresh,
  };
}
