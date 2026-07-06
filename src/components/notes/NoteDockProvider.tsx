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
import { usePathname } from "next/navigation";

import { NoteDock, type DockNote } from "./NoteDock";
import {
  NotePreviewProvider,
  QuickViewContext,
  usePreviewInvalidator,
} from "./NotePreviewProvider";

/**
 * Shell-level owner of the note dock. The dock used to live in HomeClient,
 * which meant open tabs vanished on any navigation; hosting the state here —
 * inside the persistent /app layout — keeps windows and pills alive across
 * /app, /app/notes, /app/tasks, etc. State also round-trips through
 * sessionStorage so a hard reload restores the tabs (per browser tab, which
 * matches "windows I had open", unlike localStorage).
 *
 * Split into a state provider and a <NoteDockHost /> render slot because the
 * dock is absolutely positioned: the provider wraps the shell subtree while
 * the host must sit inside the shell's relative content area.
 */

/** Dock capacity: three floating note windows fit side by side at xl. */
const MAX_DOCK = 3;
const STORAGE_KEY = "agenda.note-dock";

type CloseListener = (noteId: string) => void;

type NoteDockValue = {
  notes: DockNote[];
  expandedIds: Set<string>;
  /** Open a note as a dock window (re-opening an existing tab expands it). */
  open: (noteId: string) => void;
  toggle: (id: string) => void;
  close: (id: string) => void;
  setTitle: (id: string, title: string) => void;
  /** Subscribe to tab closes (home widgets refresh previews). Returns unsubscribe. */
  onClose: (listener: CloseListener) => () => void;
};

const NoteDockContext = createContext<NoteDockValue | null>(null);

export function useNoteDock() {
  return useContext(NoteDockContext);
}

export function NoteDockProvider({ children }: { children: React.ReactNode }) {
  const [notes, setNotes] = useState<DockNote[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // Storage loads after mount (SSR renders an empty dock either way); don't
  // write back until then or the initial empty state would wipe the entry.
  const [hydrated, setHydrated] = useState(false);
  const listenersRef = useRef(new Set<CloseListener>());

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as {
          notes?: unknown;
          expanded?: unknown;
        };
        const restored = (Array.isArray(saved.notes) ? saved.notes : [])
          .filter(
            (n): n is DockNote =>
              typeof n === "object" && n !== null && typeof n.id === "string",
          )
          .map((n) => ({
            id: n.id,
            title: typeof n.title === "string" ? n.title : "",
          }))
          .slice(-MAX_DOCK);
        if (restored.length > 0) {
          const ids = new Set(restored.map((n) => n.id));
          setNotes(restored);
          setExpandedIds(
            new Set(
              (Array.isArray(saved.expanded) ? saved.expanded : []).filter(
                (id): id is string => typeof id === "string" && ids.has(id),
              ),
            ),
          );
        }
      }
    } catch (err) {
      console.error("[dock] failed to restore:", err);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (notes.length === 0) {
        sessionStorage.removeItem(STORAGE_KEY);
      } else {
        sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ notes, expanded: [...expandedIds] }),
        );
      }
    } catch {
      // Storage full/unavailable — the dock still works for this page load.
    }
  }, [hydrated, notes, expandedIds]);

  const open = useCallback((noteId: string) => {
    setNotes((prev) => {
      const existing = prev.find((n) => n.id === noteId);
      const without = prev.filter((n) => n.id !== noteId);
      // Newest on the right; oldest drops when the dock is full.
      return [
        ...without,
        { id: noteId, title: existing?.title ?? "" },
      ].slice(-MAX_DOCK);
    });
    setExpandedIds((prev) => new Set(prev).add(noteId));
  }, []);

  // Windows report their real title once loaded (tabs start blank).
  const setTitle = useCallback((id: string, title: string) => {
    setNotes((prev) =>
      prev.map((n) => (n.id === id && n.title !== title ? { ...n, title } : n)),
    );
  }, []);

  const toggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const close = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    for (const listener of listenersRef.current) listener(id);
  }, []);

  const onClose = useCallback((listener: CloseListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  // A note viewed full-page must leave the dock: now that the dock survives
  // navigation, keeping it open would mount two live editors on one note,
  // whose debounced whole-document autosaves silently clobber each other.
  const pathname = usePathname();
  useEffect(() => {
    const match = pathname?.match(/^\/app\/notes\/([^/]+)$/);
    if (match && notes.some((n) => n.id === match[1])) close(match[1]);
  }, [pathname, notes, close]);

  const value = useMemo(
    () => ({ notes, expandedIds, open, toggle, close, setTitle, onClose }),
    [notes, expandedIds, open, toggle, close, setTitle, onClose],
  );

  return (
    <NoteDockContext.Provider value={value}>
      {children}
    </NoteDockContext.Provider>
  );
}

/**
 * Renders the dock overlay; place inside the shell's relative content area.
 * Dock windows host full NoteEditors, so they need their own preview and
 * quick-view providers (they render outside any page's): note links inside a
 * window open beside it in the dock, and linked-note cards load previews.
 */
export function NoteDockHost() {
  const dock = useNoteDock();
  const dockOpen = dock?.open;
  const quickView = useMemo(
    () => (dockOpen ? { open: dockOpen } : null),
    [dockOpen],
  );
  if (!dock) return null;
  return (
    <NotePreviewProvider>
      <QuickViewContext.Provider value={quickView}>
        <DockCloseInvalidator />
        <NoteDock
          notes={dock.notes}
          expandedIds={dock.expandedIds}
          onToggle={dock.toggle}
          onClose={dock.close}
          onTitle={dock.setTitle}
        />
      </QuickViewContext.Provider>
    </NotePreviewProvider>
  );
}

/** Keeps cards in the remaining dock windows fresh when a sibling tab closes. */
function DockCloseInvalidator() {
  const dock = useNoteDock();
  const invalidate = usePreviewInvalidator();
  const subscribe = dock?.onClose;
  useEffect(() => {
    if (!subscribe || !invalidate) return;
    return subscribe(invalidate);
  }, [subscribe, invalidate]);
  return null;
}
