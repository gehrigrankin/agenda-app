"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  Check,
  ChevronRight,
  Loader2,
  Palette,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { SerializedEditorState } from "lexical";

import { NoteEditor } from "@/components/notes/NoteEditor";
import {
  createBubbleAction,
  createBubbleNoteAction,
  deleteBubbleAction,
  getBubbleNoteAction,
  renameBubbleAction,
  trashBubbleNoteAction,
  updateBubbleStyleAction,
} from "@/app/app/bubbles/actions";

export interface BubbleData {
  id: string;
  parentId: string | null;
  title: string;
  emoji: string | null;
  color: string | null;
}

export interface BubbleNoteData {
  id: string;
  bubbleId: string;
  title: string;
  preview: string;
}

interface LoadedNote {
  id: string;
  title: string;
  content: SerializedEditorState | null;
}

// Named colors → circle classes (bg/border/text/hover) and a picker swatch.
const COLOR_NAMES = [
  "sky",
  "violet",
  "emerald",
  "amber",
  "rose",
  "teal",
] as const;
type ColorName = (typeof COLOR_NAMES)[number];

const COLOR_CLASSES: Record<ColorName, string> = {
  sky: "bg-sky-100 border-sky-300 text-sky-900 hover:bg-sky-200 dark:bg-sky-950 dark:border-sky-800 dark:text-sky-100 dark:hover:bg-sky-900",
  violet:
    "bg-violet-100 border-violet-300 text-violet-900 hover:bg-violet-200 dark:bg-violet-950 dark:border-violet-800 dark:text-violet-100 dark:hover:bg-violet-900",
  emerald:
    "bg-emerald-100 border-emerald-300 text-emerald-900 hover:bg-emerald-200 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-100 dark:hover:bg-emerald-900",
  amber:
    "bg-amber-100 border-amber-300 text-amber-900 hover:bg-amber-200 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-100 dark:hover:bg-amber-900",
  rose: "bg-rose-100 border-rose-300 text-rose-900 hover:bg-rose-200 dark:bg-rose-950 dark:border-rose-800 dark:text-rose-100 dark:hover:bg-rose-900",
  teal: "bg-teal-100 border-teal-300 text-teal-900 hover:bg-teal-200 dark:bg-teal-950 dark:border-teal-800 dark:text-teal-100 dark:hover:bg-teal-900",
};

const SWATCH: Record<ColorName, string> = {
  sky: "bg-sky-400",
  violet: "bg-violet-400",
  emerald: "bg-emerald-400",
  amber: "bg-amber-400",
  rose: "bg-rose-400",
  teal: "bg-teal-400",
};

const EMOJI_PRESETS = [
  "💡", "📁", "🧠", "✅", "📌", "🎯", "🔥", "⭐",
  "📝", "🌱", "🚀", "❤️", "🔧", "📚", "🎨", "💰",
];

function colorClassFor(bubble: BubbleData, index: number): string {
  const name = (bubble.color as ColorName) ?? COLOR_NAMES[index % COLOR_NAMES.length];
  return COLOR_CLASSES[name] ?? COLOR_CLASSES.sky;
}

