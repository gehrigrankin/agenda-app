"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getAgendaWeekAction,
  type AgendaWeekResult,
} from "@/app/app/actions";
import { listIcsEventsForRangeAction } from "@/app/app/calendar/actions";
import { TASKS_CHANGED_EVENT } from "@/components/layout/NavRail";
import type { RangeCalendarEvent } from "@/server/calendar";
import { addDays, startOfWeek } from "@/lib/dates";

/**
 * The agenda's data layer: one request per week, held in a cache the whole page
 * shares. The week strip and the opened day are two views of the same seven
 * days, so they must never fetch separately, or the two would drift. Writes
 * happen elsewhere (the rail's tasks widget, the note's task nodes) and are
 * announced with TASKS_CHANGED_EVENT, which invalidates every cached week and
 * refetches the viewed one without flicker.
 *
 * Weeks are kept in a ref-held map (a version counter in state is what
 * re-renders). Flipping to an already-cached week paints instantly; the
 * neighbours are prefetched behind the viewed week so arrow-key paging feels
 * free.
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

  return { weekStart, week, ics, loading, refresh };
}
