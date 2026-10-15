"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getNoteTitlesAction } from "@/app/app/actions";
import {
  EMPTY_PANES,
  activateTab,
  clearFocused,
  closeTab,
  focusPane,
  focusedNote,
  fromLegacyTabs,
  openNote,
  parsePanes,
  retainNotes,
  setRatio,
  setTitle,
  split,
  unsplit,
  type PanesState,
} from "@/lib/editor-panes";

/**
 * The Notes editor's open documents: tabs in one or two panes (rules in
 * src/lib/editor-panes.ts). Persisted to localStorage under its own key — the
 * floating dock is a side window with its own set, and closing a tab in one is
 * not a statement about the other.
 *
 * Which note the FOCUSED pane shows is never restored: the URL already says
 * which document is open, and a restored focus would contradict it. The other
 * pane's active tab is restored (it has no URL of its own).
 *
 * State only, no URL: NotesShell owns the address bar.
 */

const STORAGE_KEY = "agenda.note-panes";
const LEGACY_KEY = "agenda.note-tabs";

export interface EditorPanesApi {
  state: PanesState;
  focusedId: string | null;
  open: (
    id: string,
    title?: string,
    target?: "focused" | "other" | number,
  ) => PanesState;
  activate: (pane: number, id: string) => PanesState;
  focus: (pane: number) => PanesState;
  close: (pane: number, id: string) => PanesState;
  split: () => PanesState;
  unsplit: () => PanesState;
  setTitle: (id: string, title: string) => void;
  setRatio: (ratio: number) => void;
  clearActive: () => void;
}

export function useEditorPanes(): EditorPanesApi {
  const [state, setState] = useState<PanesState>(EMPTY_PANES);
  const [hydrated, setHydrated] = useState(false);
  // Callbacks answer synchronously (the caller updates the URL in the same
  // tick), so they compute from a ref and return the next state.
  const ref = useRef<PanesState>(EMPTY_PANES);
  ref.current = state;

  const apply = useCallback((next: PanesState) => {
    ref.current = next;
    setState(next);
    return next;
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      let restored = raw ? parsePanes(JSON.parse(raw)) : EMPTY_PANES;
      if (!raw) {
        const legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy) {
          restored = fromLegacyTabs(JSON.parse(legacy));
          localStorage.removeItem(LEGACY_KEY);
        }
      }
      // Merge with anything opened before hydration (the route's own note).
      let next = {
        ...restored,
        panes: restored.panes.map((p, i) => ({
          ...p,
          // The focused pane's active tab comes from the URL, not storage.
          active: i === restored.focused ? null : p.active,
        })),
      };
      const live = ref.current;
      for (const p of live.panes)
        for (const t of p.tabs)
          next = openNote(next, t.id, t.title || undefined);
      const liveFocus = focusedNote(live);
      if (liveFocus) next = openNote(next, liveFocus);
      apply(next);
    } catch (err) {
      console.error("[notes] failed to restore tabs:", err);
    }
    setHydrated(true);
  }, [apply]);

  // Restored tabs are only ids — verify once, drop the dead ones and refresh
  // renamed titles. An empty/failed answer changes nothing (an unconfigured
  // DB reads as zero rows; absence of an answer isn't evidence of deletion).
  useEffect(() => {
    if (!hydrated) return;
    const checked = ref.current.panes.flatMap((p) => p.tabs.map((t) => t.id));
    if (checked.length === 0) return;
    let cancelled = false;
    getNoteTitlesAction(checked)
      .then((rows) => {
        if (cancelled || !Array.isArray(rows) || rows.length === 0) return;
        const live = new Map(rows.map((r) => [r.id, r.title]));
        const checkedSet = new Set(checked);
        const keep = new Set(
          ref.current.panes
            .flatMap((p) => p.tabs.map((t) => t.id))
            .filter((id) => !checkedSet.has(id) || live.has(id)),
        );
        let next = retainNotes(ref.current, keep);
        for (const [id, title] of live) next = setTitle(next, id, title);
        if (next !== ref.current) apply(next);
      })
      .catch((err) => console.error("[notes] failed to verify tabs:", err));
    return () => {
      cancelled = true;
    };
  }, [hydrated, apply]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const empty = state.panes.every((p) => p.tabs.length === 0);
      if (empty) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage full/unavailable — tabs still work for this page load.
    }
  }, [hydrated, state]);

  return {
    state,
    focusedId: focusedNote(state),
    open: useCallback(
      (id, title, target) => apply(openNote(ref.current, id, title, target)),
      [apply],
    ),
    activate: useCallback(
      (pane, id) => apply(activateTab(ref.current, pane, id)),
      [apply],
    ),
    focus: useCallback((pane) => apply(focusPane(ref.current, pane)), [apply]),
    close: useCallback(
      (pane, id) => apply(closeTab(ref.current, pane, id)),
      [apply],
    ),
    split: useCallback(() => apply(split(ref.current)), [apply]),
    unsplit: useCallback(() => apply(unsplit(ref.current)), [apply]),
    setTitle: useCallback(
      (id, title) => {
        const next = setTitle(ref.current, id, title);
        if (next !== ref.current) apply(next);
      },
      [apply],
    ),
    setRatio: useCallback(
      (r) => {
        const next = setRatio(ref.current, r);
        if (next !== ref.current) apply(next);
      },
      [apply],
    ),
    clearActive: useCallback(() => {
      const next = clearFocused(ref.current);
      if (next !== ref.current) apply(next);
    }, [apply]),
  };
}
