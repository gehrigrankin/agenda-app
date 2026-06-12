"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder as FolderIcon,
  FolderPlus,
  NotebookPen,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import clsx from "clsx";
import { useStore } from "@/lib/store";
import type { Folder, Note, Section } from "@/lib/types";

interface SidebarProps {
  selectedNoteId: string | null;
  onSelectNote: (id: string | null) => void;
}

function InlineRename({
  value,
  onCommit,
  onCancel,
}: {
  value: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onCommit(trimmed);
    else onCancel();
  };
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") onCancel();
      }}
      className="w-full rounded border border-sky-400 bg-white px-1 py-0 text-sm outline-none dark:bg-zinc-900"
    />
  );
}

function RowActions({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-auto hidden shrink-0 items-center gap-0.5 group-hover:flex">
      {children}
    </span>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Plus;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
    >
      <Icon size={14} />
    </button>
  );
}

function NoteRow({
  note,
  depth,
  selected,
  onSelect,
}: {
  note: Note;
  depth: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { dispatch } = useStore();
  const [renaming, setRenaming] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      onDoubleClick={() => setRenaming(true)}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      className={clsx(
        "group flex cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 text-sm",
        selected
          ? "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      )}
    >
      <FileText size={14} className="shrink-0 text-zinc-400" />
      {renaming ? (
        <InlineRename
          value={note.title}
          onCommit={(title) => {
            dispatch({ type: "renameNote", id: note.id, title });
            setRenaming(false);
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <span className="truncate">{note.title}</span>
      )}
      <RowActions>
        <ActionButton
          icon={Trash2}
          label="Delete note"
          onClick={() => dispatch({ type: "deleteNote", id: note.id })}
        />
      </RowActions>
    </div>
  );
}

function FolderRow({
  folder,
  depth,
  selectedNoteId,
  onSelectNote,
}: {
  folder: Folder;
  depth: number;
  selectedNoteId: string | null;
  onSelectNote: (id: string) => void;
}) {
  const { data, dispatch } = useStore();
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState(false);

  const childFolders = data.folders.filter((f) => f.parentFolderId === folder.id);
  const notes = data.notes.filter((n) => n.folderId === folder.id);

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => e.key === "Enter" && setOpen(!open)}
        onDoubleClick={() => setRenaming(true)}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className="group flex cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        {open ? (
          <ChevronDown size={14} className="shrink-0 text-zinc-400" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-zinc-400" />
        )}
        <FolderIcon size={14} className="shrink-0 text-zinc-400" />
        {renaming ? (
          <InlineRename
            value={folder.name}
            onCommit={(name) => {
              dispatch({ type: "renameFolder", id: folder.id, name });
              setRenaming(false);
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span className="truncate font-medium">{folder.name}</span>
        )}
        <RowActions>
          <ActionButton
            icon={Plus}
            label="New note in folder"
            onClick={() => {
              dispatch({ type: "addNote", sectionId: folder.sectionId, folderId: folder.id });
              setOpen(true);
            }}
          />
          <ActionButton
            icon={FolderPlus}
            label="New subfolder"
            onClick={() => {
              dispatch({
                type: "addFolder",
                sectionId: folder.sectionId,
                parentFolderId: folder.id,
                name: "New folder",
              });
              setOpen(true);
            }}
          />
          <ActionButton
            icon={Trash2}
            label="Delete folder"
            onClick={() => dispatch({ type: "deleteFolder", id: folder.id })}
          />
        </RowActions>
      </div>
      {open && (
        <div>
          {childFolders.map((f) => (
            <FolderRow
              key={f.id}
              folder={f}
              depth={depth + 1}
              selectedNoteId={selectedNoteId}
              onSelectNote={onSelectNote}
            />
          ))}
          {notes.map((n) => (
            <NoteRow
              key={n.id}
              note={n}
              depth={depth + 1}
              selected={n.id === selectedNoteId}
              onSelect={() => onSelectNote(n.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SectionBlock({
  section,
  selectedNoteId,
  onSelectNote,
}: {
  section: Section;
  selectedNoteId: string | null;
  onSelectNote: (id: string) => void;
}) {
  const { data, dispatch } = useStore();
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState(false);

  const rootFolders = data.folders.filter(
    (f) => f.sectionId === section.id && f.parentFolderId === null
  );
  const rootNotes = data.notes.filter(
    (n) => n.sectionId === section.id && n.folderId === null
  );

  return (
    <div className="mb-1">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => e.key === "Enter" && setOpen(!open)}
        onDoubleClick={() => setRenaming(true)}
        className="group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: section.color }}
        />
        {renaming ? (
          <InlineRename
            value={section.name}
            onCommit={(name) => {
              dispatch({ type: "renameSection", id: section.id, name });
              setRenaming(false);
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span className="truncate font-semibold text-zinc-800 dark:text-zinc-100">
            {section.name}
          </span>
        )}
        <RowActions>
          <ActionButton
            icon={Plus}
            label="New note in section"
            onClick={() => {
              dispatch({ type: "addNote", sectionId: section.id, folderId: null });
              setOpen(true);
            }}
          />
          <ActionButton
            icon={FolderPlus}
            label="New folder in section"
            onClick={() => {
              dispatch({
                type: "addFolder",
                sectionId: section.id,
                parentFolderId: null,
                name: "New folder",
              });
              setOpen(true);
            }}
          />
          <ActionButton
            icon={Trash2}
            label="Delete section"
            onClick={() => dispatch({ type: "deleteSection", id: section.id })}
          />
        </RowActions>
      </div>
      {open && (
        <div>
          {rootFolders.map((f) => (
            <FolderRow
              key={f.id}
              folder={f}
              depth={1}
              selectedNoteId={selectedNoteId}
              onSelectNote={onSelectNote}
            />
          ))}
          {rootNotes.map((n) => (
            <NoteRow
              key={n.id}
              note={n}
              depth={1}
              selected={n.id === selectedNoteId}
              onSelect={() => onSelectNote(n.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({ selectedNoteId, onSelectNote }: SidebarProps) {
  const { data, dispatch } = useStore();
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return data.notes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) || n.textContent.toLowerCase().includes(q)
    );
  }, [query, data.notes]);

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-2 px-4 py-3">
        <NotebookPen size={20} className="text-sky-600 dark:text-sky-400" />
        <h1 className="text-lg font-bold tracking-tight">Notarium</h1>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes…"
            className="w-full rounded-md border border-zinc-200 bg-white py-1.5 pl-8 pr-7 text-sm outline-none placeholder:text-zinc-400 focus:border-sky-400 dark:border-zinc-800 dark:bg-zinc-900"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {results ? (
          <div>
            <p className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-zinc-400">
              {results.length} result{results.length === 1 ? "" : "s"}
            </p>
            {results.map((n) => (
              <NoteRow
                key={n.id}
                note={n}
                depth={0}
                selected={n.id === selectedNoteId}
                onSelect={() => onSelectNote(n.id)}
              />
            ))}
          </div>
        ) : (
          data.sections.map((s) => (
            <SectionBlock
              key={s.id}
              section={s}
              selectedNoteId={selectedNoteId}
              onSelectNote={onSelectNote}
            />
          ))
        )}
      </div>

      <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => dispatch({ type: "addSection", name: "New section" })}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <Plus size={15} />
          New section
        </button>
      </div>
    </aside>
  );
}
