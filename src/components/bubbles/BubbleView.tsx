"use client";

import { useMemo, useState, useTransition } from "react";
import { ChevronRight, Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import { NoteEditor } from "@/components/notes/NoteEditor";
import {
  createBubbleAction,
  createBubbleNoteAction,
  deleteBubbleAction,
  getBubbleNoteAction,
  renameBubbleAction,
  trashBubbleNoteAction,
} from "@/app/app/bubbles/actions";
import type { SerializedEditorState } from "lexical";

export interface BubbleData {
  id: string;
  parentId: string | null;
  title: string;
  notes: string;
}

export interface BubbleNoteData {
  id: string;
  bubbleId: string;
  title: string;
}

interface LoadedNote {
  id: string;
  title: string;
  content: SerializedEditorState | null;
}

// Muted palette cycled by position — gives circles variety without noise.
const PALETTE = [
  "bg-sky-100 border-sky-300 text-sky-900 hover:bg-sky-200 dark:bg-sky-950 dark:border-sky-800 dark:text-sky-100 dark:hover:bg-sky-900",
  "bg-violet-100 border-violet-300 text-violet-900 hover:bg-violet-200 dark:bg-violet-950 dark:border-violet-800 dark:text-violet-100 dark:hover:bg-violet-900",
  "bg-emerald-100 border-emerald-300 text-emerald-900 hover:bg-emerald-200 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-100 dark:hover:bg-emerald-900",
  "bg-amber-100 border-amber-300 text-amber-900 hover:bg-amber-200 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-100 dark:hover:bg-amber-900",
  "bg-rose-100 border-rose-300 text-rose-900 hover:bg-rose-200 dark:bg-rose-950 dark:border-rose-800 dark:text-rose-100 dark:hover:bg-rose-900",
  "bg-teal-100 border-teal-300 text-teal-900 hover:bg-teal-200 dark:bg-teal-950 dark:border-teal-800 dark:text-teal-100 dark:hover:bg-teal-900",
];

export function BubbleView({
  rootId,
  nodes,
  notes,
}: {
  rootId: string;
  nodes: BubbleData[];
  notes: BubbleNoteData[];
}) {
  const [currentId, setCurrentId] = useState(rootId);
  const [, startTransition] = useTransition();

  // Editor overlay state.
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<LoadedNote | null>(null);
  const [loadingNote, setLoadingNote] = useState(false);

  const { byId, childrenOf } = useMemo(() => {
    const byId = new Map<string, BubbleData>();
    const childrenOf = new Map<string, BubbleData[]>();
    for (const n of nodes) byId.set(n.id, n);
    for (const n of nodes) {
      if (n.parentId) {
        const arr = childrenOf.get(n.parentId) ?? [];
        arr.push(n);
        childrenOf.set(n.parentId, arr);
      }
    }
    return { byId, childrenOf };
  }, [nodes]);

  const notesOf = useMemo(() => {
    const map = new Map<string, BubbleNoteData[]>();
    for (const n of notes) {
      const arr = map.get(n.bubbleId) ?? [];
      arr.push(n);
      map.set(n.bubbleId, arr);
    }
    return map;
  }, [notes]);

  const current = byId.get(currentId) ?? byId.get(rootId);
  const effectiveId = current?.id ?? rootId;

  const breadcrumb = useMemo(() => {
    const path: BubbleData[] = [];
    let node = current;
    const seen = new Set<string>();
    while (node && !seen.has(node.id)) {
      seen.add(node.id);
      path.unshift(node);
      node = node.parentId ? byId.get(node.parentId) : undefined;
    }
    return path;
  }, [current, byId]);

  const children = childrenOf.get(effectiveId) ?? [];
  const bubbleNotes = notesOf.get(effectiveId) ?? [];

  if (!current) return null;
  const isRoot = !current.parentId;

  // --- Note editor overlay ---------------------------------------------------
  const openNote = async (id: string) => {
    setEditingNoteId(id);
    setEditingNote(null);
    setLoadingNote(true);
    const payload = await getBubbleNoteAction(id);
    if (!payload) {
      setEditingNoteId(null);
      setLoadingNote(false);
      return;
    }
    setEditingNote(payload);
    setLoadingNote(false);
  };

  const closeEditor = () => {
    setEditingNoteId(null);
    setEditingNote(null);
    setLoadingNote(false);
  };

  const addNote = async () => {
    const title = window.prompt("New note title");
    if (title === null) return;
    const id = await createBubbleNoteAction(effectiveId, title || "Untitled");
    setEditingNote({ id, title: title || "Untitled", content: null });
    setEditingNoteId(id);
  };

  // --- Bubble actions --------------------------------------------------------
  const addChild = () => {
    const title = window.prompt("New bubble title");
    if (title === null) return;
    startTransition(() => {
      void createBubbleAction(effectiveId, title || "Untitled");
    });
  };

  const renameCurrent = () => {
    const title = window.prompt("Rename bubble", current.title);
    if (title === null) return;
    startTransition(() => {
      void renameBubbleAction(effectiveId, title || "Untitled");
    });
  };

  const deleteCurrent = () => {
    if (!current.parentId) return;
    const childCount = children.length;
    const ok = window.confirm(
      childCount > 0
        ? `Delete “${current.title}” and its ${childCount} child bubble${
            childCount === 1 ? "" : "s"
          } (and all notes under them)? This can’t be undone.`
        : `Delete “${current.title}” and its notes? This can’t be undone.`,
    );
    if (!ok) return;
    const parentId = current.parentId;
    setCurrentId(parentId);
    startTransition(() => {
      void deleteBubbleAction(current.id);
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-neutral-200 px-4 py-2.5 text-sm dark:border-neutral-800">
        {breadcrumb.map((b, i) => (
          <span key={b.id} className="flex items-center gap-1">
            {i > 0 && (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
            )}
            <button
              type="button"
              onClick={() => setCurrentId(b.id)}
              className={`rounded px-1.5 py-0.5 ${
                b.id === effectiveId
                  ? "font-semibold text-neutral-900 dark:text-neutral-100"
                  : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800"
              }`}
            >
              {b.title || "Untitled"}
            </button>
          </span>
        ))}
      </nav>

      {/* Current bubble */}
      <div
        key={effectiveId}
        className="bubble-pop mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-6 overflow-y-auto px-4 py-6"
      >
        <div className="flex items-start gap-2">
          <h1 className="flex-1 text-2xl font-semibold tracking-tight">
            {current.title || "Untitled"}
          </h1>
          <button
            type="button"
            onClick={renameCurrent}
            aria-label="Rename bubble"
            title="Rename"
            className="rounded p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <Pencil className="h-4 w-4" />
          </button>
          {!isRoot && (
            <button
              type="button"
              onClick={deleteCurrent}
              aria-label="Delete bubble"
              title="Delete bubble (and its subtree)"
              className="rounded p-2 text-neutral-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Notes */}
        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-400">
            {bubbleNotes.length > 0
              ? `${bubbleNotes.length} note${bubbleNotes.length === 1 ? "" : "s"}`
              : "Notes"}
          </h2>
          <div className="flex flex-wrap gap-4">
            {bubbleNotes.map((note) => (
              <NoteCard
                key={note.id}
                title={note.title}
                onClick={() => openNote(note.id)}
              />
            ))}
            <AddNoteCard onClick={addNote} />
          </div>
        </section>

        {/* Child bubbles */}
        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-400">
            {children.length > 0
              ? `${children.length} bubble${children.length === 1 ? "" : "s"}`
              : "Bubbles"}
          </h2>
          <div className="flex flex-wrap gap-4 pb-6">
            {children.map((child, i) => {
              const grandkids = childrenOf.get(child.id)?.length ?? 0;
              return (
                <button
                  key={child.id}
                  type="button"
                  onClick={() => setCurrentId(child.id)}
                  className={`group flex aspect-square w-28 flex-col items-center justify-center gap-1 rounded-full border p-3 text-center transition-transform duration-150 hover:scale-105 active:scale-95 sm:w-32 ${
                    PALETTE[i % PALETTE.length]
                  }`}
                >
                  <span className="line-clamp-3 text-sm font-medium leading-tight">
                    {child.title || "Untitled"}
                  </span>
                  {grandkids > 0 && (
                    <span className="text-[11px] opacity-70">{grandkids} ↓</span>
                  )}
                </button>
              );
            })}
            <button
              type="button"
              onClick={addChild}
              className="flex aspect-square w-28 flex-col items-center justify-center gap-1 rounded-full border-2 border-dashed border-neutral-300 text-neutral-400 transition-colors hover:border-neutral-400 hover:text-neutral-600 active:scale-95 sm:w-32 dark:border-neutral-700 dark:hover:border-neutral-500"
            >
              <Plus className="h-6 w-6" />
              <span className="text-xs">Add bubble</span>
            </button>
          </div>
        </section>
      </div>

      {/* Note editor overlay */}
      {editingNoteId && (
        <div className="fixed inset-0 z-50 flex">
          <button
            type="button"
            aria-label="Close editor"
            onClick={closeEditor}
            className="absolute inset-0 bg-black/30"
          />
          <div className="relative z-10 flex h-full w-full flex-col overflow-hidden bg-white dark:bg-neutral-950 sm:mx-auto sm:my-6 sm:h-[calc(100%-3rem)] sm:w-[min(100%-4rem,56rem)] sm:rounded-xl sm:border sm:border-neutral-200 sm:shadow-2xl dark:sm:border-neutral-800">
            {/* Context strip: where you are + other notes/bubbles here */}
            <div className="border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
              <div className="text-xs text-neutral-500">
                In “{current.title || "Untitled"}”
              </div>
              {(bubbleNotes.length > 1 || children.length > 0) && (
                <div className="mt-1.5 flex items-center gap-2 overflow-x-auto whitespace-nowrap pb-0.5">
                  {bubbleNotes
                    .filter((n) => n.id !== editingNoteId)
                    .map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => openNote(n.id)}
                        className="shrink-0 rounded-full border border-neutral-200 px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                      >
                        {n.title || "Untitled"}
                      </button>
                    ))}
                  {children.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        closeEditor();
                        setCurrentId(c.id);
                      }}
                      className="shrink-0 rounded-full border border-dashed border-neutral-300 px-2.5 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800"
                    >
                      ◯ {c.title || "Untitled"}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1">
              {loadingNote || !editingNote ? (
                <div className="flex h-full items-center justify-center text-neutral-400">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : (
                <NoteEditor
                  key={editingNote.id}
                  noteId={editingNote.id}
                  initialTitle={editingNote.title}
                  initialContent={editingNote.content}
                  onClose={closeEditor}
                  trashAction={trashBubbleNoteAction}
                  onTrashed={closeEditor}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** A note-shaped icon (a little page) with the title beneath it. */
function NoteCard({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-24 flex-col items-center gap-2 sm:w-28"
    >
      <div className="relative h-28 w-20 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:shadow-md group-active:scale-95 sm:h-32 sm:w-24 dark:border-neutral-700 dark:bg-neutral-800">
        {/* folded corner */}
        <div className="absolute right-0 top-0 h-5 w-5 bg-neutral-100 dark:bg-neutral-700" style={{ clipPath: "polygon(100% 0, 0 0, 100% 100%)" }} />
        {/* faux text lines */}
        <div className="absolute inset-x-3 top-5 space-y-2">
          <div className="h-1.5 w-3/4 rounded bg-neutral-200 dark:bg-neutral-600" />
          <div className="h-1.5 w-full rounded bg-neutral-200 dark:bg-neutral-600" />
          <div className="h-1.5 w-5/6 rounded bg-neutral-200 dark:bg-neutral-600" />
          <div className="h-1.5 w-2/3 rounded bg-neutral-200 dark:bg-neutral-600" />
        </div>
      </div>
      <span className="line-clamp-2 text-center text-xs font-medium leading-tight">
        {title || "Untitled"}
      </span>
    </button>
  );
}

function AddNoteCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-24 flex-col items-center gap-2 sm:w-28"
    >
      <div className="flex h-28 w-20 items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 text-neutral-400 transition-colors hover:border-neutral-400 hover:text-neutral-600 active:scale-95 sm:h-32 sm:w-24 dark:border-neutral-700 dark:hover:border-neutral-500">
        <Plus className="h-6 w-6" />
      </div>
      <span className="text-center text-xs text-neutral-400">Add note</span>
    </button>
  );
}
