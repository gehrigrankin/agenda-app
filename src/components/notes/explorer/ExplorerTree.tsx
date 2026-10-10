"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
} from "lucide-react";

import {
  highlightSegments,
  type ExplorerNode,
  type FilteredNode,
} from "@/lib/explorer-tree";
import { areaCss, folderIcon } from "./folder-style";

/**
 * The Explorer tree (Notes Sidebars design §2b/§3): folders and notes in one
 * tree, IDE-style. Rendered as NESTED DOM on purpose — a folder's row is
 * `position: sticky` inside the group that holds its children, so while you
 * scroll through a deep folder its ancestors stay pinned at the top of the
 * pane (§3a "sticky parents") and each one lets go exactly when its subtree
 * scrolls out. Indent is 12px per level with thin guide lines.
 *
 * Purely presentational + interaction plumbing: the container (NotesExplorer)
 * owns state and does the writes.
 */

export const EXPLORER_DRAG_TYPE = "application/x-agenda-explorer";
/** Also set on note drags so editor panes can accept a dropped note. */
export const NOTE_ID_DRAG_TYPE = "application/x-agenda-note";

export interface DragItem {
  id: string;
  kind: "folder" | "note";
}

export interface DropTarget {
  /** Destination folder (null = the root / loose notes). */
  folderId: string | null;
  /** Manual reorder: place relative to this sibling. */
  beforeId?: string;
  afterId?: string;
}

export interface ExplorerTreeProps {
  roots: ExplorerNode[];
  /** Non-null while filtering: render this instead of `roots`. */
  filtered: FilteredNode[] | null;
  query: string;
  expanded: ReadonlySet<string>;
  onToggle: (id: string, open?: boolean) => void;
  activeNoteId: string | null;
  openNoteIds: ReadonlySet<string>;
  focusedId: string | null;
  onFocusRow: (id: string) => void;
  onActivateNote: (id: string, mods: { meta: boolean; alt: boolean }) => void;
  onContextMenu: (node: ExplorerNode, x: number, y: number) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  renamingId: string | null;
  onRenameCommit: (id: string, title: string | null) => void;
  /** Manual sort enables drop-between-rows reordering. */
  reorderable: (parentFolderId: string | null) => boolean;
  canDrop: (item: DragItem, target: DropTarget) => boolean;
  onDrop: (item: DragItem, target: DropTarget) => void;
  onPeek: (noteId: string | null, rect?: DOMRect) => void;
  /** Ids shown with a dimmed "drag source" look during a drag. */
  className?: string;
}

const ROW =
  "group/row relative flex h-(--row-h) w-full cursor-default select-none items-center pr-2 text-left outline-none";

export function ExplorerTree(props: ExplorerTreeProps) {
  const { roots, filtered, query, onKeyDown, className, canDrop, onDrop } =
    props;
  const [drag, setDrag] = useState<DragItem | null>(null);
  const [over, setOver] = useState<
    | (DropTarget & { rowId: string | null; edge: "into" | "before" | "after" })
    | null
  >(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (openTimer.current) clearTimeout(openTimer.current);
    },
    [],
  );

  const dnd = {
    drag,
    over,
    start: (item: DragItem) => setDrag(item),
    end: () => {
      setDrag(null);
      setOver(null);
      if (openTimer.current) clearTimeout(openTimer.current);
    },
    hover: (
      next:
        | (DropTarget & {
            rowId: string | null;
            edge: "into" | "before" | "after";
          })
        | null,
      openFolderId?: string,
    ) => {
      setOver((prev) =>
        prev &&
        next &&
        prev.rowId === next.rowId &&
        prev.edge === next.edge &&
        prev.folderId === next.folderId
          ? prev
          : next,
      );
      // Closed folders open after a short hover (§3c).
      if (openTimer.current) clearTimeout(openTimer.current);
      if (openFolderId && !props.expanded.has(openFolderId)) {
        openTimer.current = setTimeout(
          () => props.onToggle(openFolderId, true),
          650,
        );
      }
    },
    drop: (item: DragItem, target: DropTarget) => {
      if (canDrop(item, target)) onDrop(item, target);
      dnd.end();
    },
  };

  return (
    <div
      role="tree"
      aria-label="Notes and folders"
      aria-multiselectable={false}
      onKeyDown={onKeyDown}
      className={`relative pb-6 [--indent:0.923rem] [--row-h:2rem] touch:[--row-h:2.75rem] ${className ?? ""}`}
      onDragOver={(e) => {
        // Empty space below the rows: drop at the root.
        if (!drag || e.target !== e.currentTarget) return;
        const target = { folderId: null };
        if (!canDrop(drag, target)) return;
        e.preventDefault();
        dnd.hover({ ...target, rowId: null, edge: "into" });
      }}
      onDrop={(e) => {
        if (!drag || e.target !== e.currentTarget) return;
        e.preventDefault();
        dnd.drop(drag, { folderId: null });
      }}
    >
      {filtered
        ? filtered.map((f) => (
            <FilteredBranch
              key={f.node.id}
              f={f}
              tree={props}
              dnd={dnd}
              query={query}
            />
          ))
        : roots.map((n) => (
            <Branch key={n.id} node={n} tree={props} dnd={dnd} />
          ))}
      {drag && over?.rowId === null && (
        <div className="pointer-events-none mx-2 mt-1 rounded-md border border-dashed border-sage/50 px-2 py-1 text-center text-[0.75rem] text-sage">
          Move to top level
        </div>
      )}
    </div>
  );
}

