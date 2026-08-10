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

import { getNoteTitlesAction } from "@/app/app/actions";
import { NoteDock, type DockNote, type DockSize } from "./NoteDock";
import {
  NotePreviewProvider,
  QuickViewContext,
  usePreviewInvalidator,
} from "./NotePreviewProvider";

/**
 * Shell-level owner of the note dock. The dock used to live in HomeClient,
 * which meant open tabs vanished on any navigation; hosting the state here —
 * inside the persistent /app layout — keeps the window alive across /app,
 * /app/notes, /app/tasks, etc. State also round-trips through sessionStorage
 * so a hard reload restores it (per browser tab, which matches "what I had
 * open", unlike localStorage).
 *
 * ONE window, TABBED, like a code editor: opening a note adds a tab and
 * focuses it, and only the focused tab mounts an editor. That replaced a row
 * of side-by-side windows — three floating editors ate the screen they were
 * floating over, and the row had no answer for a fourth note. Size is the
 * user's: two presets plus a free drag from the top-left corner (the window is
 * anchored bottom-right, so that corner is the one that grows it).
 *
 * Split into a state provider and a <NoteDockHost /> render slot because the
 * dock is absolutely positioned: the provider wraps the shell subtree while
 * the host must sit inside the shell's relative content area.
 */

/** Tab capacity. Beyond this the oldest tab drops, as a browser's would not. */
const MAX_DOCK = 8;
const STORAGE_KEY = "agenda.note-dock";

type CloseListener = (noteId: string) => void;

export type DockPreset = "large" | "compact";

type NoteDockValue = {
  notes: DockNote[];
  /** The tab showing an editor; null only when there are no tabs. */
  activeId: string | null;
  minimized: boolean;
  preset: DockPreset;
  /** Explicit pixel size from a drag; null means "use the preset". */
  size: DockSize | null;
  /**
   * Open a note as a tab and focus it (re-opening an existing tab just focuses
   * it). `title` seeds the label immediately for brand-new tabs; it's ignored
   * once a tab has one (the editor's own load reports the authoritative title).
   */
  open: (noteId: string, title?: string) => void;
  activate: (id: string) => void;
  close: (id: string) => void;
  closeAll: () => void;
  setTitle: (id: string, title: string) => void;
  setMinimized: (minimized: boolean) => void;
  setPreset: (preset: DockPreset) => void;
  setSize: (size: DockSize | null) => void;
  /** Subscribe to tab closes (home widgets refresh previews). Returns unsubscribe. */
  onClose: (listener: CloseListener) => () => void;
};

const NoteDockContext = createContext<NoteDockValue | null>(null);

export function useNoteDock() {
  return useContext(NoteDockContext);
}

