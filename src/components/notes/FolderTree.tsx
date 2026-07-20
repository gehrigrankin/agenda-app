"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpToLine,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderPlus,
  Inbox,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";

import type { FolderNode } from "@/lib/folderTree";

/**
 * The Notes folder tree (design Turn 19b, scaled per Turn 20). Root folders
 * read as quiet uppercase section labels; everything inside is a collapsible
 * tree with indent guides. The automatic Inbox (unfiled notes) sits on top
 * with a sage count badge.
 *
 * Two variants share the markup:
 * - "phone" (Turn 17d/19b): note rows render inline under their folders and
 *   navigate to the note; roomier 44px touch rows.
 * - "pane" (Turn 20a/20b): folders only — notes live in the list pane —
 *   tighter 32px rows, and tapping a folder selects it (`onSelect`).
 *
 * When `ops` is provided, every folder row gets management affordances: a ⋯
 * menu (rename inline, create a subfolder, move to top level, delete with an
 * in-menu confirm) and desktop drag & drop to nest one folder inside
 * another. All mutations go through the parent — this component stays
 * presentational and lets the server round-trip refresh the tree.
 */

export interface TreeNoteRow {
  id: string;
  title: string;
}

export interface FolderOps {
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onCreateChild: (parentId: string, title: string) => void;
  onMove: (id: string, newParentId: string | null) => void;
}

