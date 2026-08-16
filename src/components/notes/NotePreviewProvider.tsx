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

import type { SerializedLexicalNode } from "lexical";

import {
  getNotePreviewsAction,
  type NotePreviewResult,
} from "@/app/app/actions";
import {
  cardAnchorSectionBlocks,
  replaceCardAnchorSection,
} from "@/lib/card-anchors";

/**
 * Batched note-preview loader for linked-note cards. Cards request previews by
 * id; requests landing within one tick are coalesced into a single
 * getNotePreviewsAction call and cached. `invalidate` drops one entry (used
 * when the quick view closes so the originating card refetches).
 *
 * The preview carries the target note's whole `content`, which makes it the
 * source for SCOPED card bodies too (`useCardSection`): a card's section is a
 * pure slice of that content, so slicing it here costs nothing and spares the
 * app one `getCardSectionAction` (a full note read) per card per mount. The
 * daily widget's day-flip remounts every card, hence the module-level cache —
 * it outlives the provider, not just the card.
 *
 * Also home of the quick-view context: cards and widget rows open the floating
 * note panel through it, falling back to route navigation when no provider is
 * mounted (e.g. a daily note opened at /app/notes/[id]).
 */

type PreviewEntry =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; preview: NotePreviewResult };

/** One card's slice of a target note. */
export type CardSectionEntry =
  | { status: "loading" }
  /** The note is gone, or the anchor is no longer in it. */
  | { status: "detached" }
  | { status: "ready"; blocks: SerializedLexicalNode[] }
  /** No provider mounted — the caller has to fetch for itself. */
  | { status: "unavailable" };

type PreviewContextValue = {
  entries: Map<string, PreviewEntry>;
  request: (noteId: string) => void;
  invalidate: (noteId: string) => void;
  publishSection: (
    noteId: string,
    anchorId: string,
    blocks: SerializedLexicalNode[],
  ) => void;
};

/**
 * Terminal entries only, kept outside React so a remounting provider (or a
 * remounting card tree) reuses what was already fetched. Cleared entry-by-entry
 * through `invalidate`, same as the in-render map.
 */
const previewCache = new Map<string, PreviewEntry>();

const NotePreviewContext = createContext<PreviewContextValue | null>(null);

export const QuickViewContext = createContext<{
  open: (noteId: string) => void;
} | null>(null);

export function NotePreviewProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [entries, setEntries] = useState<Map<string, PreviewEntry>>(
    () => new Map(previewCache),
  );
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
            const entry: PreviewEntry = preview
              ? { status: "ready", preview }
              : { status: "missing" };
            next.set(id, entry);
            previewCache.set(id, entry);
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
      previewCache.delete(noteId);
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

  // Keeps the cached copy of the target note in step with what a card just
  // wrote into it. Without this a remount (day flip) would rehydrate the card
  // from the pre-save slice and look like the writing was lost.
  const publishSection = useCallback(
    (noteId: string, anchorId: string, blocks: SerializedLexicalNode[]) => {
      setEntries((prev) => {
        const entry = prev.get(noteId);
        if (entry?.status !== "ready") return prev;
        const content = replaceCardAnchorSection(
          entry.preview.content,
          anchorId,
          blocks,
        );
        if (!content) return prev;
        const updated: PreviewEntry = {
          status: "ready",
          preview: {
            ...entry.preview,
            content,
            updatedAt: new Date().toISOString(),
          },
        };
        previewCache.set(noteId, updated);
        const next = new Map(prev);
        next.set(noteId, updated);
        return next;
      });
    },
    [],
  );

  useEffect(
    () => () => {
      if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current);
    },
    [],
  );

  const value = useMemo(
    () => ({ entries, request, invalidate, publishSection }),
    [entries, request, invalidate, publishSection],
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

/**
 * The blocks a scoped card owns, sliced out of the batched preview — no extra
 * server round trip, and cached across mounts. `unavailable` means no provider
 * is mounted and the caller should fall back to `getCardSectionAction`.
 */
export function useCardSection(
  noteId: string | null,
  anchorId: string | null,
): CardSectionEntry {
  const ctx = useContext(NotePreviewContext);
  const entry = usePreview(noteId);
  return useMemo(() => {
    if (!ctx) return { status: "unavailable" };
    if (!noteId || !anchorId) return { status: "detached" };
    if (entry === undefined || entry.status === "loading") {
      return { status: "loading" };
    }
    if (entry.status === "missing") return { status: "detached" };
    const blocks = cardAnchorSectionBlocks(entry.preview.content, anchorId);
    // null = the anchor isn't in that note (deleted over there); an empty array
    // is a real, untouched section.
    return blocks ? { status: "ready", blocks } : { status: "detached" };
  }, [ctx, noteId, anchorId, entry]);
}

/**
 * Write a card's just-saved blocks back into the cached copy of the target
 * note. Call it after `saveCardSectionAction` succeeds. No-op without a
 * provider.
 */
export function usePublishCardSection(): (
  noteId: string,
  anchorId: string,
  blocks: SerializedLexicalNode[],
) => void {
  const ctx = useContext(NotePreviewContext);
  return useMemo(
    () => ctx?.publishSection ?? (() => {}),
    [ctx],
  );
}

/** Imperative invalidation (quick-view close). No-op without a provider. */
export function usePreviewInvalidator() {
  const ctx = useContext(NotePreviewContext);
  return ctx?.invalidate ?? null;
}
