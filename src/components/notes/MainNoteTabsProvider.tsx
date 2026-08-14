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

import { getNoteTitlesAction } from "@/app/app/actions";
import { pickTabFallback } from "@/lib/tab-fallback";
import type { TabStripNote } from "./NoteTabStrip";

/**
 * Tab state for the main note view (`/app/notes/[id]`) — the dock's tab strip
 * (Turn: floating panel gets IDE tabs), brought to the primary route.
 *
 * Simpler than NoteDockProvider because each note is still its own route:
 * "activating" a tab is a navigation the caller performs (NotesShell has the
 * router), not state this provider owns. A note becomes a tab the moment its
 * page mounts (see MainNoteTabSync below) — no individual click handler had
 * to opt in, so every way of reaching a note (list row, backlink, [[link]],
 * context menu, daily note) gets tabs for free.
 *
 * Hosted inside NotesShell, which the /app/notes layout renders — layouts
 * don't remount on child navigation, so this survives switching notes with no
 * help needed. sessionStorage is only for surviving a hard reload, same
 * reasoning as the dock (per-tab, not per-account: matches "what I had open"
 * in *this* browser tab).
 */

const MAX_MAIN_TABS = 8;
const STORAGE_KEY = "agenda.note-main-tabs";

type MainNoteTabsValue = {
  tabs: TabStripNote[];
  /** Add a tab for `id` (or refresh its title if it's already open). */
  reportOpen: (id: string, title: string) => void;
  /**
   * Remove a tab. Returns the id to navigate to when `activeId` was the tab
   * that closed (`null` means no tabs are left — go to the notes index), or
   * `undefined` when a background tab closed and there's nothing to navigate.
   */
  close: (id: string, activeId: string | null) => string | null | undefined;
};

const MainNoteTabsContext = createContext<MainNoteTabsValue | null>(null);

export function useMainNoteTabs() {
  return useContext(MainNoteTabsContext);
}

export function MainNoteTabsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [tabs, setTabs] = useState<TabStripNote[]>([]);
  // Storage loads after mount; don't write back until then or the initial
  // empty state would wipe a previously saved entry.
  const [hydrated, setHydrated] = useState(false);
  const tabsRef = useRef<TabStripNote[]>([]);
  tabsRef.current = tabs;

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as unknown;
        const restored = (Array.isArray(saved) ? saved : [])
          .filter(
            (n): n is { id: string; title: unknown } =>
              typeof n === "object" && n !== null && typeof (n as { id?: unknown }).id === "string",
          )
          .map((n) => ({
            id: n.id,
            title: typeof n.title === "string" ? n.title : "",
          }))
          .slice(-MAX_MAIN_TABS);
        if (restored.length > 0) setTabs(restored);
      }
    } catch (err) {
      console.error("[main-tabs] failed to restore:", err);
    }
    setHydrated(true);
  }, []);

  // Verify the restored set once and drop dead tabs — same reasoning as the
  // dock: a note trashed elsewhere, or an owner swap, shouldn't leave a tab
  // that greets every reload with a 404. A failed check leaves tabs alone.
  useEffect(() => {
    if (!hydrated) return;
    const checked = tabsRef.current.map((t) => t.id);
    if (checked.length === 0) return;
    let cancelled = false;
    getNoteTitlesAction(checked)
      .then((rows) => {
        if (cancelled) return;
        const live = new Map(rows.map((r) => [r.id, r.title]));
        const checkedIds = new Set(checked);
        setTabs((current) =>
          current
            .filter((t) => !checkedIds.has(t.id) || live.has(t.id))
            .map((t) => {
              const title = live.get(t.id);
              return title !== undefined && title !== t.title
                ? { ...t, title }
                : t;
            }),
        );
      })
      .catch((err) => {
        console.error("[main-tabs] failed to verify restored tabs:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (tabs.length === 0) sessionStorage.removeItem(STORAGE_KEY);
      else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
    } catch {
      // Storage full/unavailable — tabs still work for this page load.
    }
  }, [hydrated, tabs]);

  const reportOpen = useCallback((id: string, title: string) => {
    setTabs((prev) => {
      const existing = prev.find((t) => t.id === id);
      if (existing) {
        // Re-visiting an already-open tab (clicking it, or navigating back
        // to it) must not reorder the strip — only a genuinely new tab goes
        // on the end.
        return existing.title === title
          ? prev
          : prev.map((t) => (t.id === id ? { ...t, title } : t));
      }
      return [...prev, { id, title }].slice(-MAX_MAIN_TABS);
    });
  }, []);

  const close = useCallback(
    (id: string, activeId: string | null): string | null | undefined => {
      setTabs((prev) => prev.filter((t) => t.id !== id));
      if (activeId !== id) return undefined;
      return pickTabFallback(tabsRef.current, id);
    },
    [],
  );

  const value = useMemo(
    () => ({ tabs, reportOpen, close }),
    [tabs, reportOpen, close],
  );

  return (
    <MainNoteTabsContext.Provider value={value}>
      {children}
    </MainNoteTabsContext.Provider>
  );
}

/**
 * Registers the currently rendered note page as a tab. Rendered by the
 * `/app/notes/[id]` page (a server component) so it can report the
 * server-loaded title straight away — no client fetch needed, unlike the
 * dock, which only learns a note's title once its own client-side load
 * resolves.
 */
export function MainNoteTabSync({ id, title }: { id: string; title: string }) {
  const ctx = useMainNoteTabs();
  useEffect(() => {
    ctx?.reportOpen(id, title);
  }, [ctx, id, title]);
  return null;
}