export function BubbleView({
  rootId,
  initialBubbleId,
  nodes,
  notes,
}: {
  rootId: string;
  initialBubbleId: string | null;
  nodes: BubbleData[];
  notes: BubbleNoteData[];
}) {
  const [currentId, setCurrentId] = useState(
    initialBubbleId && initialBubbleId !== "" ? initialBubbleId : rootId,
  );
  const [, startTransition] = useTransition();

  // Editor overlay.
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<LoadedNote | null>(null);
  const [loadingNote, setLoadingNote] = useState(false);

  // Inline UI state.
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [adding, setAdding] = useState<null | "note" | "bubble">(null);
  const [addDraft, setAddDraft] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [stylePickerOpen, setStylePickerOpen] = useState(false);

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

  // Keep latest map for the popstate handler.
  const byIdRef = useRef(byId);
  byIdRef.current = byId;

  const current = byId.get(currentId) ?? byId.get(rootId);
  const effectiveId = current?.id ?? rootId;

  // Deep-linking: reflect navigation in the URL (?b=) and honor back/forward.
  const navigate = useCallback(
    (id: string) => {
      setCurrentId(id);
      if (typeof window !== "undefined") {
        window.history.pushState({ b: id }, "", `?b=${id}`);
      }
    },
    [],
  );

  useEffect(() => {
    const onPop = () => {
      const b = new URLSearchParams(window.location.search).get("b");
      setCurrentId(b && byIdRef.current.has(b) ? b : rootId);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [rootId]);

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

  // --- Inline create ---------------------------------------------------------
  const startAdd = (kind: "note" | "bubble") => {
    setAdding(kind);
    setAddDraft("");
  };

  const submitAdd = async () => {
    const kind = adding;
    const value = addDraft.trim();
    setAdding(null);
    setAddDraft("");
    if (!kind) return;
    if (kind === "bubble") {
      startTransition(() => {
        void createBubbleAction(effectiveId, value || "Untitled");
      });
    } else {
      const id = await createBubbleNoteAction(effectiveId, value || "Untitled");
      setEditingNote({ id, title: value || "Untitled", content: null });
      setEditingNoteId(id);
    }
  };

  // --- Inline rename ---------------------------------------------------------
  const startRename = () => {
    setTitleDraft(current.title);
    setEditingTitle(true);
  };
  const submitRename = () => {
    const value = titleDraft.trim() || "Untitled";
    setEditingTitle(false);
    startTransition(() => {
      void renameBubbleAction(effectiveId, value);
    });
  };

  // --- Style -----------------------------------------------------------------
  const setStyle = (style: { emoji?: string | null; color?: string | null }) => {
    startTransition(() => {
      void updateBubbleStyleAction(effectiveId, style);
    });
  };

  // --- Delete ----------------------------------------------------------------
  const doDelete = () => {
    if (!current.parentId) return;
    const parentId = current.parentId;
    setConfirmingDelete(false);
    navigate(parentId);
    startTransition(() => {
      void deleteBubbleAction(current.id);
    });
  };

  const totalDescendants = (id: string): number => {
    const kids = childrenOf.get(id) ?? [];
    return kids.reduce((sum, k) => sum + 1 + totalDescendants(k.id), 0);
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
              onClick={() => navigate(b.id)}
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${
                b.id === effectiveId
                  ? "font-semibold text-neutral-900 dark:text-neutral-100"
                  : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800"
              }`}
            >
              {b.emoji && <span>{b.emoji}</span>}
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
        <div className="relative flex items-start gap-2">
          {current.emoji && (
            <span className="text-2xl leading-9">{current.emoji}</span>
          )}
          {editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={submitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitRename();
                if (e.key === "Escape") setEditingTitle(false);
              }}
              className="flex-1 border-b border-neutral-300 bg-transparent text-2xl font-semibold tracking-tight outline-none dark:border-neutral-600"
            />
          ) : (
            <h1
              onClick={startRename}
              className="flex-1 cursor-text text-2xl font-semibold tracking-tight"
              title="Click to rename"
            >
              {current.title || "Untitled"}
            </h1>
          )}

          <button
            type="button"
            onClick={() => setStylePickerOpen((v) => !v)}
            aria-label="Bubble style"
            title="Emoji & color"
            className="rounded p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <Palette className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={startRename}
            aria-label="Rename bubble"
            title="Rename"
            className="rounded p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <Pencil className="h-4 w-4" />
          </button>
          {!isRoot && (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              aria-label="Delete bubble"
              title="Delete bubble (and its subtree)"
              className="rounded p-2 text-neutral-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}

          {stylePickerOpen && (
            <StylePicker
              current={current}
              onPick={(style) => setStyle(style)}
              onClose={() => setStylePickerOpen(false)}
            />
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
                preview={note.preview}
                onClick={() => openNote(note.id)}
              />
            ))}
            {adding === "note" ? (
              <InlineCreate
                shape="card"
                placeholder="Note title…"
                value={addDraft}
                onChange={setAddDraft}
                onSubmit={submitAdd}
                onCancel={() => setAdding(null)}
              />
            ) : (
              <AddTile shape="card" label="Add note" onClick={() => startAdd("note")} />
            )}
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
              const noteCount = notesOf.get(child.id)?.length ?? 0;
              const kidCount = childrenOf.get(child.id)?.length ?? 0;
              return (
                <button
                  key={child.id}
                  type="button"
                  onClick={() => navigate(child.id)}
                  className={`group flex aspect-square w-28 flex-col items-center justify-center gap-1 rounded-full border p-3 text-center shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md active:scale-95 sm:w-32 ${colorClassFor(
                    child,
                    i,
                  )}`}
                >
                  {child.emoji && (
                    <span className="text-2xl leading-none">{child.emoji}</span>
                  )}
                  <span className="line-clamp-2 text-sm font-medium leading-tight">
                    {child.title || "Untitled"}
                  </span>
                  {(noteCount > 0 || kidCount > 0) && (
                    <span className="flex items-center gap-1.5 text-[11px] opacity-70">
                      {noteCount > 0 && <span>📝 {noteCount}</span>}
                      {kidCount > 0 && <span>◯ {kidCount}</span>}
                    </span>
                  )}
                </button>
              );
            })}
            {adding === "bubble" ? (
              <InlineCreate
                shape="circle"
                placeholder="Bubble…"
                value={addDraft}
                onChange={setAddDraft}
                onSubmit={submitAdd}
                onCancel={() => setAdding(null)}
              />
            ) : (
              <AddTile
                shape="circle"
                label="Add bubble"
                onClick={() => startAdd("bubble")}
              />
            )}
          </div>
        </section>
      </div>

      {/* Delete confirm */}
      {confirmingDelete && (
        <ConfirmDialog
          title={`Delete “${current.title || "Untitled"}”?`}
          message={
            (() => {
              const d = totalDescendants(current.id);
              const n = bubbleNotes.length;
              const parts: string[] = [];
              if (d > 0) parts.push(`${d} nested bubble${d === 1 ? "" : "s"}`);
              if (n > 0) parts.push(`${n} note${n === 1 ? "" : "s"} here`);
              return parts.length
                ? `This also deletes ${parts.join(" and ")}. This can’t be undone.`
                : "This can’t be undone.";
            })()
          }
          confirmLabel="Delete"
          onConfirm={doDelete}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}

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
                        navigate(c.id);
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function NoteCard({
  title,
  preview,
  onClick,
}: {
  title: string;
  preview: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-24 flex-col items-center gap-2 sm:w-28"
    >
      <div className="relative h-28 w-20 overflow-hidden rounded-lg border border-neutral-200 bg-white p-2.5 text-left shadow-sm transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:shadow-md group-active:scale-95 sm:h-32 sm:w-24 dark:border-neutral-700 dark:bg-neutral-800">
        <div
          className="absolute right-0 top-0 h-4 w-4 bg-neutral-100 dark:bg-neutral-700"
          style={{ clipPath: "polygon(100% 0, 0 0, 100% 100%)" }}
        />
        {preview ? (
          <p className="line-clamp-6 text-[9px] leading-snug text-neutral-500 dark:text-neutral-400">
            {preview}
          </p>
        ) : (
          <div className="space-y-2 pt-1">
            <div className="h-1.5 w-3/4 rounded bg-neutral-200 dark:bg-neutral-600" />
            <div className="h-1.5 w-full rounded bg-neutral-200 dark:bg-neutral-600" />
            <div className="h-1.5 w-5/6 rounded bg-neutral-200 dark:bg-neutral-600" />
          </div>
        )}
      </div>
      <span className="line-clamp-2 text-center text-xs font-medium leading-tight">
        {title || "Untitled"}
      </span>
    </button>
  );
}

function AddTile({
  shape,
  label,
  onClick,
}: {
  shape: "card" | "circle";
  label: string;
  onClick: () => void;
}) {
  const box =
    shape === "circle"
      ? "aspect-square w-28 rounded-full sm:w-32"
      : "h-28 w-20 rounded-lg sm:h-32 sm:w-24";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-24 flex-col items-center gap-2 sm:w-28"
    >
      <div
        className={`flex flex-col items-center justify-center gap-1 border-2 border-dashed border-neutral-300 text-neutral-400 transition-colors hover:border-neutral-400 hover:text-neutral-600 active:scale-95 dark:border-neutral-700 dark:hover:border-neutral-500 ${box}`}
      >
        <Plus className="h-6 w-6" />
        {shape === "circle" && <span className="text-xs">{label}</span>}
      </div>
      {shape === "card" && (
        <span className="text-center text-xs text-neutral-400">{label}</span>
      )}
    </button>
  );
}

function InlineCreate({
  shape,
  placeholder,
  value,
  onChange,
  onSubmit,
  onCancel,
}: {
  shape: "card" | "circle";
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const box =
    shape === "circle"
      ? "aspect-square w-28 rounded-full sm:w-32"
      : "h-28 w-20 rounded-lg sm:h-32 sm:w-24";
  // Guard so Enter + the resulting blur don't both fire.
  const doneRef = useRef(false);
  const finish = (commit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (commit && value.trim()) onSubmit();
    else onCancel();
  };
  return (
    <div className="flex w-24 flex-col items-center gap-2 sm:w-28">
      <div
        className={`flex items-center justify-center border-2 border-neutral-300 p-2 dark:border-neutral-600 ${box}`}
      >
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") finish(true);
            if (e.key === "Escape") finish(false);
          }}
          placeholder={placeholder}
          className="w-full bg-transparent text-center text-xs outline-none"
        />
      </div>
    </div>
  );
}

function StylePicker({
  current,
  onPick,
  onClose,
}: {
  current: BubbleData;
  onPick: (style: { emoji?: string | null; color?: string | null }) => void;
  onClose: () => void;
}) {
  return (
    <>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-10 cursor-default"
      />
      <div className="absolute right-0 top-12 z-20 w-64 rounded-lg border border-neutral-200 bg-white p-3 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
        <div className="mb-1 text-xs font-medium text-neutral-500">Emoji</div>
        <div className="mb-3 grid grid-cols-8 gap-1">
          <button
            type="button"
            onClick={() => onPick({ emoji: null })}
            className="flex h-7 items-center justify-center rounded text-xs text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            title="No emoji"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          {EMOJI_PRESETS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => onPick({ emoji: e })}
              className={`flex h-7 items-center justify-center rounded text-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                current.emoji === e ? "bg-neutral-100 dark:bg-neutral-800" : ""
              }`}
            >
              {e}
            </button>
          ))}
        </div>
        <div className="mb-1 text-xs font-medium text-neutral-500">Color</div>
        <div className="flex gap-2">
          {COLOR_NAMES.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => onPick({ color: name })}
              className={`h-6 w-6 rounded-full ${SWATCH[name]} ${
                current.color === name
                  ? "ring-2 ring-neutral-900 ring-offset-1 dark:ring-white"
                  : ""
              }`}
              aria-label={name}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cancel"
        onClick={onCancel}
        className="absolute inset-0 bg-black/40"
      />
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-5 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="mt-2 text-sm text-neutral-500">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            <Check className="h-4 w-4" />
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
