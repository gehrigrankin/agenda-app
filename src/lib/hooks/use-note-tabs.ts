"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getNoteTitlesAction } from "@/app/app/actions";

/**
 * The open-document set behind the main note view's tab strip — the same shape
 * of state the floating dock keeps (NoteDockProvider), under its OWN storage
 * key: the dock is a side window and the note view is the desk, and closing a
 * tab in one is not a statement about the other.
 *
 * Persisted to localStorage rather than sessionStorage for the reason the dock
 * settled on: a tab stays until it is CLOSED, and sessionStorage quietly broke
 * that on every new browser tab and restart.
 *
 * State only, no URL: the caller owns the address bar, because whether a
 * switch is a shallow history update or a real navigation is a routing
 * decision, not a fact about the open set.
 */

export interface NoteTab {
  id: string;
  /** Live title; "" until something authoritative reports one. */
  title: string;
}

const STORAGE_KEY = "agenda.note-tabs";
/** Runaway backstop, not a working limit (matches the dock's MAX_DOCK). */
const MAX_TABS = 24;

export interface NoteTabsApi {
  tabs: NoteTab[];
  activeId: string | null;
  /** Open (or re-focus) a tab. `title` only seeds a brand-new one. */
  open: (id: string, title?: string) => void;
  activate: (id: string) => void;
  /** Closes and returns the id now focused (null when nothing is left). */
  close: (id: string) => string | null;
  setTitle: (id: string, title: string) => void;
  /** Focus nothing (the note view's "no document open" state). */
  clearActive: () => void;
}

export function useNoteTabs(): NoteTabsApi {
  const [tabs, setTabs] = useState<NoteTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Storage loads after mount (SSR renders no tabs either way); don't write
  // back until then or the initial empty state would wipe the entry.
  const [hydrated, setHydrated] = useState(false);
  // Read by callbacks that must answer synchronously (close returns the next
  // focus so the caller can update the URL in the same tick).
  const tabsRef = useRef<NoteTab[]>([]);
  tabsRef.current = tabs;
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Record<string, unknown>;
        const restored = (Array.isArray(saved.tabs) ? saved.tabs : [])
          .filter(
            (t): t is NoteTab =>
              typeof t === "object" && t !== null && typeof t.id === "string",
          )
          .map((t) => ({
            id: t.id,
            title: typeof t.title === "string" ? t.title : "",
          }))
          .slice(-MAX_TABS);
        if (restored.length > 0) {
          // Which tab is FOCUSED is never restored — the URL already says
          // which document is open, and a restored focus would contradict it
          // (a reload of /app/notes would pop an editor nobody asked for).
          const live = tabsRef.current;
          const liveIds = new Set(live.map((t) => t.id));
          setTabs([...restored.filter((t) => !liveIds.has(t.id)), ...live]);
        }
      }
    } catch (err) {
      console.error("[notes] failed to restore tabs:", err);
    }
    setHydrated(true);
  }, []);

  // Restored tabs are only ids — nothing guarantees they still name a live
  // note this owner can see. Verify once and drop the dead ones, refreshing
  // titles renamed since the last load. A failed or empty answer changes
  // nothing: an unconfigured DB reads as zero rows (graceful degradation), and
  // absence of an answer is not evidence a note is gone.
  useEffect(() => {
    if (!hydrated) return;
    const checked = tabsRef.current.map((t) => t.id);
    if (checked.length === 0) return;
    let cancelled = false;
    getNoteTitlesAction(checked)
      .then((rows) => {
        if (cancelled || !Array.isArray(rows) || rows.length === 0) return;
        const live = new Map(rows.map((r) => [r.id, r.title]));
        const checkedIds = new Set(checked);
        const current = tabsRef.current;
        const next = current
          .filter((t) => !checkedIds.has(t.id) || live.has(t.id))
          .map((t) => {
            const title = live.get(t.id);
            return title !== undefined && title !== t.title
              ? { ...t, title }
              : t;
          });
        if (
          next.length === current.length &&
          next.every((t, i) => t === current[i])
        ) {
          return;
        }
        setTabs(next);
        setActiveId((prev) =>
          prev && next.some((t) => t.id === prev) ? prev : null,
        );
      })
      .catch((err) => {
        console.error("[notes] failed to verify restored tabs:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (tabs.length === 0) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs }));
    } catch {
      // Storage full/unavailable — tabs still work for this page load.
    }
  }, [hydrated, tabs]);

  const open = useCallback((id: string, title?: string) => {
    setTabs((prev) => {
      const existing = prev.find((t) => t.id === id);
      if (existing) {
        // Already open: keep its place in the strip (a tab that jumped to the
        // end every time it was focused would make the row unreadable), but
        // take a better title if one arrived with the request.
        if (!title || existing.title === title) return prev;
        return prev.map((t) => (t.id === id ? { ...t, title } : t));
      }
      return [...prev, { id, title: title ?? "" }].slice(-MAX_TABS);
    });
    setActiveId(id);
  }, []);

  const activate = useCallback((id: string) => setActiveId(id), []);

  const close = useCallback((id: string) => {
    const prev = tabsRef.current;
    const index = prev.findIndex((t) => t.id === id);
    const next = prev.filter((t) => t.id !== id);
    tabsRef.current = next;
    setTabs(next);
    if (activeRef.current !== id) return activeRef.current;
    // Focus the neighbour a code editor would: the tab that took its place,
    // else the one before it.
    const fallback = next[index] ?? next[index - 1] ?? next[next.length - 1];
    const nextActive = fallback?.id ?? null;
    activeRef.current = nextActive;
    setActiveId(nextActive);
    return nextActive;
  }, []);

  const setTitle = useCallback((id: string, title: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id && t.title !== title ? { ...t, title } : t)),
    );
  }, []);

  const clearActive = useCallback(() => setActiveId(null), []);

  return { tabs, activeId, open, activate, close, setTitle, clearActive };
}