type Dnd = {
  drag: DragItem | null;
  over:
    | (DropTarget & { rowId: string | null; edge: "into" | "before" | "after" })
    | null;
  start: (item: DragItem) => void;
  end: () => void;
  hover: (
    next:
      | (DropTarget & {
          rowId: string | null;
          edge: "into" | "before" | "after";
        })
      | null,
    openFolderId?: string,
  ) => void;
  drop: (item: DragItem, target: DropTarget) => void;
};

function Branch({
  node,
  tree,
  dnd,
}: {
  node: ExplorerNode;
  tree: ExplorerTreeProps;
  dnd: Dnd;
}) {
  if (node.kind === "note") {
    return <Row node={node} tree={tree} dnd={dnd} />;
  }
  const open = tree.expanded.has(node.id);
  return (
    <div role="none" className="relative">
      <Row node={node} tree={tree} dnd={dnd} open={open} sticky={open} />
      {open && node.children.length > 0 && (
        <div role="group" className="relative">
          <Guide depth={node.depth} />
          {node.children.map((c) => (
            <Branch key={c.id} node={c} tree={tree} dnd={dnd} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilteredBranch({
  f,
  tree,
  dnd,
  query,
}: {
  f: FilteredNode;
  tree: ExplorerTreeProps;
  dnd: Dnd;
  query: string;
}) {
  return (
    <div role="none" className="relative">
      <Row
        node={f.node}
        tree={tree}
        dnd={dnd}
        open={f.node.kind === "folder"}
        sticky={f.node.kind === "folder"}
        filter={{
          matched: f.matched,
          context: f.context,
          inText: f.inText,
          query,
        }}
      />
      {f.children.length > 0 && (
        <div role="group" className="relative">
          <Guide depth={f.node.depth} />
          {f.children.map((c) => (
            <FilteredBranch
              key={c.node.id}
              f={c}
              tree={tree}
              dnd={dnd}
              query={query}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Thin vertical guide under a folder's chevron, spanning its children. */
function Guide({ depth }: { depth: number }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-y-0 w-px bg-white/7"
      style={{ left: `calc(0.85rem + ${depth} * var(--indent) + 0.45rem)` }}
    />
  );
}

function Row({
  node,
  tree,
  dnd,
  open = false,
  sticky = false,
  filter,
}: {
  node: ExplorerNode;
  tree: ExplorerTreeProps;
  dnd: Dnd;
  open?: boolean;
  sticky?: boolean;
  filter?: {
    matched: boolean;
    context: boolean;
    inText: boolean;
    query: string;
  };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isFolder = node.kind === "folder";
  const isRoot = isFolder && node.depth === 0 && node.ancestors.length === 0;
  const title =
    (node.kind === "folder" ? node.folder.title : node.note.title) ||
    "Untitled";
  const focused = tree.focusedId === node.id;
  const active = node.kind === "note" && tree.activeNoteId === node.id;
  const isOpenInTab = node.kind === "note" && tree.openNoteIds.has(node.id);
  const parentFolderId = node.ancestors[node.ancestors.length - 1] ?? null;

  useEffect(() => {
    if (focused && ref.current && document.activeElement !== ref.current) {
      // Only steal focus when the tree already has it (keyboard nav), never
      // from the editor on a route change.
      const tree = ref.current.closest('[role="tree"]');
      if (tree && tree.contains(document.activeElement)) ref.current.focus();
    }
  }, [focused]);

  const color = isFolder ? areaCss(node.folder.color) : null;
  const CustomIcon = isFolder ? folderIcon(node.folder.icon) : null;
  const Icon =
    CustomIcon ?? (isFolder ? (open ? FolderOpen : Folder) : FileText);

  const isDragSource = dnd.drag?.id === node.id;
  const target = dnd.over;
  const isDropInto =
    !!dnd.drag && target?.rowId === node.id && target.edge === "into";
  const dropLine =
    !!dnd.drag && target?.rowId === node.id && target.edge !== "into"
      ? target.edge
      : null;

  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (peekTimer.current) clearTimeout(peekTimer.current);
    },
    [],
  );

  const computeTarget = (
    e: React.DragEvent,
  ): (DropTarget & { edge: "into" | "before" | "after" }) | null => {
    const drag = dnd.drag;
    if (!drag || drag.id === node.id) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    if (isFolder) {
      if (tree.reorderable(parentFolderId) && drag.kind === "folder") {
        if (y < 0.25)
          return {
            folderId: parentFolderId,
            beforeId: node.id,
            edge: "before",
          };
        if (y > 0.75 && !open)
          return { folderId: parentFolderId, afterId: node.id, edge: "after" };
      }
      return { folderId: node.id, edge: "into" };
    }
    // Over a note: reorder among siblings when manual; otherwise it means
    // "into this note's folder".
    if (tree.reorderable(parentFolderId)) {
      return y < 0.5
        ? { folderId: parentFolderId, beforeId: node.id, edge: "before" }
        : { folderId: parentFolderId, afterId: node.id, edge: "after" };
    }
    return { folderId: parentFolderId, edge: "into" };
  };

  const segments = filter?.matched
    ? highlightSegments(title, filter.query)
    : [{ text: title, hit: false }];

  const indent = `calc(0.85rem + ${node.depth} * var(--indent))`;

  return (
    <div
      ref={ref}
      role="treeitem"
      aria-level={node.depth + 1}
      aria-expanded={isFolder ? open : undefined}
      aria-selected={active}
      aria-current={active ? "page" : undefined}
      data-row-id={node.id}
      tabIndex={focused ? 0 : -1}
      draggable={tree.renamingId !== node.id}
      onFocus={() => tree.onFocusRow(node.id)}
      onClick={(e) => {
        if (peekTimer.current) clearTimeout(peekTimer.current);
        tree.onPeek(null);
        tree.onFocusRow(node.id);
        if (isFolder) tree.onToggle(node.id);
        else
          tree.onActivateNote(node.id, {
            meta: e.metaKey || e.ctrlKey,
            alt: e.altKey,
          });
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        tree.onFocusRow(node.id);
        tree.onPeek(null);
        tree.onContextMenu(node, e.clientX, e.clientY);
      }}
      onMouseEnter={() => {
        if (node.kind !== "note" || dnd.drag) return;
        if (peekTimer.current) clearTimeout(peekTimer.current);
        peekTimer.current = setTimeout(() => {
          if (ref.current)
            tree.onPeek(node.id, ref.current.getBoundingClientRect());
        }, 550);
      }}
      onMouseLeave={() => {
        if (peekTimer.current) clearTimeout(peekTimer.current);
        if (node.kind === "note") tree.onPeek(null);
      }}
      onDragStart={(e) => {
        if (peekTimer.current) clearTimeout(peekTimer.current);
        tree.onPeek(null);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(
          EXPLORER_DRAG_TYPE,
          JSON.stringify({ id: node.id, kind: node.kind }),
        );
        if (node.kind === "note") {
          e.dataTransfer.setData(NOTE_ID_DRAG_TYPE, node.id);
          e.dataTransfer.setData("text/plain", title);
        }
        // Defer: changing the source's look synchronously can cancel the drag
        // in Chromium.
        const item = { id: node.id, kind: node.kind };
        requestAnimationFrame(() => dnd.start(item));
      }}
      onDragEnd={() => dnd.end()}
      onDragOver={(e) => {
        const t = computeTarget(e);
        if (!t || !dnd.drag || !tree.canDrop(dnd.drag, t)) {
          if (dnd.over?.rowId === node.id) dnd.hover(null);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        dnd.hover(
          // "Into" over a note means into its folder: ring that folder's row
          // (null = the root, which shows the top-level hint).
          {
            ...t,
            rowId: t.edge === "into" && !isFolder ? parentFolderId : node.id,
          },
          isFolder && t.edge === "into" ? node.id : undefined,
        );
      }}
      onDrop={(e) => {
        const t = computeTarget(e);
        if (!t || !dnd.drag) return;
        e.preventDefault();
        e.stopPropagation();
        const { edge: _edge, ...target } = t;
        void _edge;
        dnd.drop(dnd.drag, target);
      }}
      className={`${ROW} ${sticky ? "sticky bg-sidebar" : ""} ${
        active
          ? "bg-sage/13! text-ink-100"
          : isRoot
            ? "text-ink-300 hover:bg-white/4"
            : "text-ink-300 hover:bg-white/4 hover:text-ink-100"
      } ${focused ? "ring-1 ring-inset ring-sage/45" : ""} ${
        isDropInto ? "z-30 ring-1 ring-inset ring-sage bg-sage/10!" : ""
      } ${isDragSource ? "opacity-35" : ""} ${filter?.context ? "opacity-55" : ""}`}
      style={
        sticky
          ? {
              top: `calc(var(--sticky-top, 0rem) + ${node.depth} * var(--row-h))`,
              zIndex: 20 - Math.min(node.depth, 10),
            }
          : undefined
      }
    >
      {active && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[2px] bg-sage"
        />
      )}
      {dropLine && (
        <span
          aria-hidden
          className={`pointer-events-none absolute right-2 h-[2px] rounded-full bg-sage ${
            dropLine === "before" ? "top-0" : "bottom-0"
          }`}
          style={{ left: indent }}
        />
      )}
      <span aria-hidden className="flex-none" style={{ width: indent }} />
      <span aria-hidden className="flex w-[1.125rem] flex-none items-center">
        {isFolder &&
          (open ? (
            <ChevronDown className="h-3.5 w-3.5 text-ink-500" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-ink-500" />
          ))}
      </span>
      <Icon
        aria-hidden
        className={`mr-2 h-[0.9375rem] w-[0.9375rem] flex-none ${
          active ? "text-sage" : color ? "" : "text-ink-500"
        }`}
        style={color ? { color } : undefined}
      />
      {tree.renamingId === node.id ? (
        <RenameInput
          initial={title === "Untitled" ? "" : title}
          onDone={(v) => tree.onRenameCommit(node.id, v)}
        />
      ) : (
        <span
          className={`min-w-0 flex-1 truncate ${
            isRoot
              ? "text-[0.8rem] font-semibold tracking-[0.08em] uppercase"
              : "text-[0.875rem]"
          } ${isOpenInTab && !active ? "text-ink-100" : ""}`}
          style={isRoot && color ? { color } : undefined}
        >
          {segments.map((s, i) =>
            s.hit ? (
              <mark
                key={i}
                className="rounded-[2px] bg-area-amber/30 px-px text-ink-100"
              >
                {s.text}
              </mark>
            ) : (
              <span key={i}>{s.text}</span>
            ),
          )}
        </span>
      )}
      {isDropInto ? (
        <span className="ml-2 flex-none text-[0.75rem] font-medium text-sage">
          Move here
        </span>
      ) : filter?.inText ? (
        <span className="ml-2 flex-none text-[0.75rem] text-ink-500">
          in text
        </span>
      ) : isFolder && !open && node.noteCount > 0 ? (
        <span className="ml-2 flex-none font-mono text-[0.72rem] text-ink-600 tabular-nums opacity-0 group-hover/row:opacity-100">
          {node.noteCount}
        </span>
      ) : null}
    </div>
  );
}

function RenameInput({
  initial,
  onDone,
}: {
  initial: string;
  onDone: (value: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <input
      autoFocus
      aria-label="Rename"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(value.trim() || null);
        else if (e.key === "Escape") finish(null);
      }}
      onBlur={() => finish(value.trim() || null)}
      className="min-w-0 flex-1 rounded-sm bg-input px-1 py-0.5 text-[0.875rem] text-ink-100 outline outline-1 outline-sage/60"
    />
  );
}
