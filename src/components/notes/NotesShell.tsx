"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, FilePlus, FileText } from "lucide-react";

import {
  duplicateNoteAction,
  getOrCreateTodayNoteAction,
  moveNoteToBubbleAction,
  quickCreateNoteAction,
  renameNoteAction,
  trashNoteAction,
} from "@/app/app/actions";
import {
  createBoardAction,
  createBubbleNoteAction,
  createSubfolderAction,
  deleteFolderToTrashAction,
  moveFolderAction,
  renameBubbleAction,
} from "@/app/app/bubbles/actions";
import {
  reorderFoldersAction,
  reorderNotesAction,
  searchNoteBodiesAction,
  setFolderSortModeAction,
  setFolderStyleAction,
} from "@/app/app/notes/actions";
import { useHideShellChrome } from "@/components/layout/AppShell";
import { PageLayout, SidebarToggles } from "@/components/layout/PageLayout";
import { localDateString } from "@/lib/dates";
import { paneOf } from "@/lib/editor-panes";
import {
  buildExplorerTree,
  filterExplorer,
  folderPath,
  hoistTree,
  indexTree,
  isInvalidFolderMove,
  isSortMode,
  sortChildren,
  treeKey,
  visibleFilteredRows,
  visibleRows,
  type ExplorerFolderInput,
  type ExplorerNode,
  type ExplorerNoteInput,
  type GroupMode,
  type SortMode,
} from "@/lib/explorer-tree";
import { useEditorPanes } from "@/lib/hooks/use-editor-panes";
import { usePersistentState } from "@/lib/hooks/use-persistent-state";
import { useNoteDock } from "./NoteDockProvider";
import { SaveStatusChip } from "./SaveStatus";
import {
  NoteDocumentContext,
  NoteSurfaceProvider,
  revealHeading,
  type NoteSurfaceInfo,
} from "./NoteSurfaceContext";
import { EditorPanes } from "./explorer/EditorPanes";
import {
  ExplorerContextMenu,
  actionForKey,
  type MenuAction,
} from "./explorer/ExplorerMenus";
import type { DragItem, DropTarget } from "./explorer/ExplorerTree";
import { NotePeek } from "./explorer/NotePeek";
import {
  NotesExplorer,
  NotesExplorerHeader,
  shortPath,
  type OpenNoteRow,
} from "./explorer/NotesExplorer";

/**
 * The Notes page (Notes Sidebars design §2b + §3): an IDE-style Explorer —
 * folders and notes in ONE tree — as sidebar 1, and a tabbed, splittable
 * editor filling the rest. There is no separate note-list column and no
 * sidebar 2.
 *
 * Open documents. Tabs are client state (useEditorPanes); the URL names the
 * FOCUSED pane's note. Switching to a tab that's already open is a
 * `history.pushState` (no server round trip); opening a note that isn't open
 * yet is a real navigation so the route can server-render it (logs,
 * backlinks). A pane mounts `children` (the route's render) only while its
 * active tab IS the route's note; otherwise a client-loaded editor. Every
 * other open-but-inactive tab has no editor. The panes' active notes are
 * registered with the dock so it never mounts a second editor on any of them.
 *
 * Writes (move, rename, style, sort, reorder) apply optimistically over the
 * server props and refresh; the next props replace the overlay.
 */

export interface ShellDailyNote {
  id: string;
  title: string;
  dailyDate: string; // YYYY-MM-DD
  updatedAt: string; // ISO
}

interface ExplorerPrefs {
  sort: SortMode;
  group: GroupMode;
}
const DEFAULT_PREFS: ExplorerPrefs = { sort: "manual", group: "folders-first" };
function isPrefs(v: unknown): v is ExplorerPrefs {
  const o = v as ExplorerPrefs;
  return (
    typeof v === "object" &&
    v !== null &&
    isSortMode(o.sort) &&
    (o.group === "folders-first" || o.group === "mixed")
  );
}
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");
const isNullableString = (v: unknown): v is string | null =>
  v === null || typeof v === "string";

interface Overlay {
  noteFolder: Map<string, string | null>;
  folderParent: Map<string, string | null>;
  noteTitle: Map<string, string>;
  folderTitle: Map<string, string>;
  folderStyle: Map<string, { color?: string | null; icon?: string | null }>;
  folderSort: Map<string, SortMode | null>;
  noteOrder: Map<string, number>;
  folderOrder: Map<string, number>;
  removed: Set<string>;
}
const emptyOverlay = (): Overlay => ({
  noteFolder: new Map(),
  folderParent: new Map(),
  noteTitle: new Map(),
  folderTitle: new Map(),
  folderStyle: new Map(),
  folderSort: new Map(),
  noteOrder: new Map(),
  folderOrder: new Map(),
  removed: new Set(),
});

