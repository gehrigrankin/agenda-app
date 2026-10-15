/**
 * Pure model for the Notes Explorer (Notes Sidebars design §2b/§3): folders
 * and notes in ONE tree, IDE-style.
 *
 * - Folders are bubbles flagged `isFolder`; a folder nests under its parent
 *   only when that parent is itself a folder, otherwise it's a root folder
 *   (rendered as an uppercase section label with its area color + icon).
 * - Notes hang off their folder; unfiled notes are "loose" notes at the root.
 * - Sorting is per folder: a folder's own `sortMode` wins, else the Explorer's
 *   global sort. Grouping (folders first / mixed) is global.
 * - Filtering keeps every matching path open, marks the folders that are only
 *   there for context, and flags notes that matched only in their body.
 *
 * No React here — the Explorer, the phone Notes screen and the tests all build
 * on these functions.
 */

export type SortMode = "manual" | "alpha" | "edited" | "created";
export type GroupMode = "folders-first" | "mixed";

export const SORT_MODES: readonly SortMode[] = [
  "manual",
  "alpha",
  "edited",
  "created",
];

export function isSortMode(v: unknown): v is SortMode {
  return typeof v === "string" && (SORT_MODES as readonly string[]).includes(v);
}

export const SORT_LABELS: Record<SortMode, string> = {
  manual: "Manual",
  alpha: "A–Z",
  edited: "Recently edited",
  created: "Created",
};

export interface ExplorerFolderInput {
  id: string;
  title: string;
  parentId: string | null;
  icon: string | null;
  emoji: string | null;
  color: string | null;
  sortOrder: number;
  sortMode: SortMode | null;
  createdAt: string; // ISO
}

export interface ExplorerNoteInput {
  id: string;
  title: string;
  folderId: string | null;
  sortOrder: number;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  preview: string;
}

export interface FolderNodeX {
  kind: "folder";
  id: string;
  folder: ExplorerFolderInput;
  depth: number;
  /** Ancestor folder ids, root first. */
  ancestors: string[];
  children: ExplorerNode[];
  /** Notes in this folder and every descendant. */
  noteCount: number;
  /** Latest updatedAt of any note inside (for "Recently edited"), ISO or "". */
  lastEdited: string;
}

export interface NoteNodeX {
  kind: "note";
  id: string;
  note: ExplorerNoteInput;
  depth: number;
  ancestors: string[];
}

export type ExplorerNode = FolderNodeX | NoteNodeX;

export interface ExplorerOptions {
  sort: SortMode;
  group: GroupMode;
}

