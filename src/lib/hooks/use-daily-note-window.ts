"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SerializedEditorState } from "lexical";

import {
  getDailyNoteAction,
  getOrCreateTodayNoteAction,
} from "@/app/app/actions";
import { addDays } from "@/lib/dates";
import { NOTE_CONTENT_EXTERNALLY_CHANGED } from "@/lib/live-note-append";

/**
 * The daily notes around the day you're reading, kept warm so flipping days is
 * instant.
 *
 * The home used to change days by navigating (`/app?d=…`), which meant a server
 * round trip and a skeleton on every flip — fine for the occasional jump, awful
 * for paging back through the week, which is the whole point of an agenda. So
 * the window fetches ahead instead: the viewed day first, then its neighbours
 * outward, and every day it has already seen is served from memory.
 *
 * Fetching is SEQUENTIAL, one request at a time, deliberately. Fourteen
 * parallel server actions would saturate the connection and make the day you
 * actually asked for arrive later, not sooner. Nearest-first ordering means the
 * days you're most likely to flip to land first, and each one is dropped into
 * the cache the moment it returns rather than waiting on the batch.
 */

export type DailyNote = {
  id: string;
  title: string;
  content: SerializedEditorState | null;
};

/** How far either side of the viewed day we keep warm. */
export const DAY_WINDOW = 7;

/**
 * `undefined` = not fetched yet (render a skeleton), `null` = fetched and there
 * is no note for that day (render the empty state). The distinction is the
 * difference between "loading" and "nothing was written", which the empty state
 * says out loud.
 */
export type CachedDay = DailyNote | null | undefined;

/**
 * Days to fetch around `center`, nearest first: center, −1, +1, −2, +2 …
 * Past leads each pair — you look backwards more often than forwards.
 */
function windowDates(center: string): string[] {
  const out = [center];
  for (let i = 1; i <= DAY_WINDOW; i++) {
    out.push(addDays(center, -i), addDays(center, i));
  }
  return out;
}

export function useDailyNoteWindow(viewed: string | null, today: string | null) {
  const [cache, setCache] = useState<Map<string, DailyNote | null>>(
    () => new Map(),
  );
  // Read inside the fetch loop without making the effect depend on it — the
  // loop must not restart every time a day lands in the cache.
  const cacheRef = useRef(cache);
  cacheRef.current = cache;

  const put = useCallback((dateStr: string, note: DailyNote | null) => {
    setCache((prev) => {
      const next = new Map(prev);
      next.set(dateStr, note);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!viewed || !today) return;
    let cancelled = false;

    const run = async () => {
      for (const dateStr of windowDates(viewed)) {
        if (cancelled) return;
        if (cacheRef.current.has(dateStr)) continue;
        try {
          // Today's row is get-or-created; every other day is READ ONLY.
          // Prefetching must never bring daily notes into existence for days
          // the user merely paged past — that would fill the calendar with
          // empty notes for a week they never wrote in.
          const note =
            dateStr === today
              ? await getOrCreateTodayNoteAction(dateStr)
              : await getDailyNoteAction(dateStr);
          if (cancelled) return;
          put(dateStr, note);
        } catch (err) {
          console.error(`[daily] prefetch failed for ${dateStr}:`, err);
          // Leave it uncached so flipping to it retries, rather than caching a
          // network blip as "this day is empty".
          if (cancelled) return;
        }
      }
    };
    void run();

    return () => {
      cancelled = true;
    };
  }, [viewed, today, put]);

  const get = useCallback(
    (dateStr: string | null): CachedDay =>
      dateStr === null ? undefined : cache.get(dateStr),
    [cache],
  );

  /**
   * Fold the editor's current document back into the cached day as you flip
   * away from it.
   *
   * Without this, the cache is a trap: you write in Tuesday, flip to Monday and
   * back, and the editor remounts from the copy fetched before you typed —
   * showing stale text and then autosaving it over the good version. The
   * autosave has flushed by then, so the server is right; it's the cache that
   * has to catch up.
   *
   * MUTATES the cached note rather than replacing it, deliberately — no
   * setState, so no re-render on a flip. Safe because `content` is only ever
   * read when the editor mounts, and a mount always happens after this.
   */
  const snapshot = useCallback(
    (dateStr: string, content: SerializedEditorState | null) => {
      const existing = cacheRef.current.get(dateStr);
      if (existing) existing.content = content;
    },
    [],
  );

  /** Drop a day so the next visit refetches it (used when a snapshot can't be
   * taken — better one load than silently serving a stale document). */
  const invalidate = useCallback((dateStr: string) => {
    setCache((prev) => {
      if (!prev.has(dateStr)) return prev;
      const next = new Map(prev);
      next.delete(dateStr);
      return next;
    });
  }, []);

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
