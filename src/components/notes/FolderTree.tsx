"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Inbox,
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
 */

export interface TreeNoteRow {
  id: string;
  title: string;
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
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const phone = variant === "phone";

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sectionRow = (
    id: string | null,
    label: string,
    count: React.ReactNode,
    hasChildren: boolean,
  ) => {
    const isOpen = id === null ? !collapsed.has("__inbox") : !collapsed.has(id);
    const isSelected = !phone && selectedId === id;
    return (
      <div
        className={`flex items-center gap-2 rounded-[0.4375rem] px-1.5 ${
          phone ? "min-h-10 pb-1.5 pt-3.5" : "min-h-8 pb-1 pt-3"
        } ${isSelected ? "bg-sage/12" : ""}`}
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
        <button
          type="button"
          onClick={() => (onSelect ? onSelect(id) : toggle(id ?? "__inbox"))}
          className={`min-w-0 flex-1 truncate text-left text-[0.6875rem] font-medium uppercase tracking-[0.1em] ${
            isSelected ? "text-ink-100" : "text-ink-400"
          }`}
        >
          {label}
        </button>
        {count}
      </div>
    );
  };

  const folderRow = (node: FolderNode) => {
    const hasKids =
      node.children.length > 0 ||
      (phone && (notesByFolder?.get(node.id)?.length ?? 0) > 0);
    const isOpen = !collapsed.has(node.id);
    const isSelected = !phone && selectedId === node.id;
    return (
      <div
        className={`flex items-center gap-2 rounded-[0.4375rem] px-1.5 ${
          phone ? "min-h-11 py-1" : "min-h-8 py-1"
        } ${isSelected ? "bg-sage/12" : "hover:bg-white/4"}`}
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
        <button
          type="button"
          onClick={() => (onSelect ? onSelect(node.id) : toggle(node.id))}
          className={`min-w-0 flex-1 truncate text-left text-[0.8125rem] font-medium ${
            isSelected ? "text-ink-100" : "text-ink-200"
          }`}
        >
          {node.title}
        </button>
        {node.totalCount > 0 && (
          <span className="flex-none text-[0.6875rem] text-ink-600">
            {node.totalCount}
          </span>
        )}
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
    if (collapsed.has(node.id)) return null;
    const notes = phone ? (notesByFolder?.get(node.id) ?? []) : [];
    if (node.children.length === 0 && notes.length === 0) return null;
    return (
      <div className="ml-3 flex flex-col border-l border-white/9 pl-2">
        {node.children.map((child) => (
          <div key={child.id}>
            {folderRow(child)}
            {renderChildren(child)}
          </div>
        ))}
        {notes.map(noteRow)}
      </div>
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
        )}
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

function InboxBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="flex h-5 min-w-6 flex-none items-center justify-center rounded-full bg-sage/16 px-1.5 text-[0.6875rem] font-semibold text-sage">
      {count}
    </span>
  );
}