export function NoteDockProvider({ children }: { children: React.ReactNode }) {
  const [notes, setNotes] = useState<DockNote[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [preset, setPreset] = useState<DockPreset>("large");
  const [size, setSize] = useState<DockSize | null>(null);
  // Storage loads after mount (SSR renders an empty dock either way); don't
  // write back until then or the initial empty state would wipe the entry.
  const [hydrated, setHydrated] = useState(false);
  const listenersRef = useRef(new Set<CloseListener>());
  // Read by effects that must not re-run just because a tab was renamed.
  const notesRef = useRef<DockNote[]>([]);
  notesRef.current = notes;

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Record<string, unknown>;
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
          setActiveId(
            typeof saved.activeId === "string" && ids.has(saved.activeId)
              ? saved.activeId
              : restored[restored.length - 1].id,
          );
          setMinimized(saved.minimized === true);
          if (saved.preset === "compact") setPreset("compact");
          const s = saved.size as { w?: unknown; h?: unknown } | undefined;
          if (s && typeof s.w === "number" && typeof s.h === "number") {
            setSize({ w: s.w, h: s.h });
          }
        }
      }
    } catch (err) {
      console.error("[dock] failed to restore:", err);
    }
    setHydrated(true);
  }, []);

  // Restored tabs are only ids in sessionStorage — nothing guarantees they
  // still name a live note this owner can see. A note trashed elsewhere, or a
  // sign-in that swapped the owner out from under a browser tab, used to leave
  // a tab that greeted every reload with "this note isn't available" and could
  // only be dismissed by hand. Verify the restored set once and drop the dead
  // ones (a failed check leaves the tabs alone — absence of an answer is not
  // evidence the note is gone). Tabs opened after this fires are untouched, and
  // the round-trip also refreshes titles that were renamed since the last load.
  useEffect(() => {
    if (!hydrated) return;
    const checked = notesRef.current.map((n) => n.id);
    if (checked.length === 0) return;
    let cancelled = false;
    getNoteTitlesAction(checked)
      .then((rows) => {
        if (cancelled) return;
        const live = new Map(rows.map((r) => [r.id, r.title]));
        const checkedIds = new Set(checked);
        const current = notesRef.current;
        const next = current
          .filter((n) => !checkedIds.has(n.id) || live.has(n.id))
          .map((n) => {
            const title = live.get(n.id);
            return title !== undefined && title !== n.title
              ? { ...n, title }
              : n;
          });
        if (
          next.length === current.length &&
          next.every((n, i) => n === current[i])
        ) {
          return;
        }
        setNotes(next);
        setActiveId((prev) =>
          prev && next.some((n) => n.id === prev)
            ? prev
            : (next[next.length - 1]?.id ?? null),
        );
      })
      .catch((err) => {
        console.error("[dock] failed to verify restored tabs:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (notes.length === 0) {
        sessionStorage.removeItem(STORAGE_KEY);
      } else {
        sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ notes, activeId, minimized, preset, size }),
        );
      }
    } catch {
      // Storage full/unavailable — the dock still works for this page load.
    }
  }, [hydrated, notes, activeId, minimized, preset, size]);

  const open = useCallback((noteId: string, title?: string) => {
    setNotes((prev) => {
      const existing = prev.find((n) => n.id === noteId);
      const without = prev.filter((n) => n.id !== noteId);
      // Newest on the right; the oldest tab drops when the strip is full.
      return [
        ...without,
        { id: noteId, title: existing?.title ?? title ?? "" },
      ].slice(-MAX_DOCK);
    });
    setActiveId(noteId);
    setMinimized(false);
  }, []);

  // Windows report their real title once loaded (tabs start blank).
  const setTitle = useCallback((id: string, title: string) => {
    setNotes((prev) =>
      prev.map((n) => (n.id === id && n.title !== title ? { ...n, title } : n)),
    );
  }, []);

  const activate = useCallback((id: string) => {
    setActiveId(id);
    setMinimized(false);
  }, []);

  const close = useCallback((id: string) => {
    setNotes((prev) => {
      const next = prev.filter((n) => n.id !== id);
      setActiveId((current) => {
        if (current !== id) return current;
        // Focus the neighbour a code editor would: the tab that took its place,
        // else the one before it.
        const index = prev.findIndex((n) => n.id === id);
        const fallback =
          next[index] ?? next[index - 1] ?? next[next.length - 1];
        return fallback?.id ?? null;
      });
      return next;
    });
    for (const listener of listenersRef.current) listener(id);
  }, []);

  const closeAll = useCallback(() => {
    const ids = notesRef.current.map((n) => n.id);
    setNotes([]);
    setActiveId(null);
    setMinimized(false);
    for (const id of ids) {
      for (const listener of listenersRef.current) listener(id);
    }
  }, []);

  const onClose = useCallback((listener: CloseListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  // A note viewed full-page must not also have a live editor in the dock: two
  // editors on one note would have debounced whole-document autosaves silently
  // clobber each other. The TAB stays — users rely on tabs staying put — but
  // focus moves to another one, and NoteDock refuses to mount an editor for
  // the page's own note if it's the only tab left.
  const pathname = usePathname();
  const pageNoteId = pathname?.match(/^\/app\/notes\/([^/]+)$/)?.[1] ?? null;
  useEffect(() => {
    if (!pageNoteId) return;
    setActiveId((prev) => {
      if (prev !== pageNoteId) return prev;
      const others = notesRef.current.filter((n) => n.id !== pageNoteId);
      return others.length > 0 ? others[others.length - 1].id : prev;
    });
  }, [pageNoteId]);

  const value = useMemo(
    () => ({
      notes,
      activeId,
      minimized,
      preset,
      size,
      open,
      activate,
      close,
      closeAll,
      setTitle,
      setMinimized,
      setPreset,
      setSize,
      onClose,
    }),
    [
      notes,
      activeId,
      minimized,
      preset,
      size,
      open,
      activate,
      close,
      closeAll,
      setTitle,
      onClose,
    ],
  );

  return (
    <NoteDockContext.Provider value={value}>
      {children}
    </NoteDockContext.Provider>
  );
}

/**
 * Renders the dock overlay; place inside the shell's relative content area.
 * The dock hosts a full NoteEditor, so it needs its own preview and quick-view
 * providers (it renders outside any page's): note links inside it open as
 * further tabs, and linked-note cards load previews.
 */
export function NoteDockHost() {
  const dock = useNoteDock();
  const dockOpen = dock?.open;
  const quickView = useMemo(
    () => (dockOpen ? { open: dockOpen } : null),
    [dockOpen],
  );
  const pathname = usePathname();
  const pageNoteId = pathname?.match(/^\/app\/notes\/([^/]+)$/)?.[1] ?? null;
  if (!dock) return null;
  return (
    <NotePreviewProvider>
      <QuickViewContext.Provider value={quickView}>
        <DockCloseInvalidator />
        <NoteDock
          notes={dock.notes}
          activeId={dock.activeId}
          minimized={dock.minimized}
          preset={dock.preset}
          size={dock.size}
          pageNoteId={pageNoteId}
          onActivate={dock.activate}
          onOpen={dock.open}
          onClose={dock.close}
          onCloseAll={dock.closeAll}
          onTitle={dock.setTitle}
          onMinimize={() => dock.setMinimized(true)}
          onRestore={() => dock.setMinimized(false)}
          onPreset={dock.setPreset}
          onResize={dock.setSize}
        />
      </QuickViewContext.Provider>
    </NotePreviewProvider>
  );
}

/** Keeps cards in the dock fresh when a tab closes. */
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
