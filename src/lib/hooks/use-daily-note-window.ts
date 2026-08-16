"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SerializedEditorState } from "lexical";

import {
  getDailyNoteAction,
  getDailyNoteWindowAction,
  getOrCreateTodayNoteAction,
} from "@/app/app/actions";
import { addDays } from "@/lib/dates";
import {
  dailyWindowValues,
  DAY_WINDOW,
  windowDates,
} from "@/lib/daily-note-window";
import {
  indexedDbViewCache,
  viewCacheKey,
} from "@/lib/indexeddb-cache";
import { NOTE_CONTENT_EXTERNALLY_CHANGED } from "@/lib/live-note-append";

/**
 * Daily notes around the viewed day. The active day gets the first request;
 * all fourteen neighbors arrive in one range request, while owner-scoped
 * IndexedDB entries let a previously seen window paint before either returns.
 */

export type DailyNote = {
  id: string;
  title: string;
  content: SerializedEditorState | null;
  contentRevision: number;
};

/** `undefined` = loading; `null` = fetched and no note exists. */
export type CachedDay = DailyNote | null | undefined;

export function useDailyNoteWindow(
  viewed: string | null,
  today: string | null,
  cacheScope: string,
) {
  const [cache, setCache] = useState<Map<string, DailyNote | null>>(
    () => new Map(),
  );
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const locallyChanged = useRef(new Set<string>());

  const cacheKey = useCallback(
    (dateStr: string) =>
      viewCacheKey(cacheScope, "daily-note-window", dateStr),
    [cacheScope],
  );

  const persist = useCallback(
    (dateStr: string, note: DailyNote | null) => {
      void indexedDbViewCache
        .write(cacheKey(dateStr), { value: note, updatedAt: Date.now() })
        .catch(() => undefined);
    },
    [cacheKey],
  );

  const put = useCallback(
    (dateStr: string, note: DailyNote | null) => {
      locallyChanged.current.add(dateStr);
      setCache((prev) => {
        const next = new Map(prev);
        next.set(dateStr, note);
        return next;
      });
      persist(dateStr, note);
    },
    [persist],
  );

  useEffect(() => {
    if (!viewed || !today) return;
    let cancelled = false;
    const dates = windowDates(viewed);
    const start = addDays(viewed, -DAY_WINDOW);
    const end = addDays(viewed, DAY_WINDOW);

    void Promise.all(
      dates.map(async (date) => ({
        date,
        entry: await indexedDbViewCache
          .read<DailyNote | null>(cacheKey(date))
          .catch(() => null),
      })),
    ).then((entries) => {
      if (cancelled) return;
      setCache((prev) => {
        const next = new Map(prev);
        for (const { date, entry } of entries) {
          if (entry && !next.has(date)) next.set(date, entry.value);
        }
        return next;
      });
    });

    const fetchViewedThenWindow = async () => {
      try {
        const note =
          viewed === today
            ? await getOrCreateTodayNoteAction(viewed)
            : await getDailyNoteAction(viewed);
        if (!cancelled && !locallyChanged.current.has(viewed)) {
          setCache((prev) => new Map(prev).set(viewed, note));
          persist(viewed, note);
        }
      } catch (err) {
        console.error(`[daily] active-day load failed for ${viewed}:`, err);
      }

      try {
        const rows = await getDailyNoteWindowAction(start, end, today);
        if (cancelled) return;
        const values = dailyWindowValues(dates, rows);
        setCache((prev) => {
          const next = new Map(prev);
          for (const [date, note] of values) {
            if (!locallyChanged.current.has(date)) next.set(date, note);
          }
          return next;
        });
        for (const [date, note] of values) {
          if (!locallyChanged.current.has(date)) persist(date, note);
        }
      } catch (err) {
        console.error(`[daily] window load failed for ${start}..${end}:`, err);
      }
    };
    void fetchViewedThenWindow();

    return () => {
      cancelled = true;
    };
  }, [viewed, today, cacheKey, persist]);

  const get = useCallback(
    (dateStr: string | null): CachedDay =>
      dateStr === null ? undefined : cache.get(dateStr),
    [cache],
  );

  /** Preserve the live editor document before flipping away, in memory and
   * IndexedDB, so a warm cache can never autosave an older document later. */
  const snapshot = useCallback(
    (dateStr: string, content: SerializedEditorState | null) => {
      const existing = cacheRef.current.get(dateStr);
      if (!existing) return;
      existing.content = content;
      locallyChanged.current.add(dateStr);
      persist(dateStr, existing);
    },
    [persist],
  );

  const invalidate = useCallback(
    (dateStr: string) => {
      locallyChanged.current.delete(dateStr);
      setCache((prev) => {
        if (!prev.has(dateStr)) return prev;
        const next = new Map(prev);
        next.delete(dateStr);
        return next;
      });
      void indexedDbViewCache.delete(cacheKey(dateStr)).catch(() => undefined);
    },
    [cacheKey],
  );

  // A selection-toolbar move writes the target day on the server. The
  // prefetch copy is now stale; serving it on the next flip would remount
  // the pre-move document and autosave it over the landing.
  useEffect(() => {
    const onExternal = (e: Event) => {
      const noteId = (e as CustomEvent<{ noteId?: string }>).detail?.noteId;
      if (!noteId) return;
      for (const [dateStr, note] of cacheRef.current) {
        if (note?.id === noteId) invalidate(dateStr);
      }
    };
    window.addEventListener(NOTE_CONTENT_EXTERNALLY_CHANGED, onExternal);
    return () => {
      window.removeEventListener(NOTE_CONTENT_EXTERNALLY_CHANGED, onExternal);
    };
  }, [invalidate]);

  return { get, put, snapshot, invalidate };
}
