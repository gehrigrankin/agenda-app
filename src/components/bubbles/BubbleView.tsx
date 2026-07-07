"use client";

import {
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronRight,
  CircleDashed,
  Folder,
  FolderPlus,
  Loader2,
  MoreHorizontal,
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
  moveBubbleAction,
  renameBubbleAction,
  setBubbleFolderAction,
  trashBubbleNoteAction,
  updateBubbleStyleAction,
} from "@/app/app/bubbles/actions";
import { moveNoteToBubbleAction } from "@/app/app/actions";

import { BubbleCanvas } from "./BubbleCanvas";
import { COLOR_NAMES, SWATCH } from "./colors";
import { LatchedInput } from "./LatchedInput";
import type { BubbleData, BubbleNoteData } from "./types";

export type { BubbleData, BubbleNoteData } from "./types";

interface LoadedNote {
  id: string;
  title: string;
  content: SerializedEditorState | null;
  bubbleId: string;
}

const EMOJI_PRESETS = [
  "💡", "📁", "🧠", "✅", "📌", "🎯", "🔥", "⭐",
  "📝", "🌱", "🚀", "❤️", "🔧", "📚", "🎨", "💰",
];

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
  // Mirror for async callbacks (e.g. swapping an optimistic id for the real
  // one after the server responds) so they see the latest focus, not the
  // value captured when the callback was created.
  const currentIdRef = useRef(currentId);
  currentIdRef.current = currentId;
  const [, startTransition] = useTransition();

  // Optimistic node list: freshly created bubbles show on the canvas
  // immediately, deleted subtrees disappear immediately, dragged bubbles
  // reparent immediately; all reconcile when the server revalidation lands.
  const [optimisticNodes, applyOptimistic] = useOptimistic(
    nodes,
    (
      state: BubbleData[],
      action:
        | { type: "add"; node: BubbleData }
        | { type: "remove"; id: string }
        | { type: "move"; id: string; parentId: string },
    ) => {
      if (action.type === "add") return [...state, action.node];
      // Both remove and move need the subtree of action.id.
      const subtree = new Set([action.id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const n of state) {
          if (n.parentId && subtree.has(n.parentId) && !subtree.has(n.id)) {
            subtree.add(n.id);
            grew = true;
          }
        }
      }
      if (action.type === "move") {
        // Refuse self/descendant targets — reparenting into the moved subtree
        // would detach it into an unreachable cycle (the server rejects this
        // too; this guard keeps the optimistic tree from ever rendering it).
        if (subtree.has(action.parentId)) return state;
        return state.map((n) =>
          n.id === action.id ? { ...n, parentId: action.parentId } : n,
        );
      }
      // Remove the bubble and its whole subtree.
      return state.filter((n) => !subtree.has(n.id));
    },
  );

  // Optimistic notes: a dragged note card jumps to its new container
  // immediately instead of waiting for revalidation.
  const [optimisticNotes, applyOptimisticNote] = useOptimistic(
    notes,
    (
      state: BubbleNoteData[],
      action: { type: "move"; id: string; bubbleId: string },
    ) =>
      state.map((n) =>
        n.id === action.id ? { ...n, bubbleId: action.bubbleId } : n,
      ),
  );

  // Editor overlay.
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<LoadedNote | null>(null);
  const [loadingNote, setLoadingNote] = useState(false);
  // Mirror for openNote's async fetch: a stale response for a note the user
  // has since closed or switched away from must not clobber editor state.
  const editingNoteIdRef = useRef(editingNoteId);
  editingNoteIdRef.current = editingNoteId;

  // Inline UI state.
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  // Breadcrumb inline sub-bubble creation (notes are added via the canvas).
  const [addingBubble, setAddingBubble] = useState(false);
  const [addDraft, setAddDraft] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [stylePickerOpen, setStylePickerOpen] = useState(false);

  const { byId, childrenOf } = useMemo(() => {
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
    return { byId, childrenOf };
  }, [optimisticNodes]);

  const notesOf = useMemo(() => {
    const map = new Map<string, BubbleNoteData[]>();
    for (const n of optimisticNotes) {
      const arr = map.get(n.bubbleId) ?? [];
      arr.push(n);
      map.set(n.bubbleId, arr);
    }
    return map;
  }, [optimisticNotes]);

  const current = byId.get(currentId) ?? byId.get(rootId);
  const effectiveId = current?.id ?? rootId;

  // Move focus to a bubble (canvas animates) and keep the URL deep-link in sync.
  const focus = (id: string) => {
    // Navigating away from a zoomed-in note closes its editor.
    if (editingNoteId) closeEditor();
    setCurrentId(id);
    if (typeof window === "undefined") return;
    // Optimistic ids are temporary — never put them in the URL (they'd be
    // dead after revalidation). The real id is swapped in by submitAdd.
    if (id.startsWith("optimistic-")) return;
    // Re-selecting the current bubble shouldn't grow the history stack.
    const inUrl = new URLSearchParams(window.location.search).get("b");
    if (inUrl === id) return;
    window.history.pushState({ b: id }, "", `?b=${id}`);
  };

  useEffect(() => {
    const onPop = () => {
      const b = new URLSearchParams(window.location.search).get("b");
      // Back while a note is open zooms out of it, matching focus(). Inlined
      // (rather than calling closeEditor) to keep the effect's deps empty.
      setEditingNoteId(null);
      setEditingNote(null);
      setLoadingNote(false);
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

  // Up one level (breadcrumb parent). No-op at the root.
  const goUp = () => {
    const pid = current?.parentId;
    if (pid) focus(pid);
  };

  // --- Note editor overlay ---------------------------------------------------
  const openNote = async (id: string) => {
    setEditingNoteId(id);
    setEditingNote(null);
    setLoadingNote(true);
    const payload = await getBubbleNoteAction(id);
    // Stale response: the user closed the editor or opened another note
    // while this fetch was in flight — don't clobber the newer state.
    if (editingNoteIdRef.current !== id) return;
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

  // Escape zooms back out of an open note (unless something inside the editor
  // already handled the key, e.g. closing a slash-command menu).
  const editorOpen = editingNoteId !== null;
  useEffect(() => {
    if (!editorOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) closeEditor();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editorOpen]);

  // --- Create ----------------------------------------------------------------
  // Optimistic parent ids are refused silently, same as the move handlers
  // below: the parent doesn't exist on the server yet, so creating under it
  // would throw "Bubble not found".
  const addBubble = (parentId: string, title: string) => {
    if (parentId.startsWith("optimistic-")) return;
    const t = title.trim() || "Untitled";
    const optimistic: BubbleData = {
      id: `optimistic-${crypto.randomUUID()}`,
      parentId,
      title: t,
      isFolder: false,
      emoji: null,
      color: null,
    };
    startTransition(async () => {
      applyOptimistic({ type: "add", node: optimistic });
      const realId = await createBubbleAction(parentId, t);
      // If the user clicked the optimistic bubble before the server
      // responded, move focus to the real id so it survives revalidation.
      if (currentIdRef.current === optimistic.id) {
        setCurrentId(realId);
        window.history.replaceState({ b: realId }, "", `?b=${realId}`);
      }
    });
  };

  const addNote = async (bubbleId: string, title: string) => {
    if (bubbleId.startsWith("optimistic-")) return;
    const t = title.trim() || "Untitled";
    const id = await createBubbleNoteAction(bubbleId, t);
    setEditingNote({ id, title: t, content: null, bubbleId });
    setEditingNoteId(id);
  };

  // --- Drag & drop moves -------------------------------------------------------
  // Optimistic ids are refused silently: they don't exist on the server yet,
  // and by the time revalidation lands they'll have been replaced anyway.
  const moveNote = (noteId: string, toBubbleId: string) => {
    if (noteId.startsWith("optimistic-") || toBubbleId.startsWith("optimistic-"))
      return;
    startTransition(async () => {
      applyOptimisticNote({ type: "move", id: noteId, bubbleId: toBubbleId });
      await moveNoteToBubbleAction(noteId, toBubbleId);
    });
  };

  const moveBubble = (id: string, toParentId: string) => {
    if (id.startsWith("optimistic-") || toParentId.startsWith("optimistic-"))
      return;
    startTransition(async () => {
      applyOptimistic({ type: "move", id, parentId: toParentId });
      await moveBubbleAction(id, toParentId);
    });
  };

  // Breadcrumb inline add (canvas quick-add calls addBubble directly).
  const submitAdd = () => {
    const value = addDraft.trim();
    setAddingBubble(false);
    setAddDraft("");
    addBubble(effectiveId, value);
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
    const id = current.id;
    setConfirmingDelete(false);
    focus(parentId);
    startTransition(async () => {
      // Drop the subtree from the canvas right away instead of letting it
      // linger until revalidation.
      applyOptimistic({ type: "remove", id });
      await deleteBubbleAction(id);
    });
  };

  const totalDescendants = (id: string): number => {
    // Seen-set guards against a corrupt parentId cycle, like the file's
    // other traversals.
    const seen = new Set<string>([id]);
    const walk = (nodeId: string): number => {
      const kids = childrenOf.get(nodeId) ?? [];
      let sum = 0;
      for (const k of kids) {
        if (seen.has(k.id)) continue;
        seen.add(k.id);
        sum += 1 + walk(k.id);
      }
      return sum;
    };
    return walk(id);
  };

  if (!current) return null;
  const isRoot = !current.parentId;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header: breadcrumb pills + right-aligned actions in one row */}
      <header className="relative flex items-center gap-2 border-b border-neutral-200 px-3 py-1.5 dark:border-neutral-800">
        <nav
          aria-label="Bubble path"
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden whitespace-nowrap text-sm"
        >
          {(() => {
            // Deeper than 4 levels: root · … · parent · current.
            const collapsed = breadcrumb.length > 4;
            const ancestors = breadcrumb.slice(0, -1);
            const shown = collapsed
              ? [ancestors[0], ancestors[ancestors.length - 1]]
              : ancestors;
            const skipped = collapsed ? ancestors.slice(1, -1) : [];
            return (
              <>
                {shown.map((b, i) => (
                  <span key={b.id} className="flex min-w-0 items-center gap-0.5">
                    {i > 0 && (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-300 dark:text-neutral-600" />
                    )}
                    <Crumb bubble={b} onClick={() => focus(b.id)} />
                    {collapsed && i === 0 && (
                      <>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-300 dark:text-neutral-600" />
                        <CrumbOverflow items={skipped} onPick={focus} />
                      </>
                    )}
                  </span>
                ))}
                {ancestors.length > 0 && (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-300 dark:text-neutral-600" />
                )}
                {editingTitle ? (
                  <LatchedInput
                    value={titleDraft}
                    onChange={setTitleDraft}
                    onCommit={submitRename}
                    onCancel={() => setEditingTitle(false)}
                    className="w-44 min-w-0 border-b border-blue-400 bg-transparent px-1 text-sm font-semibold outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={startRename}
                    title="Click to rename"
                    className="flex h-9 min-w-0 max-w-60 items-center gap-1 rounded-lg px-2 font-semibold text-neutral-900 transition-colors duration-150 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
                  >
                    {current.emoji && (
                      <span className="shrink-0">{current.emoji}</span>
                    )}
                    <span className="cursor-text truncate">
                      {current.title || "Untitled"}
                    </span>
                  </button>
                )}
                {addingBubble && (
                  <>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-300 dark:text-neutral-600" />
                    <LatchedInput
                      value={addDraft}
                      onChange={setAddDraft}
                      onCommit={submitAdd}
                      onCancel={() => setAddingBubble(false)}
                      placeholder="New sub-bubble name…"
                      className="w-44 shrink-0 border-b border-blue-400 bg-transparent px-1 text-sm outline-none"
                    />
                  </>
                )}
              </>
            );
          })()}
        </nav>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => {
              setAddingBubble(true);
              setAddDraft("");
            }}
            aria-label="Add sub-bubble"
            title="Add a sub-bubble"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 transition-colors duration-150 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
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
              className="flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-lg text-neutral-300 dark:text-neutral-600"
            >
              <Folder className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={toggleFolder}
              aria-label={
                current.isFolder ? "Remove from Notes folders" : "Make a folder"
              }
              title={
                current.isFolder
                  ? "In Notes folders — click to remove (nests its sub-bubbles too)"
                  : "Make this a folder in Notes (its sub-bubbles nest inside)"
              }
              className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-150 ${
                current.isFolder
                  ? "text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
                  : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
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
            // z-20 keeps the button above the picker's scrim so it can toggle
            // the picker closed.
            className="relative z-20 flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 transition-colors duration-150 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
          >
            <Palette className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={startRename}
            aria-label="Rename bubble"
            title="Rename"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 transition-colors duration-150 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
          >
            <Pencil className="h-4 w-4" />
          </button>
          {!isRoot && (
            <>
              <div
                aria-hidden
                className="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-800"
              />
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                aria-label="Delete bubble"
                title="Delete bubble (and its subtree)"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 transition-colors duration-150 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>

        {stylePickerOpen && (
          <StylePicker
            current={current}
            onPick={(style) => setStyle(style)}
            onClose={() => setStylePickerOpen(false)}
          />
        )}
      </header>

      {/* Canvas (full-bleed). Opening a note zooms the camera into its card
          and the editor fades in over the canvas — same page, deeper zoom. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <BubbleCanvas
          nodes={optimisticNodes}
          childrenOf={childrenOf}
          notesOf={notesOf}
          focusId={effectiveId}
          onFocus={focus}
          onUp={goUp}
          canGoUp={!isRoot}
          onOpenNote={openNote}
          onAddBubble={addBubble}
          onAddNote={addNote}
          onMoveNote={moveNote}
          onMoveBubble={moveBubble}
          zoomToNoteId={editingNoteId}
          keysDisabled={confirmingDelete || stylePickerOpen || editorOpen}
        />

        {editingNoteId && (
          <div className="animate-editor-zoom-in absolute inset-0 z-20 flex flex-col bg-[#fafafa] dark:bg-[#0a0a0a]">
            {loadingNote || !editingNote ? (
              <div className="flex h-full items-center justify-center text-neutral-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : (
              <div className="mx-auto flex h-full w-full max-w-3xl min-h-0 flex-col">
                <NoteEditor
                  key={editingNote.id}
                  noteId={editingNote.id}
                  initialTitle={editingNote.title}
                  initialContent={editingNote.content}
                  initialBubbleId={editingNote.bubbleId}
                  onClose={closeEditor}
                  trashAction={trashBubbleNoteAction}
                  onTrashed={closeEditor}
                />
              </div>
            )}
          </div>
        )}
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

/** Close overlays on Escape. */
function useEscapeKey(onEscape: () => void) {
  const handlerRef = useRef(onEscape);
  handlerRef.current = onEscape;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handlerRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}

/** One ancestor pill in the breadcrumb. */
function Crumb({
  bubble,
  onClick,
}: {
  bubble: BubbleData;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={bubble.title || "Untitled"}
      className="flex h-9 min-w-0 max-w-40 items-center gap-1 rounded-lg px-2 text-neutral-500 transition-colors duration-150 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
    >
      {bubble.emoji && <span className="shrink-0">{bubble.emoji}</span>}
      <span className="truncate">{bubble.title || "Untitled"}</span>
    </button>
  );
}

/**
 * "…" pill holding breadcrumb levels collapsed out of a deep path. The
 * dropdown is portaled to <body> with a measured fixed position because the
 * breadcrumb nav clips its children (overflow-hidden for pill truncation).
 */
function CrumbOverflow({
  items,
  onPick,
}: {
  items: BubbleData[];
  onPick: (id: string) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const open = menuPos !== null;

  const toggle = () => {
    if (open) {
      setMenuPos(null);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setMenuPos({ x: r.left, y: r.bottom + 4 });
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuPos(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-label={`Show ${items.length} hidden level${items.length === 1 ? "" : "s"}`}
        title="Show hidden levels"
        aria-expanded={open}
        className="flex h-9 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition-colors duration-150 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open &&
        createPortal(
          <>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setMenuPos(null)}
              className="fixed inset-0 z-40 cursor-default"
            />
            <div
              style={{ left: menuPos.x, top: menuPos.y }}
              className="animate-pop-in fixed z-50 min-w-44 max-w-64 rounded-lg border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
            >
              {items.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => {
                    setMenuPos(null);
                    onPick(b.id);
                  }}
                  className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-sm text-neutral-700 transition-colors duration-150 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                >
                  {b.emoji ? (
                    <span className="text-sm leading-none">{b.emoji}</span>
                  ) : (
                    <CircleDashed className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                  )}
                  <span className="truncate">{b.title || "Untitled"}</span>
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
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
  useEscapeKey(onClose);
  return (
    <>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-10 cursor-default"
      />
      <div className="animate-pop-in absolute right-0 top-12 z-20 w-64 rounded-xl border border-neutral-200 bg-white p-3 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
        <div className="mb-1 text-xs font-medium text-neutral-500">Emoji</div>
        <div className="mb-3 grid grid-cols-8 gap-1">
          <button
            type="button"
            onClick={() => onPick({ emoji: null })}
            className="flex h-7 items-center justify-center rounded text-xs text-neutral-400 transition-colors duration-150 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            title="No emoji"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          {EMOJI_PRESETS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => onPick({ emoji: e })}
              className={`flex h-7 items-center justify-center rounded text-lg transition-colors duration-150 hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
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
              className={`h-6 w-6 rounded-full transition-transform duration-150 hover:scale-110 ${SWATCH[name]} ${
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
  useEscapeKey(onCancel);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cancel"
        onClick={onCancel}
        className="animate-overlay-fade-in absolute inset-0 bg-black/40"
      />
      <div className="animate-pop-in relative z-10 w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-5 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="mt-2 text-sm text-neutral-500">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-neutral-600 transition-colors duration-150 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-red-700"
          >
            <Check className="h-4 w-4" />
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