function titleOf(n: ExplorerNode): string {
  return (n.kind === "folder" ? n.folder.title : n.note.title) || "Untitled";
}
function createdOf(n: ExplorerNode): string {
  return n.kind === "folder" ? n.folder.createdAt : n.note.createdAt;
}
function editedOf(n: ExplorerNode): string {
  return n.kind === "folder" ? n.lastEdited : n.note.updatedAt;
}
function orderOf(n: ExplorerNode): number {
  return n.kind === "folder" ? n.folder.sortOrder : n.note.sortOrder;
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function compareNodes(
  a: ExplorerNode,
  b: ExplorerNode,
  sort: SortMode,
): number {
  const byTitle = collator.compare(titleOf(a), titleOf(b));
  switch (sort) {
    case "alpha":
      return byTitle;
    case "edited":
      return editedOf(b).localeCompare(editedOf(a)) || byTitle;
    case "created":
      return createdOf(b).localeCompare(createdOf(a)) || byTitle;
    case "manual":
    default:
      // Manual order, then creation order: a never-reordered folder (every
      // sortOrder 0) reads oldest-first, so new items append at the end.
      return (
        orderOf(a) - orderOf(b) ||
        createdOf(a).localeCompare(createdOf(b)) ||
        byTitle
      );
  }
}

export function sortChildren(
  nodes: ExplorerNode[],
  sort: SortMode,
  group: GroupMode,
): ExplorerNode[] {
  const sorted = [...nodes].sort((a, b) => compareNodes(a, b, sort));
  if (group === "mixed") return sorted;
  return [
    ...sorted.filter((n) => n.kind === "folder"),
    ...sorted.filter((n) => n.kind === "note"),
  ];
}

/**
 * Build the whole Explorer tree. Roots are the root folders followed by loose
 * notes (or interleaved, in "mixed" grouping).
 */
export function buildExplorerTree(
  folders: ExplorerFolderInput[],
  notes: ExplorerNoteInput[],
  opts: ExplorerOptions,
): ExplorerNode[] {
  const folderIds = new Set(folders.map((f) => f.id));
  const foldersByParent = new Map<string | null, ExplorerFolderInput[]>();
  for (const f of folders) {
    const key = f.parentId && folderIds.has(f.parentId) ? f.parentId : null;
    const list = foldersByParent.get(key);
    if (list) list.push(f);
    else foldersByParent.set(key, [f]);
  }
  const notesByFolder = new Map<string | null, ExplorerNoteInput[]>();
  for (const n of notes) {
    const key = n.folderId && folderIds.has(n.folderId) ? n.folderId : null;
    const list = notesByFolder.get(key);
    if (list) list.push(n);
    else notesByFolder.set(key, [n]);
  }

  const seen = new Set<string>();
  const build = (
    f: ExplorerFolderInput,
    depth: number,
    ancestors: string[],
    inherited: SortMode,
  ): FolderNodeX => {
    seen.add(f.id);
    const sort = f.sortMode ?? inherited;
    const path = [...ancestors, f.id];
    const childFolders = (foldersByParent.get(f.id) ?? [])
      .filter((c) => !seen.has(c.id))
      .map((c) => build(c, depth + 1, path, opts.sort));
    const childNotes: NoteNodeX[] = (notesByFolder.get(f.id) ?? []).map(
      (n) => ({
        kind: "note",
        id: n.id,
        note: n,
        depth: depth + 1,
        ancestors: path,
      }),
    );
    let noteCount = childNotes.length;
    let lastEdited = "";
    for (const n of childNotes)
      if (n.note.updatedAt > lastEdited) lastEdited = n.note.updatedAt;
    for (const c of childFolders) {
      noteCount += c.noteCount;
      if (c.lastEdited > lastEdited) lastEdited = c.lastEdited;
    }
    return {
      kind: "folder",
      id: f.id,
      folder: f,
      depth,
      ancestors,
      children: sortChildren(
        [...childFolders, ...childNotes],
        sort,
        opts.group,
      ),
      noteCount,
      lastEdited,
    };
  };

  const rootFolders = (foldersByParent.get(null) ?? []).map((f) =>
    build(f, 0, [], opts.sort),
  );
  // A corrupt parent cycle leaves its members unreachable; surface them at
  // the root rather than silently dropping them.
  for (const f of folders) {
    if (!seen.has(f.id)) rootFolders.push(build(f, 0, [], opts.sort));
  }
  const loose: NoteNodeX[] = (notesByFolder.get(null) ?? []).map((n) => ({
    kind: "note",
    id: n.id,
    note: n,
    depth: 0,
    ancestors: [],
  }));
  if (opts.group === "mixed") {
    return sortChildren([...rootFolders, ...loose], opts.sort, "mixed");
  }
  // Root folders are areas: always first, in their own order; loose notes
  // follow (design 2b — "Untitled", "this one" at the foot of the tree).
  return [
    ...sortChildren(rootFolders, opts.sort, "folders-first"),
    ...sortChildren(loose, opts.sort, "folders-first"),
  ];
}

/** Index every node by id (for lookups, hoist, peek paths). */
export function indexTree(roots: ExplorerNode[]): Map<string, ExplorerNode> {
  const map = new Map<string, ExplorerNode>();
  const walk = (nodes: ExplorerNode[]) => {
    for (const n of nodes) {
      map.set(n.id, n);
      if (n.kind === "folder") walk(n.children);
    }
  };
  walk(roots);
  return map;
}

/** The hoisted folder's children as the new roots, depths rebased to 0. */
export function hoistTree(
  roots: ExplorerNode[],
  folderId: string,
): ExplorerNode[] | null {
  const node = indexTree(roots).get(folderId);
  if (!node || node.kind !== "folder") return null;
  const shift = node.depth + 1;
  const rebase = (n: ExplorerNode): ExplorerNode =>
    n.kind === "folder"
      ? {
          ...n,
          depth: n.depth - shift,
          children: n.children.map(rebase),
        }
      : { ...n, depth: n.depth - shift };
  return node.children.map(rebase);
}

/** Folder titles from the root down to (and including) `folderId`. */
export function folderPath(
  index: Map<string, ExplorerNode>,
  folderId: string | null,
): { id: string; title: string }[] {
  if (!folderId) return [];
  const node = index.get(folderId);
  if (!node || node.kind !== "folder") return [];
  return [...node.ancestors, node.id].map((id) => {
    const n = index.get(id);
    return {
      id,
      title: n && n.kind === "folder" ? n.folder.title || "Untitled" : "…",
    };
  });
}

// ── Filtering ───────────────────────────────────────────────────────────────

export interface FilteredNode {
  node: ExplorerNode;
  /** Title matched the query (highlight it). */
  matched: boolean;
  /** Folder shown only because something inside matched (dim it). */
  context: boolean;
  /** Note matched only in its body ("in text"). */
  inText: boolean;
  children: FilteredNode[];
}

export interface FilterResult {
  nodes: FilteredNode[];
  noteCount: number;
  folderCount: number;
}

export function normalizeQuery(q: string): string {
  return q.trim().toLowerCase();
}

export function titleMatches(title: string, query: string): boolean {
  const q = normalizeQuery(query);
  return q.length > 0 && (title || "Untitled").toLowerCase().includes(q);
}

/**
 * Keep every node whose title matches, every note whose body matched
 * (`bodyMatches`, from the server), and every folder on the path to one.
 * Children of a matched folder are kept only if they match themselves —
 * the filter narrows, it doesn't re-expand whole folders.
 */
export function filterExplorer(
  roots: ExplorerNode[],
  query: string,
  bodyMatches: ReadonlySet<string> = new Set(),
  opts: { titlesOnly?: boolean } = {},
): FilterResult {
  const q = normalizeQuery(query);
  let noteCount = 0;
  let folderCount = 0;
  if (!q) return { nodes: [], noteCount, folderCount };

  const visit = (n: ExplorerNode): FilteredNode | null => {
    if (n.kind === "note") {
      const matched = titleMatches(n.note.title, q);
      const inText = !matched && !opts.titlesOnly && bodyMatches.has(n.id);
      if (!matched && !inText) return null;
      noteCount++;
      return { node: n, matched, context: false, inText, children: [] };
    }
    const kids = n.children
      .map(visit)
      .filter((x): x is FilteredNode => x !== null);
    const matched = titleMatches(n.folder.title, q);
    if (!matched && kids.length === 0) return null;
    if (matched) folderCount++;
    return {
      node: n,
      matched,
      context: !matched,
      inText: false,
      children: kids,
    };
  };

  const nodes = roots.map(visit).filter((x): x is FilteredNode => x !== null);
  return { nodes, noteCount, folderCount };
}

/** Split `text` into plain/highlighted segments for every query occurrence. */
export function highlightSegments(
  text: string,
  query: string,
): { text: string; hit: boolean }[] {
  const q = normalizeQuery(query);
  if (!q) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const out: { text: string; hit: boolean }[] = [];
  let i = 0;
  while (i < text.length) {
    const at = lower.indexOf(q, i);
    if (at < 0) {
      out.push({ text: text.slice(i), hit: false });
      break;
    }
    if (at > i) out.push({ text: text.slice(i, at), hit: false });
    out.push({ text: text.slice(at, at + q.length), hit: true });
    i = at + q.length;
  }
  return out.length ? out : [{ text, hit: false }];
}

// ── Keyboard navigation ─────────────────────────────────────────────────────

export interface VisibleRow {
  id: string;
  kind: "folder" | "note";
  depth: number;
  parentId: string | null;
  expanded: boolean;
  hasChildren: boolean;
}

/**
 * The rows on screen, in order — what arrow keys walk. A folder's children are
 * visible when it's expanded, or always while filtering (`forceOpen`).
 */
export function visibleRows(
  roots: ExplorerNode[],
  expanded: ReadonlySet<string>,
  forceOpen = false,
): VisibleRow[] {
  const out: VisibleRow[] = [];
  const walk = (nodes: ExplorerNode[], parentId: string | null) => {
    for (const n of nodes) {
      const open = n.kind === "folder" && (forceOpen || expanded.has(n.id));
      out.push({
        id: n.id,
        kind: n.kind,
        depth: n.depth,
        parentId,
        expanded: open,
        hasChildren: n.kind === "folder" && n.children.length > 0,
      });
      if (n.kind === "folder" && open) walk(n.children, n.id);
    }
  };
  walk(roots, null);
  return out;
}

/** Same as `visibleRows`, over a filter result (every path is open). */
export function visibleFilteredRows(nodes: FilteredNode[]): VisibleRow[] {
  const out: VisibleRow[] = [];
  const walk = (list: FilteredNode[], parentId: string | null) => {
    for (const f of list) {
      out.push({
        id: f.node.id,
        kind: f.node.kind,
        depth: f.node.depth,
        parentId,
        expanded: f.node.kind === "folder",
        hasChildren: f.children.length > 0,
      });
      walk(f.children, f.node.id);
    }
  };
  walk(nodes, null);
  return out;
}

export type TreeKeyResult =
  | { type: "focus"; id: string }
  | { type: "expand"; id: string }
  | { type: "collapse"; id: string }
  | { type: "open"; id: string }
  | { type: "rename"; id: string }
  | null;

/** WAI-ARIA tree keyboard model over the visible rows. */
export function treeKey(
  rows: VisibleRow[],
  focusedId: string | null,
  key: string,
): TreeKeyResult {
  if (rows.length === 0) return null;
  const i = focusedId ? rows.findIndex((r) => r.id === focusedId) : -1;
  const row = i >= 0 ? rows[i] : null;
  switch (key) {
    case "ArrowDown":
      return { type: "focus", id: rows[Math.min(rows.length - 1, i + 1)].id };
    case "ArrowUp":
      return { type: "focus", id: rows[Math.max(0, i - 1)].id };
    case "Home":
      return { type: "focus", id: rows[0].id };
    case "End":
      return { type: "focus", id: rows[rows.length - 1].id };
    case "ArrowRight":
      if (!row) return { type: "focus", id: rows[0].id };
      if (row.kind === "folder" && !row.expanded)
        return { type: "expand", id: row.id };
      if (row.kind === "folder" && row.hasChildren && i + 1 < rows.length)
        return { type: "focus", id: rows[i + 1].id };
      return null;
    case "ArrowLeft":
      if (!row) return null;
      if (row.kind === "folder" && row.expanded)
        return { type: "collapse", id: row.id };
      return row.parentId ? { type: "focus", id: row.parentId } : null;
    case "Enter":
      if (!row) return null;
      return row.kind === "folder"
        ? row.expanded
          ? { type: "collapse", id: row.id }
          : { type: "expand", id: row.id }
        : { type: "open", id: row.id };
    case "F2":
      return row ? { type: "rename", id: row.id } : null;
    default:
      return null;
  }
}

/** Would moving `dragId` into `targetFolderId` put a folder inside itself? */
export function isInvalidFolderMove(
  index: Map<string, ExplorerNode>,
  dragId: string,
  targetFolderId: string | null,
): boolean {
  if (targetFolderId === null) return false;
  if (dragId === targetFolderId) return true;
  const target = index.get(targetFolderId);
  if (!target || target.kind !== "folder") return true;
  return target.ancestors.includes(dragId);
}
