"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  getNotePreviewsAction,
  type NotePreviewResult,
} from "@/app/app/actions";

/**
 * Batched note-preview loader for linked-note cards. Cards request previews by
 * id; requests landing within one tick are coalesced into a single
 * getNotePreviewsAction call and cached. `invalidate` drops one entry (used
 * when the quick view closes so the originating card refetches).
 *
 * Also home of the quick-view context: cards and widget rows open the floating
 * note panel through it, falling back to route navigation when no provider is
 * mounted (e.g. a daily note opened at /app/notes/[id]).
 */

type PreviewEntry =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; preview: NotePreviewResult };

type PreviewContextValue = {
  entries: Map<string, PreviewEntry>;
  request: (noteId: string) => void;
  invalidate: (noteId: string) => void;
};

const NotePreviewContext = createContext<PreviewContextValue | null>(null);

export const QuickViewContext = createContext<{
  open: (noteId: string) => void;
} | null>(null);

export function NotePreviewProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [entries, setEntries] = useState<Map<string, PreviewEntry>>(new Map());
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const queueRef = useRef<Set<string>>(new Set());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    flushTimerRef.current = null;
    const ids = [...queueRef.current];
    queueRef.current.clear();
    if (ids.length === 0) return;
    setEntries((prev) => {
      const next = new Map(prev);
      for (const id of ids) next.set(id, { status: "loading" });
      return next;
    });
    getNotePreviewsAction(ids)
      .then((rows) => {
        const byId = new Map(rows.map((r) => [r.id, r]));
        setEntries((prev) => {
          const next = new Map(prev);
          for (const id of ids) {
            const preview = byId.get(id);
            next.set(
              id,
              preview ? { status: "ready", preview } : { status: "missing" },
            );
          }
          return next;
        });
      })
      .catch((err) => {
        console.error("[previews] batch load failed:", err);
        // Drop the loading entries so a later request retries.
        setEntries((prev) => {
          const next = new Map(prev);
          for (const id of ids) {
            if (next.get(id)?.status === "loading") next.delete(id);
          }
          return next;
        });
      });
  }, []);

  const request = useCallback(
    (noteId: string) => {
      if (entriesRef.current.has(noteId) || queueRef.current.has(noteId)) {
        return;
      }
      queueRef.current.add(noteId);
      if (flushTimerRef.current === null) {
        flushTimerRef.current = setTimeout(flush, 50);
      }
    },
    [flush],
  );

  const invalidate = useCallback(
    (noteId: string) => {
      setEntries((prev) => {
        if (!prev.has(noteId)) return prev;
        const next = new Map(prev);
        next.delete(noteId);
        return next;
      });
      // Refetch right away — the card is still mounted and wants fresh data.
      queueRef.current.add(noteId);
      if (flushTimerRef.current === null) {
        flushTimerRef.current = setTimeout(flush, 50);
      }
    },
    [flush],
  );

  useEffect(
    () => () => {
      if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current);
    },
    [],
  );

  const value = useMemo(
    () => ({ entries, request, invalidate }),
    [entries, request, invalidate],
  );

  return (
    <NotePreviewContext.Provider value={value}>
      {children}
    </NotePreviewContext.Provider>
  );
}

/**
 * A note's preview from the nearest provider. Returns `undefined` when no
 * provider is mounted (callers fall back to plain navigation affordances).
 */
export function usePreview(noteId: string | null): PreviewEntry | undefined {
  const ctx = useContext(NotePreviewContext);
  useEffect(() => {
    if (ctx && noteId) ctx.request(noteId);
  }, [ctx, noteId]);
  if (!ctx || !noteId) return undefined;
  return ctx.entries.get(noteId) ?? { status: "loading" };
}

/** Imperative invalidation (quick-view close). No-op without a provider. */
export function usePreviewInvalidator() {
  const ctx = useContext(NotePreviewContext);
  return ctx?.invalidate ?? null;
}
