"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, FileText, Folder } from "lucide-react";

import type { SidebarBubble } from "./BubbleTree";

export interface SidebarBubbleNote {
  id: string;
  title: string;
  bubbleId: string;
}

/**
 * Folders in the Notes sidebar, backed by bubbles that opted in (isFolder).
 * A folder bubble mirrors its entire bubble subtree: every descendant bubble
 * shows as a nested sub-folder, and each folder lists its own notes (links to
 * the standalone note editor). Only the topmost folder in a chain is an opt-in
 * point — its descendants are folders automatically.
 */
export function NotesFolders({
  bubbles,
  notes,
  onNavigate,
}: {
  bubbles: SidebarBubble[];
  notes: SidebarBubbleNote[];
  onNavigate?: () => void;
}) {
  const { childrenOf, notesOf, rootFolders } = useMemo(() => {
    const byId = new Map<string, SidebarBubble>();
    for (const b of bubbles) byId.set(b.id, b);

    const childrenOf = new Map<string, SidebarBubble[]>();
    for (const b of bubbles) {
      if (b.parentId) {
        const arr = childrenOf.get(b.parentId) ?? [];
        arr.push(b);
        childrenOf.set(b.parentId, arr);
      }
    }

    const notesOf = new Map<string, SidebarBubbleNote[]>();
    for (const n of notes) {
      const arr = notesOf.get(n.bubbleId) ?? [];
      arr.push(n);
      notesOf.set(n.bubbleId, arr);
    }

    // A folder is a "root folder" only if no ancestor is already a folder —
    // descendants of a folder are nested automatically, not separate roots.
    const hasFolderAncestor = (b: SidebarBubble): boolean => {
      let p = b.parentId ? byId.get(b.parentId) : undefined;
      const seen = new Set<string>();
      while (p && !seen.has(p.id)) {
        seen.add(p.id);
        if (p.isFolder) return true;
        p = p.parentId ? byId.get(p.parentId) : undefined;
      }
      return false;
    };
    const rootFolders = bubbles.filter(
      (b) => b.isFolder && !hasFolderAncestor(b),
    );

    return { childrenOf, notesOf, rootFolders };
  }, [bubbles, notes]);

  if (rootFolders.length === 0) {
    return (
      <div className="px-2 py-1 text-xs italic text-neutral-400">
        No folders — make a bubble a folder to see it here
      </div>
    );
  }

  return (
    <ul>
      {rootFolders.map((f) => (
        <FolderNode
          key={f.id}
          folder={f}
          childrenOf={childrenOf}
          notesOf={notesOf}
          depth={0}
          onNavigate={onNavigate}
        />
      ))}
    </ul>
  );
}

function FolderNode({
  folder,
  childrenOf,
  notesOf,
  depth,
  onNavigate,
}: {
  folder: SidebarBubble;
  childrenOf: Map<string, SidebarBubble[]>;
  notesOf: Map<string, SidebarBubbleNote[]>;
  depth: number;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const pathname = usePathname();
  // Every child bubble becomes a nested sub-folder, regardless of its own
  // isFolder flag (the topmost folder opted the whole subtree in).
  const subFolders = childrenOf.get(folder.id) ?? [];
  const notes = notesOf.get(folder.id) ?? [];
  const hasContent = subFolders.length > 0 || notes.length > 0;

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ paddingLeft: `${depth * 12}px` }}
        className="flex w-full items-center gap-1 rounded py-1 pr-2 text-sm text-neutral-700 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform ${
            hasContent ? "" : "invisible"
          } ${open ? "rotate-90" : ""}`}
        />
        {folder.emoji ? (
          <span className="text-xs">{folder.emoji}</span>
        ) : (
          <Folder className="h-3.5 w-3.5 shrink-0 text-blue-500" />
        )}
        <span className="truncate">{folder.title || "Untitled"}</span>
      </button>

      {open && hasContent && (
        <ul>
          {subFolders.map((sf) => (
            <FolderNode
              key={sf.id}
              folder={sf}
              childrenOf={childrenOf}
              notesOf={notesOf}
              depth={depth + 1}
              onNavigate={onNavigate}
            />
          ))}
          {notes.map((n) => {
            const href = `/app/notes/${n.id}`;
            const active = pathname === href;
            return (
              <li key={n.id}>
                <Link
                  href={href}
                  onClick={onNavigate}
                  style={{ paddingLeft: `${(depth + 1) * 12 + 6}px` }}
                  className={`flex items-center gap-1.5 rounded py-1 pr-2 text-sm ${
                    active
                      ? "bg-neutral-200/70 font-medium dark:bg-neutral-800"
                      : "text-neutral-600 hover:bg-neutral-200/60 dark:text-neutral-400 dark:hover:bg-neutral-800"
                  }`}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                  <span className="truncate">{n.title || "Untitled"}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
