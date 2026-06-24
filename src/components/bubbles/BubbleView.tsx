"use client";

import {
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  Check,
  ChevronRight,
  Folder,
  FolderPlus,
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
  setBubbleFolderAction,
  trashBubbleNoteAction,
  updateBubbleStyleAction,
} from "@/app/app/bubbles/actions";

import { BubbleCanvas } from "./BubbleCanvas";
import { COLOR_NAMES, SWATCH } from "./colors";
import type { BubbleData, BubbleNoteData } from "./types";

export type { BubbleData, BubbleNoteData } from "./types";

interface LoadedNote {
  id: string;
  title: string;
  content: SerializedEditorState | null;
}

const EMOJI_PRESETS = [
  "💡", "📁", "🧠", "✅", "📌", "🎯", "🔥", "⭐",
  "📝", "🌱", "🚀", "❤️", "🔧", "📚", "🎨", "💰",
];

const clamp = (min: number, val: number, max: number) =>
  Math.max(min, Math.min(val, max));

const PANEL_MIN = 280;
const PANEL_MAX = 720;
const PANEL_KEY = "bubblePanelWidth";

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

  // Optimistic node list: a freshly created bubble shows on the canvas
  // immediately, then is reconciled when the server revalidation lands.
  const [optimisticNodes, addOptimisticNode] = useOptimistic(
    nodes,
    (state: BubbleData[], node: BubbleData) => [...state, node],
  );

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

  // Resizable notes panel (persisted to localStorage).
  const rowRef = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState(360);
  const panelWidthRef = useRef(panelWidth);
  panelWidthRef.current = panelWidth;
  useEffect(() => {
    const saved = window.localStorage.getItem(PANEL_KEY);
    if (saved) setPanelWidth(clamp(PANEL_MIN, parseInt(saved, 10), PANEL_MAX));
  }, []);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const onMove = (ev: PointerEvent) => {
      const rect = rowRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPanelWidth(clamp(PANEL_MIN, rect.right - ev.clientX, PANEL_MAX));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.localStorage.setItem(
        PANEL_KEY,
        String(Math.round(panelWidthRef.current)),
      );
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const { byId, childrenOf, noteCount } = useMemo(() => {
    const byId = new Map<string, BubbleData>();
    const childrenOf = new Map<string, BubbleData[]>();
    for (const n of optimisticNodes) byId.set(n.id, n);
    for (const n of optimisticNodes) {
      if (n.parentId) {
        const arr = childrenOf.get(n.parentId) ?? [];
        arr.push(n);
        childrenOf.set(n.parentId, arr);
      }
    }
    const noteCount = new Map<string, number>();
    for (const n of notes) {
      noteCount.set(n.bubbleId, (noteCount.get(n.bubbleId) ?? 0) + 1);
    }
    return { byId, childrenOf, noteCount };
  }, [optimisticNodes, notes]);

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

  // Move focus to a bubble (canvas animates) and keep the URL deep-link in sync.
  const focus = (id: string) => {
    setCurrentId(id);
    if (typeof window !== "undefined") {
      window.history.pushState({ b: id }, "", `?b=${id}`);
    }
  };

  useEffect(() => {
    const onPop = () => {
      const b = new URLSearchParams(window.location.search).get("b");
      setCurrentId(b || rootId);
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

  // Nearest ancestor that's already a folder (disables this bubble's toggle).
  const folderAncestor = useMemo(() => {
    let p = current?.parentId ? byId.get(current.parentId) : undefined;
    const seen = new Set<string>();
    while (p && !seen.has(p.id)) {
      seen.add(p.id);
      if (p.isFolder) return p;
      p = p.parentId ? byId.get(p.parentId) : undefined;
    }
    return null;
  }, [current, byId]);

  const bubbleNotes = notesOf.get(effectiveId) ?? [];

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
      const title = value || "Untitled";
      const optimistic: BubbleData = {
        id: `optimistic-${crypto.randomUUID()}`,
        parentId: effectiveId,
        title,
        isFolder: false,
        emoji: null,
        color: null,
      };
      startTransition(async () => {
        addOptimisticNode(optimistic);
        await createBubbleAction(effectiveId, title);
      });
    } else {
      const id = await createBubbleNoteAction(effectiveId, value || "Untitled");
      setEditingNote({ id, title: value || "Untitled", content: null });
      setEditingNoteId(id);
    }
  };

  // --- Inline rename ---------------------------------------------------------
  const startRename = () => {
    setTitleDraft(current?.title ?? "");
    setEditingTitle(true);
  };
  const submitRename = () => {
    const value = titleDraft.trim() || "Untitled";
    setEditingTitle(false);
    startTransition(() => {
      void renameBubbleAction(effectiveId, value);
    });
  };

  // --- Style / folder --------------------------------------------------------
  const setStyle = (style: { emoji?: string | null; color?: string | null }) => {
    startTransition(() => {
      void updateBubbleStyleAction(effectiveId, style);
    });
  };
  const toggleFolder = () => {
    if (!current) return;
    startTransition(() => {
      void setBubbleFolderAction(effectiveId, !current.isFolder);
    });
  };

  // --- Delete ----------------------------------------------------------------
  const doDelete = () => {
    if (!current?.parentId) return;
    const parentId = current.parentId;
    setConfirmingDelete(false);
    focus(parentId);
    startTransition(() => {
      void deleteBubbleAction(current.id);
    });
  };

  const totalDescendants = (id: string): number => {
    const kids = childrenOf.get(id) ?? [];
    return kids.reduce((sum, k) => sum + 1 + totalDescendants(k.id), 0);
  };

  if (!current) return null;
  const isRoot = !current.parentId;

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
              onClick={() => focus(b.id)}
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

      {/* Action bar for the focused bubble */}
      <div className="relative flex items-center gap-2 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
        {current.emoji && <span className="text-lg">{current.emoji}</span>}
        {adding === "bubble" ? (
          <input
            autoFocus
            value={addDraft}
            onChange={(e) => setAddDraft(e.target.value)}
            onBlur={() => (addDraft.trim() ? submitAdd() : setAdding(null))}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitAdd();
              if (e.key === "Escape") setAdding(null);
            }}
            placeholder="New sub-bubble name…"
            className="flex-1 border-b border-blue-400 bg-transparent text-base outline-none"
          />
        ) : editingTitle ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={submitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
              if (e.key === "Escape") setEditingTitle(false);
            }}
            className="flex-1 border-b border-neutral-300 bg-transparent text-base font-semibold outline-none dark:border-neutral-600"
          />
        ) : (
          <h1
            onClick={startRename}
            className="flex-1 cursor-text truncate text-base font-semibold"
            title="Click to rename"
          >
            {current.title || "Untitled"}
          </h1>
        )}

        <button
          type="button"
          onClick={() => startAdd("bubble")}
          aria-label="Add sub-bubble"
          title="Add a sub-bubble"
          className="rounded p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <Plus className="h-4 w-4" />
        </button>

        {folderAncestor ? (
          <button
            type="button"
            disabled
            aria-label="Already inside a folder"
            title={`Already nested inside the “${
              folderAncestor.title || "Untitled"
            }” folder in Notes`}
            className="cursor-not-allowed rounded p-2 text-neutral-300 dark:text-neutral-600"
          >
            <Folder className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={toggleFolder}
            aria-label={current.isFolder ? "Remove from Notes folders" : "Make a folder"}
            title={
              current.isFolder
                ? "In Notes folders — click to remove (nests its sub-bubbles too)"
                : "Make this a folder in Notes (its sub-bubbles nest inside)"
            }
            className={`rounded p-2 ${
              current.isFolder
                ? "text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
                : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            }`}
          >
            {current.isFolder ? (
              <Folder className="h-4 w-4 fill-current" />
            ) : (
              <FolderPlus className="h-4 w-4" />
            )}
          </button>
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

      {/* Canvas (left) + notes/editor pane (right) */}
      <div ref={rowRef} className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div
          className={`relative min-h-0 flex-1 overflow-hidden ${
            editingNoteId ? "hidden md:block" : ""
          }`}
        >
          <BubbleCanvas
            nodes={optimisticNodes}
            childrenOf={childrenOf}
            noteCountOf={noteCount}
            focusId={effectiveId}
            onFocus={focus}
          />
        </div>

        {/* Drag handle to resize the pane (desktop only) */}
        <div
          onPointerDown={startResize}
          role="separator"
          aria-orientation="vertical"
          className="hidden w-1.5 shrink-0 cursor-col-resize bg-neutral-200 transition-colors hover:bg-blue-400 md:block dark:bg-neutral-800 dark:hover:bg-blue-500"
        />

        {/* Notes / editor pane */}
        <div
          style={{ "--panel-w": `${panelWidth}px` } as React.CSSProperties}
          className={`flex min-h-0 flex-col border-t border-neutral-200 dark:border-neutral-800 md:border-t-0 md:w-[var(--panel-w)] md:flex-none ${
            editingNoteId ? "flex-1" : "h-56 md:h-auto"
          }`}
        >
          {editingNoteId ? (
            loadingNote || !editingNote ? (
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
            )
          ) : (
            <>
              <h2 className="px-4 pt-3 pb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
                {bubbleNotes.length > 0
                  ? `${bubbleNotes.length} note${
                      bubbleNotes.length === 1 ? "" : "s"
                    } here`
                  : "Notes"}
              </h2>
              <div className="flex flex-1 gap-4 overflow-x-auto px-4 pb-3 md:flex-wrap md:content-start md:overflow-x-hidden md:overflow-y-auto">
                {bubbleNotes.map((note) => (
                  <div key={note.id} className="shrink-0">
                    <NoteCard
                      title={note.title}
                      preview={note.preview}
                      onClick={() => openNote(note.id)}
                    />
                  </div>
                ))}
                <div className="shrink-0">
                  {adding === "note" ? (
                    <InlineCreate
                      placeholder="Note title…"
                      value={addDraft}
                      onChange={setAddDraft}
                      onSubmit={submitAdd}
                      onCancel={() => setAdding(null)}
                    />
                  ) : (
                    <AddTile label="Add note" onClick={() => startAdd("note")} />
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Delete confirm */}
      {confirmingDelete && (
        <ConfirmDialog
          title={`Delete “${current.title || "Untitled"}”?`}
          message={(() => {
            const d = totalDescendants(current.id);
            const n = bubbleNotes.length;
            const parts: string[] = [];
            if (d > 0) parts.push(`${d} nested bubble${d === 1 ? "" : "s"}`);
            if (n > 0) parts.push(`${n} note${n === 1 ? "" : "s"} here`);
            return parts.length
              ? `This also deletes ${parts.join(" and ")}. This can’t be undone.`
              : "This can’t be undone.";
          })()}
          confirmLabel="Delete"
          onConfirm={doDelete}
          onCancel={() => setConfirmingDelete(false)}
        />
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

function AddTile({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-24 flex-col items-center gap-2 sm:w-28"
    >
      <div className="flex h-28 w-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-neutral-300 text-neutral-400 transition-colors hover:border-neutral-400 hover:text-neutral-600 active:scale-95 sm:h-32 sm:w-24 dark:border-neutral-700 dark:hover:border-neutral-500">
        <Plus className="h-6 w-6" />
      </div>
      <span className="text-center text-xs text-neutral-400">{label}</span>
    </button>
  );
}

function InlineCreate({
  placeholder,
  value,
  onChange,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
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
      <div className="h-28 w-20 rounded-lg border-2 border-dashed border-neutral-300 bg-white sm:h-32 sm:w-24 dark:border-neutral-600 dark:bg-neutral-800" />
      <div className="w-full border-b border-neutral-300 dark:border-neutral-600">
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