export function FolderTree({
  tree,
  inboxCount,
  variant,
  inboxNotes,
  notesByFolder,
  noteHref,
  selectedId,
  onSelect,
  ops,
}: {
  tree: FolderNode[];
  inboxCount: number;
  variant: "phone" | "pane";
  /** phone: unfiled note rows shown under the Inbox section. */
  inboxNotes?: TreeNoteRow[];
  /** phone: note rows per folder id. */
  notesByFolder?: ReadonlyMap<string, TreeNoteRow[]>;
  /** phone: where a note row navigates. */
  noteHref?: (id: string) => string;
  /** pane: selected folder id, null = Inbox. */
  selectedId?: string | null;
  /** pane: called with a folder id, or null for Inbox. */
  onSelect?: (id: string | null) => void;
  /** When set, folder rows get the ⋯ menu and drag & drop. */
  ops?: FolderOps;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [addingChildFor, setAddingChildFor] = useState<string | null>(null);
  const [childDraft, setChildDraft] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const phone = variant === "phone";

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const closeMenu = () => {
    setMenuFor(null);
    setArmedDelete(null);
  };

  /** Ids inside the dragged folder's subtree — invalid drop targets. */
  const draggedSubtree = (): Set<string> => {
    const ids = new Set<string>();
    if (!dragId) return ids;
    const collect = (nodes: FolderNode[], inside: boolean) => {
      for (const n of nodes) {
        const within = inside || n.id === dragId;
        if (within) ids.add(n.id);
        collect(n.children, within);
      }
    };
    collect(tree, false);
    return ids;
  };

  const dragProps = (node: FolderNode) =>
    ops
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.setData("text/plain", node.id);
            e.dataTransfer.effectAllowed = "move";
            setDragId(node.id);
          },
          onDragEnd: () => {
            setDragId(null);
            setDropTarget(null);
          },
          onDragOver: (e: React.DragEvent) => {
            if (!dragId || dragId === node.id) return;
            if (draggedSubtree().has(node.id)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDropTarget(node.id);
          },
          onDragLeave: () =>
            setDropTarget((cur) => (cur === node.id ? null : cur)),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            if (dragId && dragId !== node.id && !draggedSubtree().has(node.id)) {
              ops.onMove(dragId, node.id);
            }
            setDragId(null);
            setDropTarget(null);
          },
        }
      : {};

  const startRename = (node: FolderNode) => {
    closeMenu();
    setRenamingId(node.id);
    setRenameDraft(node.title);
  };

  const commitRename = (id: string) => {
    const title = renameDraft.trim();
    setRenamingId(null);
    if (ops && title) ops.onRename(id, title);
  };

  const startAddChild = (id: string) => {
    closeMenu();
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(id); // reveal where the new subfolder will land
      return next;
    });
    setAddingChildFor(id);
    setChildDraft("");
  };

  const commitAddChild = () => {
    const title = childDraft.trim();
    const parent = addingChildFor;
    setAddingChildFor(null);
    if (ops && parent && title) ops.onCreateChild(parent, title);
  };

  /** The ⋯ button + popover menu for one folder row. */
  const rowMenu = (node: FolderNode) => {
    if (!ops) return null;
    const open = menuFor === node.id;
    const armed = armedDelete === node.id;
    return (
      <div className="relative flex-none">
        <button
          type="button"
          aria-label={`Folder options for ${node.title}`}
          onClick={(e) => {
            e.stopPropagation();
            setArmedDelete(null);
            setMenuFor(open ? null : node.id);
          }}
          className={`-m-1 rounded p-1 ${
            open
              ? "text-ink-200"
              : "text-ink-600 hover:text-ink-300 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
          }`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
        {open && (
          <>
            <button
              type="button"
              aria-label="Close menu"
              onClick={closeMenu}
              className="fixed inset-0 z-30 cursor-default"
            />
            <div className="absolute right-0 top-full z-40 mt-1 flex w-44 flex-col overflow-hidden rounded-xl border border-white/10 bg-bar/95 py-1 shadow-[0_12px_32px_rgba(0,0,0,0.55)] backdrop-blur-[10px]">
              <MenuItem
                Icon={Pencil}
                label="Rename"
                onClick={() => startRename(node)}
              />
              <MenuItem
                Icon={FolderPlus}
                label="New subfolder"
                onClick={() => startAddChild(node.id)}
              />
              {node.depth > 0 && (
                <MenuItem
                  Icon={ArrowUpToLine}
                  label="Move to top level"
                  onClick={() => {
                    closeMenu();
                    ops.onMove(node.id, null);
                  }}
                />
              )}
              <MenuItem
                Icon={Trash2}
                label={armed ? "Really delete?" : "Delete folder"}
                danger
                onClick={() => {
                  if (!armed) {
                    setArmedDelete(node.id);
                    return;
                  }
                  closeMenu();
                  ops.onDelete(node.id);
                }}
              />
              {armed && (
                <p className="px-3 pb-1.5 pt-0.5 text-[0.65625rem] leading-snug text-ink-600">
                  Notes inside move to Trash.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    );
  };

  /** Inline rename input, swapped in place of a row's label. */
  const renameInput = (node: FolderNode, cls: string) => (
    <input
      autoFocus
      type="text"
      value={renameDraft}
      onChange={(e) => setRenameDraft(e.target.value)}
      onBlur={() => commitRename(node.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitRename(node.id);
        } else if (e.key === "Escape") {
          e.preventDefault();
          setRenamingId(null);
        }
      }}
      className={`min-w-0 flex-1 rounded border border-sage/40 bg-white/5 px-1 py-0.5 focus:outline-none ${cls}`}
    />
  );

  /** The "New subfolder" inline prompt, indented under its parent row. */
  const addChildRow = (parentId: string) => {
    if (addingChildFor !== parentId) return null;
    return (
      <div className="ml-3 flex items-center gap-2 border-l border-white/9 py-1 pl-2">
        <span className="block h-3.5 w-3.5 flex-none" />
        <Folder className="h-[0.9375rem] w-[0.9375rem] flex-none text-ink-400" />
        <input
          autoFocus
          type="text"
          value={childDraft}
          placeholder="Subfolder name"
          onChange={(e) => setChildDraft(e.target.value)}
          onBlur={commitAddChild}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitAddChild();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setAddingChildFor(null);
            }
          }}
          className="min-w-0 flex-1 rounded border border-sage/40 bg-white/5 px-1 py-0.5 text-[0.8125rem] text-ink-100 placeholder:text-ink-600 focus:outline-none"
        />
      </div>
    );
  };

  const sectionRow = (
    id: string | null,
    label: string,
    count: React.ReactNode,
    hasChildren: boolean,
    node?: FolderNode,
  ) => {
    const isOpen = id === null ? !collapsed.has("__inbox") : !collapsed.has(id);
    const isSelected = !phone && selectedId === id;
    const isDropTarget = node && dropTarget === node.id;
    return (
      <div
        {...(node ? dragProps(node) : {})}
        className={`group flex items-center gap-2 rounded-[0.4375rem] px-1.5 ${
          phone ? "min-h-10 pb-1.5 pt-3.5" : "min-h-8 pb-1 pt-3"
        } ${isSelected ? "bg-sage/12" : ""} ${
          isDropTarget ? "bg-sage/10 ring-1 ring-sage/40" : ""
        }`}
      >
        <button
          type="button"
          aria-label={isOpen ? `Collapse ${label}` : `Expand ${label}`}
          onClick={() => toggle(id ?? "__inbox")}
          className="-m-1 flex-none p-1 text-ink-600"
          disabled={!hasChildren}
        >
          {hasChildren ? (
            isOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )
          ) : (
            <span className="block h-3.5 w-3.5" />
          )}
        </button>
        {node && renamingId === node.id ? (
          renameInput(
            node,
            "text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-ink-100",
          )
        ) : (
          <button
            type="button"
            onClick={() => (onSelect ? onSelect(id) : toggle(id ?? "__inbox"))}
            className={`min-w-0 flex-1 truncate text-left text-[0.6875rem] font-medium uppercase tracking-[0.1em] ${
              isSelected ? "text-ink-100" : "text-ink-400"
            }`}
          >
            {label}
          </button>
        )}
        {count}
        {node && rowMenu(node)}
      </div>
    );
  };

  const folderRow = (node: FolderNode) => {
    const hasKids =
      node.children.length > 0 ||
      (phone && (notesByFolder?.get(node.id)?.length ?? 0) > 0);
    const isOpen = !collapsed.has(node.id);
    const isSelected = !phone && selectedId === node.id;
    const isDropTarget = dropTarget === node.id;
    return (
      <div
        {...dragProps(node)}
        className={`group flex items-center gap-2 rounded-[0.4375rem] px-1.5 ${
          phone ? "min-h-11 py-1" : "min-h-8 py-1"
        } ${isSelected ? "bg-sage/12" : "hover:bg-white/4"} ${
          isDropTarget ? "bg-sage/10 ring-1 ring-sage/40" : ""
        }`}
      >
        <button
          type="button"
          aria-label={isOpen ? `Collapse ${node.title}` : `Expand ${node.title}`}
          onClick={() => toggle(node.id)}
          className="-m-1 flex-none p-1 text-ink-600"
          disabled={!hasKids}
        >
          {hasKids ? (
            isOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )
          ) : (
            <span className="block h-3.5 w-3.5" />
          )}
        </button>
        {node.emoji ? (
          <span className="w-[0.9375rem] flex-none text-center text-[0.8125rem] leading-none">
            {node.emoji}
          </span>
        ) : (
          <Folder
            className="h-[0.9375rem] w-[0.9375rem] flex-none text-ink-400"
            style={node.color ? { color: node.color } : undefined}
          />
        )}
        {renamingId === node.id ? (
          renameInput(node, "text-[0.8125rem] font-medium text-ink-100")
        ) : (
          <button
            type="button"
            onClick={() => (onSelect ? onSelect(node.id) : toggle(node.id))}
            className={`min-w-0 flex-1 truncate text-left text-[0.8125rem] font-medium ${
              isSelected ? "text-ink-100" : "text-ink-200"
            }`}
          >
            {node.title}
          </button>
        )}
        {node.totalCount > 0 && (
          <span className="flex-none text-[0.6875rem] text-ink-600">
            {node.totalCount}
          </span>
        )}
        {rowMenu(node)}
      </div>
    );
  };

  const noteRow = (note: TreeNoteRow) => (
    <Link
      key={note.id}
      href={noteHref ? noteHref(note.id) : `/app/notes/${note.id}`}
      className={`flex items-center gap-2 rounded-[0.4375rem] px-1.5 hover:bg-white/4 ${
        phone ? "min-h-11 py-1.5" : "min-h-8 py-1"
      }`}
    >
      <span className="block h-3.5 w-3.5 flex-none" />
      <FileText className="h-[0.9375rem] w-[0.9375rem] flex-none text-ink-500" />
      <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink-200">
        {note.title || "Untitled"}
      </span>
    </Link>
  );

  const renderChildren = (node: FolderNode) => {
    if (collapsed.has(node.id)) return addChildRow(node.id);
    const notes = phone ? (notesByFolder?.get(node.id) ?? []) : [];
    if (
      node.children.length === 0 &&
      notes.length === 0 &&
      addingChildFor !== node.id
    ) {
      return null;
    }
    return (
      <>
        {addChildRow(node.id)}
        <div className="ml-3 flex flex-col border-l border-white/9 pl-2">
          {node.children.map((child) => (
            <div key={child.id}>
              {folderRow(child)}
              {renderChildren(child)}
            </div>
          ))}
          {notes.map(noteRow)}
        </div>
      </>
    );
  };

  const renderSection = (node: FolderNode) => {
    const notes = phone ? (notesByFolder?.get(node.id) ?? []) : [];
    const hasKids = node.children.length > 0 || notes.length > 0;
    const isOpen = !collapsed.has(node.id);
    return (
      <div key={node.id}>
        {sectionRow(
          node.id,
          node.title,
          node.totalCount > 0 ? (
            <span className="flex-none pr-0.5 text-[0.6875rem] text-ink-600">
              {node.totalCount}
            </span>
          ) : null,
          hasKids,
          node,
        )}
        {addChildRow(node.id)}
        {isOpen && hasKids && (
          <div className={phone ? "pl-[1.375rem]" : "pl-[1.125rem]"}>
            {node.children.map((child) => (
              <div key={child.id}>
                {folderRow(child)}
                {renderChildren(child)}
              </div>
            ))}
            {notes.map(noteRow)}
          </div>
        )}
      </div>
    );
  };

  const inboxOpen = !collapsed.has("__inbox");

  return (
    <div className="flex flex-col">
      {/* Automatic Inbox: unfiled notes, always on top. */}
      {phone ? (
        <>
          {sectionRow(
            null,
            "Inbox",
            <InboxBadge count={inboxCount} />,
            (inboxNotes?.length ?? 0) > 0,
          )}
          {inboxOpen && (inboxNotes?.length ?? 0) > 0 && (
            <div className="pl-[1.375rem]">{inboxNotes!.map(noteRow)}</div>
          )}
        </>
      ) : (
        <button
          type="button"
          onClick={() => onSelect?.(null)}
          className={`flex items-center gap-2 rounded-[0.4375rem] px-1.5 py-1.5 text-left ${
            selectedId === null ? "bg-sage/12" : "hover:bg-white/4"
          }`}
        >
          <Inbox className="ml-0.5 h-[0.9375rem] w-[0.9375rem] flex-none text-ink-400" />
          <span
            className={`min-w-0 flex-1 truncate text-[0.6875rem] font-medium uppercase tracking-[0.1em] ${
              selectedId === null ? "text-ink-100" : "text-ink-400"
            }`}
          >
            Inbox
          </span>
          <InboxBadge count={inboxCount} />
        </button>
      )}

      {tree.map(renderSection)}

      {tree.length === 0 && (
        <p className="px-2 py-3 text-xs leading-relaxed text-ink-600">
          No folders yet — boards you create become folders here.
        </p>
      )}
    </div>
  );
}

function MenuItem({
  Icon,
  label,
  danger,
  onClick,
}: {
  Icon: typeof Pencil;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`flex items-center gap-2.5 px-3 py-2 text-left text-[0.8125rem] hover:bg-white/6 ${
        danger ? "text-red-400" : "text-ink-200"
      }`}
    >
      <Icon className="h-3.5 w-3.5 flex-none" />
      {label}
    </button>
  );
}

function InboxBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="flex h-5 min-w-6 flex-none items-center justify-center rounded-full bg-sage/16 px-1.5 text-[0.6875rem] font-semibold text-sage">
      {count}
    </span>
  );
}