/** "2:15 PM" if today (client-local), else "Jul 3". */
function formatWhen(iso: string, now: Date): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function NotesShell({
  folders: folderProps,
  notes: noteProps,
  dailyNotes,
  recentNotes,
  children,
}: {
  folders: ExplorerFolderInput[];
  notes: ExplorerNoteInput[];
  /** Live daily notes, newest first (the Today card + the Dailies group). */
  dailyNotes: ShellDailyNote[];
  recentNotes: { id: string; title: string; openedAt: string }[];
  children: React.ReactNode;
}) {
  const params = useParams();
  /**
   * The note the ROUTE server-rendered into `children` — `useParams()`, not
   * the pathname: a shallow tab switch pushes a new URL but leaves the router
   * tree alone, so this keeps pointing at what `children` actually contains.
   */
  const routeId = typeof params.id === "string" ? params.id : null;
  const router = useRouter();
  const searchParams = useSearchParams();
  const dock = useNoteDock();
  const hideChrome = useHideShellChrome();

  // ── Explorer state ────────────────────────────────────────────────────
  const [prefs, setPrefs] = usePersistentState<ExplorerPrefs>(
    "agenda.notes.explorer",
    DEFAULT_PREFS,
    isPrefs,
  );
  const [expandedList, setExpandedList] = usePersistentState<string[]>(
    "agenda.notes.expanded",
    [],
    isStringArray,
  );
  const expanded = useMemo(() => new Set(expandedList), [expandedList]);
  const [hoistId, setHoistId] = usePersistentState<string | null>(
    "agenda.notes.hoist",
    null,
    isNullableString,
  );
  const [query, setQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const filterInput = useRef<HTMLInputElement>(null);
  const [bodyHits, setBodyHits] = useState<Set<string>>(new Set());
  const [focusedRow, setFocusedRow] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{
    node: ExplorerNode;
    x: number;
    y: number;
  } | null>(null);
  const [peek, setPeek] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);
  const [, startWrite] = useTransition();

  // Optimistic overlay, reset whenever the server props change.
  const [overlay, setOverlay] = useState<Overlay>(emptyOverlay);
  const [propsSeen, setPropsSeen] = useState({ folderProps, noteProps });
  if (
    propsSeen.folderProps !== folderProps ||
    propsSeen.noteProps !== noteProps
  ) {
    setPropsSeen({ folderProps, noteProps });
    setOverlay(emptyOverlay());
  }
  const mutate = (fn: (o: Overlay) => void) =>
    setOverlay((prev) => {
      const next: Overlay = {
        noteFolder: new Map(prev.noteFolder),
        folderParent: new Map(prev.folderParent),
        noteTitle: new Map(prev.noteTitle),
        folderTitle: new Map(prev.folderTitle),
        folderStyle: new Map(prev.folderStyle),
        folderSort: new Map(prev.folderSort),
        noteOrder: new Map(prev.noteOrder),
        folderOrder: new Map(prev.folderOrder),
        removed: new Set(prev.removed),
      };
      fn(next);
      return next;
    });

  const folders = useMemo<ExplorerFolderInput[]>(
    () =>
      folderProps
        .filter((f) => !overlay.removed.has(f.id))
        .map((f) => {
          const style = overlay.folderStyle.get(f.id);
          return {
            ...f,
            title: overlay.folderTitle.get(f.id) ?? f.title,
            parentId: overlay.folderParent.has(f.id)
              ? (overlay.folderParent.get(f.id) ?? null)
              : f.parentId,
            color: style && "color" in style ? (style.color ?? null) : f.color,
            icon: style && "icon" in style ? (style.icon ?? null) : f.icon,
            sortMode: overlay.folderSort.has(f.id)
              ? (overlay.folderSort.get(f.id) ?? null)
              : f.sortMode,
            sortOrder: overlay.folderOrder.get(f.id) ?? f.sortOrder,
          };
        }),
    [folderProps, overlay],
  );
  const notes = useMemo<ExplorerNoteInput[]>(
    () =>
      noteProps
        .filter((n) => !overlay.removed.has(n.id))
        .map((n) => ({
          ...n,
          title: overlay.noteTitle.get(n.id) ?? n.title,
          folderId: overlay.noteFolder.has(n.id)
            ? (overlay.noteFolder.get(n.id) ?? null)
            : n.folderId,
          sortOrder: overlay.noteOrder.get(n.id) ?? n.sortOrder,
        })),
    [noteProps, overlay],
  );

  const tree = useMemo(
    () => buildExplorerTree(folders, notes, prefs),
    [folders, notes, prefs],
  );
  const index = useMemo(() => indexTree(tree), [tree]);
  const hoistNode = hoistId ? index.get(hoistId) : undefined;
  const hoisted = hoistNode?.kind === "folder" ? hoistNode : null;
  const roots = useMemo(
    () => (hoisted ? (hoistTree(tree, hoisted.id) ?? tree) : tree),
    [tree, hoisted],
  );
  const filter = useMemo(
    () => (query.trim() ? filterExplorer(roots, query, bodyHits) : null),
    [roots, query, bodyHits],
  );
  const rows = useMemo(
    () =>
      filter ? visibleFilteredRows(filter.nodes) : visibleRows(roots, expanded),
    [filter, roots, expanded],
  );

  // Body matches for the filter ("in text"), debounced.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setBodyHits(new Set());
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      searchNoteBodiesAction(q)
        .then((hits) => {
          if (!cancelled) setBodyHits(new Set(hits.map((h) => h.id)));
        })
        .catch(() => {});
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  // A `?folder=<id>` link (Copy link on a folder) hoists that folder.
  const folderParam = searchParams.get("folder");
  useEffect(() => {
    if (folderParam && index.get(folderParam)?.kind === "folder")
      setHoistId(folderParam);
  }, [folderParam, index, setHoistId]);

  const toggle = useCallback(
    (id: string, open?: boolean) =>
      setExpandedList((prev) => {
        const has = prev.includes(id);
        const want = open ?? !has;
        if (want === has) return prev;
        return want ? [...prev, id] : prev.filter((x) => x !== id);
      }),
    [setExpandedList],
  );
  const expandMany = useCallback(
    (ids: string[]) =>
      setExpandedList((prev) => {
        const add = ids.filter((id) => !prev.includes(id));
        return add.length ? [...prev, ...add] : prev;
      }),
    [setExpandedList],
  );

  // ── Open documents ────────────────────────────────────────────────────
  const panes = useEditorPanes();
  const focusedId = panes.focusedId;
  /**
   * The focused tab when it's being edited client-side although the route
   * caught up with it (a rename revalidates and the router refetches the URL
   * we pushed). Sticky on purpose: swapping the live client editor for the
   * server-rendered one mid-keystroke would make the caret jump.
   */
  const [clientTabId, setClientTabId] = useState<string | null>(null);

  const knownTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of recentNotes) map.set(n.id, n.title);
    for (const n of dailyNotes) map.set(n.id, n.title);
    for (const n of notes) map.set(n.id, n.title);
    return map;
  }, [recentNotes, dailyNotes, notes]);

  // A real navigation opens (and focuses) its note — derived during render,
  // not in an effect, so no committed frame has the previous editor mounted
  // under the new note's URL (the dock reads that URL).
  const [seenRouteId, setSeenRouteId] = useState<string | null | undefined>(
    undefined,
  );
  if (seenRouteId !== routeId) {
    setSeenRouteId(routeId);
    if (routeId !== focusedId) {
      setClientTabId(null);
      if (routeId) panes.open(routeId, knownTitles.get(routeId));
      else panes.clearActive();
    }
  }

  // Fresh server titles rename their tabs.
  const setPaneTitle = panes.setTitle;
  useEffect(() => {
    for (const [id, title] of knownTitles) setPaneTitle(id, title);
  }, [knownTitles, setPaneTitle]);

  // Reveal the focused note in the tree (expand its folders) once per note.
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (!focusedId || revealed.current === focusedId) return;
    const node = index.get(focusedId);
    if (!node) return;
    revealed.current = focusedId;
    expandMany(node.ancestors);
    setFocusedRow(focusedId);
  }, [focusedId, index, expandMany]);

  // The dock never edits a note a pane is showing.
  const setPageNotes = dock?.setPageNotes;
  const paneActives = panes.state.panes
    .map((p) => p.active)
    .filter((id): id is string => id !== null);
  const paneActivesKey = paneActives.join(",");
  useEffect(() => {
    setPageNotes?.(paneActivesKey ? paneActivesKey.split(",") : []);
  }, [paneActivesKey, setPageNotes]);
  useEffect(() => () => setPageNotes?.([]), [setPageNotes]);

  const noteUrl = (id: string | null) =>
    id ? `/app/notes/${id}` : "/app/notes";
  const syncUrl = (id: string | null, replace = false) => {
    const url = noteUrl(id);
    if (window.location.pathname + window.location.search === url) return;
    if (replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
  };

  /** Point the URL at whatever the focused pane now shows. */
  const afterPaneChange = (state: typeof panes.state, replace = false) => {
    const id = state.panes[state.focused]?.active ?? null;
    setClientTabId(id && id !== routeId ? id : null);
    syncUrl(id, replace);
  };

  /**
   * Open a note. Plain click: the focused pane (switching to an existing tab
   * is shallow; a new note is a real navigation). ⌘-click: a new tab behind
   * the current one. ⌥-click: the other pane (splitting if needed).
   */
  const openNote = (
    id: string,
    mods: { meta?: boolean; alt?: boolean } = {},
  ) => {
    const title = knownTitles.get(id);
    if (mods.alt) {
      afterPaneChange(panes.open(id, title, "other"));
      return;
    }
    if (mods.meta) {
      const s = panes.state;
      const keep = s.panes[s.focused]?.active ?? null;
      const next = panes.open(id, title);
      if (keep) panes.activate(next.focused, keep);
      return;
    }
    if (paneOf(panes.state, id) >= 0) {
      afterPaneChange(panes.open(id, title));
      return;
    }
    router.push(noteUrl(id));
  };

  const activateTab = (pane: number, id: string) =>
    afterPaneChange(panes.activate(pane, id));
  const closeTab = (pane: number, id: string) =>
    afterPaneChange(panes.close(pane, id), true);
  const focusPane = (pane: number) => afterPaneChange(panes.focus(pane));

  // Back/forward walks the tabs.
  const openPane = panes.open;
  const clearPane = panes.clearActive;
  useEffect(() => {
    const onPop = () => {
      const id = window.location.pathname.match(/^\/app\/notes\/([^/]+)$/)?.[1];
      setClientTabId(null);
      if (id) openPane(id);
      else clearPane();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [openPane, clearPane]);

  // ── Surfaces (outline, word count, save state) ───────────────────────
  const [surfaces, setSurfaces] = useState<Map<string, NoteSurfaceInfo>>(
    new Map(),
  );
  const reportSurface = useCallback(
    (info: NoteSurfaceInfo | null, noteId: string) =>
      setSurfaces((prev) => {
        const was = prev.get(noteId);
        if (!info) {
          if (!was) return prev;
          const next = new Map(prev);
          next.delete(noteId);
          return next;
        }
        if (
          was &&
          was.title === info.title &&
          was.words === info.words &&
          was.editor === info.editor &&
          was.status.state === info.status.state &&
          was.status.retrying === info.status.retrying &&
          was.status.failure === info.status.failure &&
          was.outline.length === info.outline.length &&
          was.outline.every(
            (o, i) =>
              o.key === info.outline[i].key && o.text === info.outline[i].text,
          )
        ) {
          return prev;
        }
        const next = new Map(prev);
        next.set(noteId, info);
        return next;
      }),
    [],
  );
  const focusedSurface = focusedId ? surfaces.get(focusedId) : undefined;

  // ── Writes ────────────────────────────────────────────────────────────
  const refresh = () => router.refresh();
  const write = (p: Promise<unknown>, label: string) =>
    startWrite(async () => {
      try {
        await p;
      } catch (err) {
        console.error(`[notes] ${label} failed:`, err);
      } finally {
        refresh();
      }
    });

  const createNote = async (
    folderId: string | null,
    target: "focused" | number = "focused",
  ) => {
    try {
      const id = folderId
        ? await createBubbleNoteAction(folderId, "Untitled")
        : (await quickCreateNoteAction("")).id;
      if (folderId)
        expandMany([...(index.get(folderId)?.ancestors ?? []), folderId]);
      if (typeof target === "number" && target !== panes.state.focused) {
        afterPaneChange(panes.open(id, "Untitled", target));
        refresh();
      } else {
        router.push(noteUrl(id));
        refresh();
      }
    } catch (err) {
      console.error("[notes] create note failed:", err);
    }
  };

  const createFolder = async (parentId: string | null) => {
    try {
      const id = parentId
        ? await createSubfolderAction(parentId, "New folder")
        : await createBoardAction("New folder");
      if (parentId)
        expandMany([...(index.get(parentId)?.ancestors ?? []), parentId]);
      refresh();
      setRenamingId(id);
      setFocusedRow(id);
    } catch (err) {
      console.error("[notes] create folder failed:", err);
    }
  };

  /** Where "new" goes from the current context: the focused folder, or the
   *  focused note's folder, or the hoisted root. */
  const contextFolder = (): string | null => {
    const n = focusedRow ? index.get(focusedRow) : undefined;
    if (n?.kind === "folder") return n.id;
    if (n?.kind === "note") return n.note.folderId;
    return hoisted?.id ?? null;
  };

  const rename = (id: string, title: string | null) => {
    setRenamingId(null);
    const node = index.get(id);
    if (!node || title === null) return;
    if (node.kind === "folder") {
      if (title === node.folder.title) return;
      mutate((o) => o.folderTitle.set(id, title));
      write(renameBubbleAction(id, title), "rename folder");
    } else {
      if (title === node.note.title) return;
      mutate((o) => o.noteTitle.set(id, title));
      panes.setTitle(id, title);
      write(renameNoteAction(id, title), "rename note");
    }
  };

  const moveTo = (item: DragItem, folderId: string | null) => {
    if (item.kind === "note") {
      mutate((o) => o.noteFolder.set(item.id, folderId));
      write(moveNoteToBubbleAction(item.id, folderId), "move note");
    } else {
      if (isInvalidFolderMove(index, item.id, folderId)) return;
      mutate((o) => o.folderParent.set(item.id, folderId));
      write(moveFolderAction(item.id, folderId), "move folder");
    }
    if (folderId)
      expandMany([...(index.get(folderId)?.ancestors ?? []), folderId]);
  };

  const siblingsOf = (folderId: string | null): ExplorerNode[] => {
    if (folderId === null) return tree;
    const n = index.get(folderId);
    return n?.kind === "folder" ? n.children : [];
  };
  const sortOf = (folderId: string | null): SortMode => {
    if (folderId === null) return prefs.sort;
    const n = index.get(folderId);
    return (n?.kind === "folder" && n.folder.sortMode) || prefs.sort;
  };

  const drop = (item: DragItem, target: DropTarget) => {
    const current = index.get(item.id)?.ancestors.at(-1) ?? null;
    if (target.beforeId || target.afterId) {
      // Manual reorder among the target folder's children.
      const sibs = sortChildren(
        siblingsOf(target.folderId),
        "manual",
        prefs.group,
      )
        .map((n) => n.id)
        .filter((id) => id !== item.id);
      const ref = (target.beforeId ?? target.afterId)!;
      const at = sibs.indexOf(ref);
      sibs.splice(target.beforeId ? at : at + 1, 0, item.id);
      const hasNotes = sibs.some((id) => index.get(id)?.kind === "note");
      const hasFolders = sibs.some((id) => index.get(id)?.kind === "folder");
      mutate((o) => {
        sibs.forEach((id, i) => {
          const kind = id === item.id ? item.kind : index.get(id)?.kind;
          if (kind === "note") o.noteOrder.set(id, i + 1);
          else o.folderOrder.set(id, i + 1);
        });
        if (current !== target.folderId) {
          if (item.kind === "note") o.noteFolder.set(item.id, target.folderId);
          else o.folderParent.set(item.id, target.folderId);
        }
      });
      startWrite(async () => {
        try {
          if (current !== target.folderId) {
            if (item.kind === "note")
              await moveNoteToBubbleAction(item.id, target.folderId);
            else await moveFolderAction(item.id, target.folderId);
          }
          // Every sibling gets its position on one shared 1..n scale (notes
          // and folders interleave in "mixed" grouping): each action numbers
          // the WHOLE list and only matches its own table's ids.
          await Promise.all([
            hasNotes ? reorderNotesAction(sibs) : null,
            hasFolders ? reorderFoldersAction(sibs) : null,
          ]);
        } catch (err) {
          console.error("[notes] reorder failed:", err);
        } finally {
          refresh();
        }
      });
      return;
    }
    if (target.folderId === current) return;
    moveTo(item, target.folderId);
  };

  const canDrop = (item: DragItem, target: DropTarget) => {
    if (
      item.kind === "folder" &&
      isInvalidFolderMove(index, item.id, target.folderId)
    )
      return false;
    if (target.beforeId || target.afterId) return true;
    const current = index.get(item.id)?.ancestors.at(-1) ?? null;
    return target.folderId !== current;
  };

  const removeNode = (node: ExplorerNode) => {
    if (node.kind === "note") {
      mutate((o) => o.removed.add(node.id));
      const where = paneOf(panes.state, node.id);
      if (where >= 0) afterPaneChange(panes.close(where, node.id), true);
      write(trashNoteAction(node.id), "trash note");
      return;
    }
    const msg =
      node.noteCount > 0
        ? `Delete “${node.folder.title || "Untitled"}”? Its ${node.noteCount} ${
            node.noteCount === 1 ? "note moves" : "notes move"
          } to Trash.`
        : `Delete “${node.folder.title || "Untitled"}”?`;
    if (!window.confirm(msg)) return;
    mutate((o) => o.removed.add(node.id));
    if (hoistId === node.id) setHoistId(null);
    write(deleteFolderToTrashAction(node.id), "delete folder");
  };

  const copyLink = (node: ExplorerNode) => {
    const url =
      node.kind === "note"
        ? `${window.location.origin}/app/notes/${node.id}`
        : `${window.location.origin}/app/notes?folder=${node.id}`;
    void navigator.clipboard?.writeText(url).catch(() => {});
  };

  const runAction = (action: MenuAction, node: ExplorerNode) => {
    switch (action) {
      case "new-note":
        void createNote(node.kind === "folder" ? node.id : node.note.folderId);
        break;
      case "new-subfolder":
        void createFolder(
          node.kind === "folder" ? node.id : node.note.folderId,
        );
        break;
      case "hoist":
        if (node.kind === "folder") {
          setHoistId(node.id);
          toggle(node.id, true);
        }
        break;
      case "open-all":
        if (node.kind === "folder") {
          const kids = node.children.filter((c) => c.kind === "note");
          if (kids.length === 0) break;
          let s = panes.state;
          for (const k of kids.slice(1).reverse())
            s = panes.open(k.id, k.note.title);
          s = panes.open(
            kids[0].id,
            (kids[0] as { note: ExplorerNoteInput }).note.title,
          );
          afterPaneChange(s);
        }
        break;
      case "rename":
        setRenamingId(node.id);
        break;
      case "move":
        // The menu opens its Move to… panel itself; from the keyboard (M on
        // a row) open the menu straight at it.
        break;
      case "copy-link":
        copyLink(node);
        break;
      case "delete":
        removeNode(node);
        break;
      case "open-tab":
        openNote(node.id, { meta: true });
        break;
      case "open-split":
        openNote(node.id, { alt: true });
        break;
      case "open-dock":
        if (node.kind === "note") dock?.open(node.id, node.note.title);
        break;
      case "duplicate":
        write(duplicateNoteAction(node.id), "duplicate note");
        break;
    }
  };

  // ── Keyboard: the tree ────────────────────────────────────────────────
  const [menuSub, setMenuSub] = useState<"move" | null>(null);
  const onTreeKey = (e: React.KeyboardEvent) => {
    if (renamingId || e.target instanceof HTMLInputElement) return;
    const nav = treeKey(rows, focusedRow, e.key);
    if (nav) {
      e.preventDefault();
      if (nav.type === "focus") setFocusedRow(nav.id);
      else if (nav.type === "expand") toggle(nav.id, true);
      else if (nav.type === "collapse") toggle(nav.id, false);
      else if (nav.type === "open")
        openNote(nav.id, { meta: e.metaKey || e.ctrlKey, alt: e.altKey });
      else if (nav.type === "rename") setRenamingId(nav.id);
      return;
    }
    const node = focusedRow ? index.get(focusedRow) : undefined;
    if (!node) return;
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      const r = document
        .querySelector(`[data-row-id="${node.id}"]`)
        ?.getBoundingClientRect();
      if (r) setMenu({ node, x: r.left + 24, y: r.bottom });
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const action = actionForKey(node.kind, e);
    if (!action) return;
    e.preventDefault();
    if (action === "move") {
      const r = document
        .querySelector(`[data-row-id="${node.id}"]`)
        ?.getBoundingClientRect();
      if (r) {
        setMenuSub("move");
        setMenu({ node, x: r.left + 24, y: r.bottom });
      }
      return;
    }
    runAction(action, node);
  };

  // ── Global shortcuts: focus mode, filter ─────────────────────────────
  const focusModeRef = useRef(focusMode);
  focusModeRef.current = focusMode;
  useEffect(() => {
    hideChrome(focusMode);
    return () => hideChrome(false);
  }, [focusMode, hideChrome]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFocusMode((v) => !v);
        return;
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setFilterOpen(true);
        requestAnimationFrame(() => filterInput.current?.focus());
        return;
      }
      if (e.key === "Escape" && focusModeRef.current && !e.defaultPrevented) {
        setFocusMode(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Derived view models ───────────────────────────────────────────────
  const pathTitles = (folderId: string | null) =>
    folderPath(index, folderId).map((p) => p.title);

  const openNotes: OpenNoteRow[] = panes.state.panes.flatMap((p, pi) =>
    p.tabs.map((t) => {
      const node = index.get(t.id);
      return {
        id: t.id,
        title: (node?.kind === "note" ? node.note.title : null) ?? t.title,
        path:
          node?.kind === "note"
            ? shortPath(pathTitles(node.note.folderId))
            : "",
        pane: pi,
        active: pi === panes.state.focused && p.active === t.id,
      };
    }),
  );

  const todayStr = now ? localDateString(now) : null;
  const latestDaily = dailyNotes[0] ?? null;
  const todayDaily =
    latestDaily && todayStr && latestDaily.dailyDate === todayStr
      ? latestDaily
      : null;
  const today = now
    ? {
        label: now.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        }),
        time: todayDaily ? formatWhen(todayDaily.updatedAt, now) : "",
        active: !!todayDaily && focusedId === todayDaily.id,
      }
    : null;
  const openToday = async () => {
    if (todayDaily) {
      openNote(todayDaily.id);
      return;
    }
    try {
      const note = await getOrCreateTodayNoteAction(localDateString());
      router.push(noteUrl(note.id));
      refresh();
    } catch (err) {
      console.error("[notes] open today failed:", err);
    }
  };

  const recents = recentNotes
    .filter((r) => !openNotes.some((o) => o.id === r.id))
    .slice(0, 8)
    .map((r) => ({
      id: r.id,
      title: r.title,
      when: now ? formatWhen(r.openedAt, now) : "",
    }));

  const peekNode =
    peek && !focusMode && !menu ? index.get(peek.id) : undefined;

  const menuNode = menu?.node;
  const menuFolders = useMemo(
    () =>
      menuNode
        ? Array.from(index.values())
            .filter(
              (n): n is Extract<ExplorerNode, { kind: "folder" }> =>
                n.kind === "folder",
            )
            .map((n) => ({
              id: n.id,
              path: [
                ...pathTitles(n.ancestors.at(-1) ?? null),
                n.folder.title || "Untitled",
              ].join(" / "),
              disabled:
                menuNode.kind === "folder" &&
                isInvalidFolderMove(index, menuNode.id, n.id),
            }))
            .sort((a, b) => a.path.localeCompare(b.path))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [menuNode, index],
  );

  const documentCtx = useMemo(
    () => ({
      breadcrumb: (_noteId: string, bubbleId: string | null) => (
        <Breadcrumb
          path={folderPath(index, bubbleId)}
          title={
            (_noteId &&
              (index.get(_noteId) as { note?: ExplorerNoteInput })?.note
                ?.title) ||
            ""
          }
          onFolder={(id) => {
            setHoistId(null);
            expandMany([...(index.get(id)?.ancestors ?? []), id]);
            setFocusedRow(id);
          }}
        />
      ),
    }),
    [index, expandMany, setHoistId],
  );

  const explorer = (
    <NotesExplorer
      tree={{
        roots,
        filtered: filter?.nodes ?? null,
        query,
        expanded,
        onToggle: toggle,
        activeNoteId: focusedId,
        openNoteIds: new Set(openNotes.map((o) => o.id)),
        focusedId: focusedRow,
        onFocusRow: setFocusedRow,
        onActivateNote: (id, mods) => openNote(id, mods),
        onContextMenu: (node, x, y) => {
          setMenuSub(null);
          setMenu({ node, x, y });
        },
        onKeyDown: onTreeKey,
        renamingId,
        onRenameCommit: rename,
        reorderable: (folderId) => sortOf(folderId) === "manual" && !filter,
        canDrop,
        onDrop: drop,
        onPeek: (id, rect) => setPeek(id && rect ? { id, rect } : null),
      }}
      query={query}
      filter={filter}
      hoisted={
        hoisted
          ? {
              id: hoisted.id,
              title: hoisted.folder.title,
              color: hoisted.folder.color,
              icon: hoisted.folder.icon,
            }
          : null
      }
      onUnhoist={() => {
        const parent = hoisted?.ancestors.at(-1) ?? null;
        setHoistId(parent);
      }}
      openNotes={openNotes}
      onOpenNoteRow={(row) => activateTab(row.pane, row.id)}
      onCloseOpenNote={(row) => closeTab(row.pane, row.id)}
      onCloseAll={() => {
        let s = panes.state;
        for (let pi = s.panes.length - 1; pi >= 0; pi--)
          for (const t of [...s.panes[pi].tabs]) s = panes.close(pi, t.id);
        afterPaneChange(s, true);
      }}
      today={today}
      onOpenToday={() => void openToday()}
      outline={focusedSurface?.outline ?? []}
      onOutline={(item) => {
        if (focusedSurface?.editor)
          revealHeading(focusedSurface.editor, item.key);
      }}
      recents={recents}
      onOpenRecent={(id, mods) => openNote(id, mods)}
      dailies={dailyNotes.map((d) => ({
        id: d.id,
        title: d.title,
        dailyDate: d.dailyDate,
      }))}
      activeNoteId={focusedId}
      sort={prefs.sort}
      group={prefs.group}
      onSort={(sort) => setPrefs((p) => ({ ...p, sort }))}
      onGroup={(group) => setPrefs((p) => ({ ...p, group }))}
      onNewNote={() => void createNote(contextFolder())}
      onNewFolder={() => void createFolder(contextFolder())}
      onCollapseAll={() => setExpandedList([])}
    />
  );

  const emptyState = (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <FileText className="h-8 w-8 text-ink-700" />
      <p className="text-[0.875rem] text-ink-500">
        No note open — pick one in the Explorer, or start a new one.
      </p>
      <button
        type="button"
        onClick={() => void createNote(contextFolder())}
        className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[0.8125rem] text-ink-200 hover:bg-white/6"
      >
        <FilePlus className="h-3.5 w-3.5" /> New note
      </button>
    </div>
  );

  const focusedNode = focusedId ? index.get(focusedId) : undefined;

  return (
    <NoteSurfaceProvider value={reportSurface}>
      <NoteDocumentContext.Provider value={documentCtx}>
        <PageLayout
          pageKey="notes"
          sidebar1={
            focusMode
              ? undefined
              : {
                  label: "Notes",
                  defaultWidth: 23,
                  minWidth: 15,
                  maxWidth: 40,
                  header: (
                    <NotesExplorerHeader
                      query={query}
                      onQuery={setQuery}
                      filterOpen={filterOpen}
                      onFilterOpen={setFilterOpen}
                      onCollapse={null}
                      inputRef={filterInput}
                    />
                  ),
                  children: explorer,
                }
          }
        >
          {/* Phone: the Explorer is the Notes screen until a note opens. */}
          <div
            className={`flex min-h-0 flex-1 flex-col bg-sidebar md:hidden ${
              focusedId ? "hidden" : ""
            }`}
          >
            <div className="flex h-14 flex-none items-center gap-1 px-3">
              <NotesExplorerHeader
                query={query}
                onQuery={setQuery}
                filterOpen={filterOpen}
                onFilterOpen={setFilterOpen}
                onCollapse={null}
                inputRef={filterInput}
              />
            </div>
            {explorer}
          </div>

          <div
            className={`min-h-0 flex-1 flex-col ${focusedId ? "flex" : "hidden md:flex"}`}
          >
            {focusedId && (
              <div className="flex h-11 flex-none items-center border-b border-white/7 px-1 md:hidden">
                <Link
                  href="/app/notes"
                  className="flex h-11 items-center gap-0.5 px-2 text-[0.9375rem] font-medium text-sage"
                >
                  <ChevronLeft className="h-5 w-5" />
                  Notes
                </Link>
              </div>
            )}
            <EditorPanes
              state={panes.state}
              routeId={routeId}
              clientTabId={clientTabId}
              leading={<SidebarToggles />}
              onActivate={activateTab}
              onClose={closeTab}
              onFocusPane={focusPane}
              onNewNote={(pane) => void createNote(contextFolder(), pane)}
              onSplit={() => afterPaneChange(panes.split())}
              onUnsplit={() => afterPaneChange(panes.unsplit())}
              onRatio={panes.setRatio}
              onTitle={panes.setTitle}
              onDropNote={(pane, id) =>
                afterPaneChange(panes.open(id, knownTitles.get(id), pane))
              }
              focusMode={focusMode}
              onToggleFocus={() => setFocusMode((v) => !v)}
              emptyState={emptyState}
            >
              {children}
            </EditorPanes>
            {focusMode && (
              <FocusStatusBar
                title={
                  focusedSurface?.title ??
                  (focusedNode?.kind === "note" ? focusedNode.note.title : "")
                }
                path={
                  focusedNode?.kind === "note"
                    ? shortPath(pathTitles(focusedNode.note.folderId))
                    : ""
                }
                words={focusedSurface?.words ?? 0}
                status={focusedSurface?.status ?? null}
                onExit={() => setFocusMode(false)}
              />
            )}
          </div>
        </PageLayout>

        {menu && (
          <ExplorerContextMenu
            key={`${menu.node.id}:${menuSub ?? ""}`}
            kind={menu.node.kind}
            title={
              (menu.node.kind === "folder"
                ? menu.node.folder.title
                : menu.node.note.title) || "Untitled"
            }
            x={menu.x}
            y={menu.y}
            color={menu.node.kind === "folder" ? menu.node.folder.color : null}
            icon={menu.node.kind === "folder" ? menu.node.folder.icon : null}
            sortMode={
              menu.node.kind === "folder" ? menu.node.folder.sortMode : null
            }
            folders={menuFolders}
            currentFolderId={menu.node.ancestors.at(-1) ?? null}
            initialSub={menuSub}
            onAction={(a) => runAction(a, menu.node)}
            onStyle={(style) => {
              const id = menu.node.id;
              mutate((o) =>
                o.folderStyle.set(id, { ...o.folderStyle.get(id), ...style }),
              );
              setMenu((m) =>
                m && m.node.kind === "folder"
                  ? {
                      ...m,
                      node: {
                        ...m.node,
                        folder: {
                          ...m.node.folder,
                          ...("color" in style
                            ? { color: style.color ?? null }
                            : {}),
                          ...("icon" in style
                            ? { icon: style.icon ?? null }
                            : {}),
                        },
                      },
                    }
                  : m,
              );
              write(setFolderStyleAction(id, style), "style folder");
            }}
            onSort={(mode) => {
              const id = menu.node.id;
              mutate((o) => o.folderSort.set(id, mode));
              write(setFolderSortModeAction(id, mode), "sort folder");
            }}
            onMoveTo={(folderId) =>
              moveTo({ id: menu.node.id, kind: menu.node.kind }, folderId)
            }
            onClose={() => {
              setMenu(null);
              setMenuSub(null);
              requestAnimationFrame(() =>
                document
                  .querySelector<HTMLElement>(`[data-row-id="${menu.node.id}"]`)
                  ?.focus(),
              );
            }}
          />
        )}

        {peek && peekNode?.kind === "note" && (
          <NotePeek
            rect={peek.rect}
            path={shortPath(pathTitles(peekNode.note.folderId))}
            title={peekNode.note.title}
            preview={peekNode.note.preview}
            updatedAt={peekNode.note.updatedAt}
          />
        )}
      </NoteDocumentContext.Provider>
    </NoteSurfaceProvider>
  );
}

function Breadcrumb({
  path,
  title,
  onFolder,
}: {
  path: { id: string; title: string }[];
  title: string;
  onFolder: (id: string) => void;
}) {
  return (
    <nav
      aria-label="Note location"
      className="flex min-w-0 items-center gap-1 overflow-hidden text-[0.8125rem] text-ink-500"
    >
      {path.map((p) => (
        <span key={p.id} className="flex min-w-0 flex-none items-center gap-1">
          <button
            type="button"
            onClick={() => onFolder(p.id)}
            className="max-w-[10rem] truncate rounded px-0.5 hover:text-ink-200 focus-visible:outline-1 focus-visible:outline-sage/60"
          >
            {p.title}
          </button>
          <ChevronRight
            aria-hidden
            className="h-3 w-3 flex-none text-ink-700"
          />
        </span>
      ))}
      <span className="min-w-0 truncate text-ink-300">
        {title || "Untitled"}
      </span>
    </nav>
  );
}

/** Focus mode's slim status bar (§3e). */
function FocusStatusBar({
  title,
  path,
  words,
  status,
  onExit,
}: {
  title: string;
  path: string;
  words: number;
  status: NoteSurfaceInfo["status"] | null;
  onExit: () => void;
}) {
  return (
    <div className="flex h-8 flex-none items-center gap-5 border-t border-white/6 bg-canvas px-5 text-[0.75rem] text-ink-500">
      <span className="flex min-w-0 items-center gap-1.5 text-ink-300">
        <FileText className="h-3.5 w-3.5 flex-none" />
        <span className="truncate">{title || "Untitled"}</span>
      </span>
      {path && <span className="truncate">{path}</span>}
      <span className="flex-none">
        {words} {words === 1 ? "word" : "words"}
      </span>
      {status && <SaveStatusChip status={status} compact />}
      <span className="flex-1" />
      <button
        type="button"
        onClick={onExit}
        className="flex-none rounded px-1.5 hover:text-ink-200 focus-visible:outline-1 focus-visible:outline-sage/60"
      >
        Esc to exit · ⌘⇧F
      </button>
    </div>
  );
}
