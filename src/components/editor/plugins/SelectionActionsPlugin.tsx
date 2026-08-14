"use client";

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isListItemNode, $isListNode, type ListItemNode } from "@lexical/list";
import { $findMatchingParent } from "@lexical/utils";
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $setSelection,
  type LexicalNode,
  type RangeSelection,
} from "lexical";
import {
  CalendarDays,
  CircleDashed,
  FileText,
  ListChecks,
  Loader2,
  Sun,
} from "lucide-react";

import {
  getOrCreateTodayNoteAction,
  moveBlocksToNoteAction,
  searchAction,
  turnListItemsIntoTasksAction,
  type SearchNoteResult,
} from "@/app/app/actions";
import { localDateString } from "@/lib/dates";
import { useDailyEditor } from "../DailyEditorContext";
import { $createTaskNode, NoteTaskContext } from "../nodes/TaskNode";

/**
 * Selection toolbar scoped to PAST daily notes only — "move this out of an
 * old jot" (into today, or a named note) and "these bullets are actually
 * tasks". Not offered on today's jot or on ordinary notes: today's jot is
 * still being written (nothing to move OUT of it yet), and ordinary notes
 * have no "before today" to be past relative to.
 *
 * A separate floating instance from FloatingToolbarPlugin (different trigger
 * condition, different actions) rather than extra buttons bolted onto it —
 * positioned BELOW the selection so it doesn't fight that toolbar's
 * above-preferred placement for the same rectangle.
 */

interface MenuState {
  visible: boolean;
  top: number;
  left: number;
  /** Selection spans only list item(s) — enables "Turn into tasks". */
  canTurnIntoTasks: boolean;
}

const HIDDEN: MenuState = { visible: false, top: 0, left: 0, canTurnIntoTasks: false };

const VIEWPORT_MARGIN = 8;
const MENU_HALF_WIDTH = 160;

function statesEqual(a: MenuState, b: MenuState): boolean {
  return (
    a.visible === b.visible &&
    a.top === b.top &&
    a.left === b.left &&
    a.canTurnIntoTasks === b.canTurnIntoTasks
  );
}

// ---------------------------------------------------------------------------
// Selection → block extraction (move actions)
// ---------------------------------------------------------------------------

/** The root's top-level children spanned by the selection, inclusive. */
function $getSelectedTopLevelBlocks(selection: RangeSelection): LexicalNode[] {
  const anchorBlock = selection.anchor.getNode().getTopLevelElementOrThrow();
  const focusBlock = selection.focus.getNode().getTopLevelElementOrThrow();
  const children = $getRoot().getChildren();
  const anchorIndex = children.findIndex((c) => c.is(anchorBlock));
  const focusIndex = children.findIndex((c) => c.is(focusBlock));
  if (anchorIndex === -1 || focusIndex === -1) return [];
  const [start, end] =
    anchorIndex <= focusIndex ? [anchorIndex, focusIndex] : [focusIndex, anchorIndex];
  return children.slice(start, end + 1);
}

/** True when `node` itself, or any descendant, is one of the selection's nodes. */
function $isNodeSelected(node: LexicalNode, keys: Set<string>): boolean {
  if (keys.has(node.getKey())) return true;
  if ($isElementNode(node)) {
    return node.getChildren().some((c) => $isNodeSelected(c, keys));
  }
  return false;
}

/** `exportJSON()`, recursed into children — matches Lexical's own full-tree
 * serialization (a bare `exportJSON()` call leaves `children` empty; the
 * recursion is normally done by the editor-state serializer, not the node). */
function $exportNodeDeep(node: LexicalNode): Record<string, unknown> {
  const json = node.exportJSON() as Record<string, unknown>;
  if ($isElementNode(node)) {
    json.children = node.getChildren().map($exportNodeDeep);
  }
  return json;
}

/**
 * Serializes `node` for a move, respecting a partial selection only inside
 * lists: a list's item children are filtered down to the ones the selection
 * actually touches (recursively, so a nested sublist keeps only its own
 * touched rows). Every other block type — paragraphs, headings, quotes —
 * moves whole the moment any part of it is touched; a selection can't
 * partially "contain" one at the structural granularity a move cares about.
 * Returns null for a list left with nothing selected inside it.
 */
function $extractSelectedNode(
  node: LexicalNode,
  keys: Set<string>,
): Record<string, unknown> | null {
  if ($isListNode(node)) {
    const items = node
      .getChildren()
      .filter((c) => $isNodeSelected(c, keys))
      .map((c) => $extractSelectedNode(c, keys))
      .filter((c): c is Record<string, unknown> => c !== null);
    if (items.length === 0) return null;
    const json = node.exportJSON() as Record<string, unknown>;
    json.children = items;
    return json;
  }
  if ($isListItemNode(node)) {
    const json = node.exportJSON() as Record<string, unknown>;
    json.children = node
      .getChildren()
      .map((c) => ($isListNode(c) ? $extractSelectedNode(c, keys) : $exportNodeDeep(c)))
      .filter((c): c is Record<string, unknown> => c !== null);
    return json;
  }
  return $exportNodeDeep(node);
}

function $extractSelectedBlocks(selection: RangeSelection): Record<string, unknown>[] {
  const keys = new Set(selection.getNodes().map((n) => n.getKey()));
  return $getSelectedTopLevelBlocks(selection)
    .map((block) => $extractSelectedNode(block, keys))
    .filter((b): b is Record<string, unknown> => b !== null);
}

// ---------------------------------------------------------------------------
// Bullets → tasks
// ---------------------------------------------------------------------------

/** Every top-level block the selection touches is a list. */
export function $selectionIsListsOnly(selection: RangeSelection): boolean {
  const blocks = $getSelectedTopLevelBlocks(selection);
  return blocks.length > 0 && blocks.every((b) => $isListNode(b));
}

/** A list item's own text, excluding a nested sublist's — same convention as
 * TaskShortcutsPlugin's bullet→task conversion. */
export function $listItemOwnText(item: ListItemNode): string {
  return item
    .getChildren()
    .map((c) => ($isListNode(c) ? "" : c.getTextContent()))
    .join("")
    .trim();
}

/** Unique list items the selection touches, in document order. */
export function $collectSelectedListItems(selection: RangeSelection): ListItemNode[] {
  const seen = new Set<string>();
  const items: ListItemNode[] = [];
  for (const node of selection.getNodes()) {
    const item = $findMatchingParent(node, $isListItemNode) as ListItemNode | null;
    if (item && !seen.has(item.getKey())) {
      seen.add(item.getKey());
      items.push(item);
    }
  }
  return items;
}

export interface TaskConversion {
  key: string;
  taskId: string;
  title: string;
}

/**
 * Replaces each list item with the matching TaskNode, hoisted to sit as a
 * top-level sibling right after the item's own top-level list — never left
 * nested inside another (possibly also-converting) list item, so converting
 * a parent row can't destroy a child row's already-placed task. Processing
 * LAST item first and always inserting right after the top-level list keeps
 * the final top-to-bottom order matching the original selection order.
 * `ListItemNode.remove()` cascades away any list left empty by the removal
 * (`ListNode.canBeEmpty()` is false), so no manual cleanup is needed.
 */
export function $applyTaskConversion(items: TaskConversion[]): void {
  for (let i = items.length - 1; i >= 0; i--) {
    const { key, taskId, title } = items[i];
    const node = $getNodeByKey(key);
    if (!node || !$isListItemNode(node)) continue;
    const topLevel = node.getTopLevelElementOrThrow();
    const task = $createTaskNode({ taskId, title });
    topLevel.insertAfter(task);
    node.remove();
  }
  $setSelection(null);
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export function SelectionActionsPlugin() {
  const [editor] = useLexicalComposerContext();
  const { isDaily, dailyDateStr } = useDailyEditor();
  const noteId = useContext(NoteTaskContext)?.noteId ?? null;
  const isPastDaily = Boolean(isDaily && dailyDateStr && dailyDateStr < localDateString());

  const [state, setState] = useState<MenuState>(HIDDEN);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const updateMenu = useCallback(() => {
    if (!isPastDaily) {
      setState((s) => (s.visible ? HIDDEN : s));
      return;
    }
    const nativeSelection = window.getSelection();
    const rootElement = editor.getRootElement();

    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (
        !$isRangeSelection(selection) ||
        selection.isCollapsed() ||
        nativeSelection === null ||
        nativeSelection.rangeCount === 0 ||
        rootElement === null ||
        !rootElement.contains(nativeSelection.anchorNode) ||
        selection.getTextContent() === ""
      ) {
        setState((s) => (s.visible ? HIDDEN : s));
        return;
      }

      const rangeRect = nativeSelection.getRangeAt(0).getBoundingClientRect();
      const top = rangeRect.bottom + VIEWPORT_MARGIN;
      const left = Math.min(
        Math.max(rangeRect.left + rangeRect.width / 2, VIEWPORT_MARGIN + MENU_HALF_WIDTH),
        window.innerWidth - VIEWPORT_MARGIN - MENU_HALF_WIDTH,
      );

      const next: MenuState = {
        visible: true,
        top,
        left,
        canTurnIntoTasks: $selectionIsListsOnly(selection),
      };
      setState((s) => (statesEqual(s, next) ? s : next));
    });
  }, [editor, isPastDaily]);

  useEffect(() => {
    const onSelectionChange = () => updateMenu();
    document.addEventListener("selectionchange", onSelectionChange);
    const unregister = editor.registerUpdateListener(() => updateMenu());
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      unregister();
    };
  }, [editor, updateMenu]);

  const hideMenu = useCallback(() => {
    setState(HIDDEN);
    setPicker(false);
  }, []);

  // Escape dismisses; clicking outside the menu (and outside any note-picker
  // popover it opened) dismisses too. Selection changes already hide it via
  // updateMenu, but neither of these necessarily changes the selection.
  useEffect(() => {
    if (!state.visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hideMenu();
    };
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) hideMenu();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [state.visible, hideMenu]);

  /** Read the live selection into serialized blocks, or null if it collapsed
   * out from under us before the click landed. */
  const readSelectedBlocks = useCallback((): Record<string, unknown>[] | null => {
    let blocks: Record<string, unknown>[] | null = null;
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || selection.isCollapsed()) return;
      blocks = $extractSelectedBlocks(selection);
    });
    return blocks && blocks.length > 0 ? blocks : null;
  }, [editor]);

  // Snapshot taken when a move starts — before the note-picker ever opens and
  // steals DOM focus into its search input. Lexical's own selection object
  // outlives a blur (nothing nulls it), so re-reading at pick time would
  // likely still work, but there's no reason to depend on that when the
  // blocks are cheap to capture up front and hand along instead.
  const pendingBlocksRef = useRef<Record<string, unknown>[] | null>(null);

  /**
   * Cut the given (already-captured) selection blocks out to `targetNoteId`
   * (resolved lazily — the "move to today" and "move to other note" actions
   * differ only in how they get one). The target write and the source
   * removal are two different notes' worth of state, so they can't share a
   * single Lexical update; each side is still exactly one — one
   * `editor.update()` for the cut (one undo step, one autosave fire) and one
   * server action for the append.
   */
  const moveSelectionTo = useCallback(
    async (
      blocks: Record<string, unknown>[],
      resolveTargetNoteId: () => Promise<string | null>,
    ) => {
      setBusy(true);
      try {
        const targetNoteId = await resolveTargetNoteId();
        if (!targetNoteId) return;
        await moveBlocksToNoteAction(targetNoteId, blocks);
        editor.update(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) selection.removeText();
        });
      } catch (err) {
        console.error("[selection-actions] move failed:", err);
      } finally {
        setBusy(false);
        hideMenu();
      }
    },
    [editor, hideMenu],
  );

  const moveToToday = useCallback(() => {
    const blocks = readSelectedBlocks();
    if (!blocks) {
      hideMenu();
      return;
    }
    void moveSelectionTo(blocks, async () => {
      const today = await getOrCreateTodayNoteAction(localDateString());
      return today.id;
    });
  }, [readSelectedBlocks, moveSelectionTo, hideMenu]);

  /** Opens the note picker, capturing the selection now while it's certain
   * to still be live (before focus moves into the picker's search input). */
  const openNotePicker = useCallback(() => {
    const blocks = readSelectedBlocks();
    if (!blocks) {
      hideMenu();
      return;
    }
    pendingBlocksRef.current = blocks;
    setPicker(true);
  }, [readSelectedBlocks, hideMenu]);

  const moveToNote = useCallback(
    (targetNoteId: string) => {
      const blocks = pendingBlocksRef.current;
      if (!blocks) return;
      void moveSelectionTo(blocks, async () => targetNoteId);
    },
    [moveSelectionTo],
  );

  const turnIntoTasks = useCallback(async () => {
    if (!noteId) return;
    let items: { key: string; title: string }[] = [];
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || selection.isCollapsed()) return;
      if (!$selectionIsListsOnly(selection)) return;
      items = $collectSelectedListItems(selection).map((item) => ({
        key: item.getKey(),
        title: $listItemOwnText(item),
      }));
    });
    if (items.length === 0) {
      hideMenu();
      return;
    }
    setBusy(true);
    try {
      const created = await turnListItemsIntoTasksAction(
        noteId,
        items.map((i) => i.title),
      );
      const conversions: TaskConversion[] = items
        .map((item, i) => ({
          key: item.key,
          taskId: created[i]?.id ?? "",
          title: created[i]?.title ?? item.title,
        }))
        .filter((c) => c.taskId !== "");
      editor.update(() => {
        $applyTaskConversion(conversions);
      });
    } catch (err) {
      console.error("[selection-actions] turn into tasks failed:", err);
    } finally {
      setBusy(false);
      hideMenu();
    }
  }, [editor, noteId, hideMenu]);

  if (!state.visible) return null;

  return createPortal(
    <div
      ref={menuRef}
      style={{ position: "fixed", top: state.top, left: state.left, transform: "translateX(-50%)" }}
      className="z-50 flex items-center gap-0.5 rounded-lg border border-white/8 bg-card p-1 shadow-lg"
      onMouseDown={(e) => e.preventDefault()}
    >
      {busy ? (
        <span className="flex items-center gap-1.5 px-2 py-1.5 text-[0.75rem] text-ink-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Moving…
        </span>
      ) : (
        <>
          <MenuButton icon={<Sun className="h-3.5 w-3.5" />} label="Move to today" onClick={moveToToday} />
          <MenuButton
            icon={<CircleDashed className="h-3.5 w-3.5" />}
            label="Move to note…"
            active={picker}
            onClick={() => (picker ? setPicker(false) : openNotePicker())}
          />
          <MenuButton
            icon={<ListChecks className="h-3.5 w-3.5" />}
            label="Turn into tasks"
            disabled={!state.canTurnIntoTasks}
            onClick={() => void turnIntoTasks()}
          />
        </>
      )}

      {picker && !busy && (
        <NoteMovePicker excludeNoteId={noteId} onPick={moveToNote} onClose={() => setPicker(false)} />
      )}
    </div>,
    document.body,
  );
}

function MenuButton({
  icon,
  label,
  onClick,
  active,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`flex items-center gap-1.5 rounded px-2 py-1.5 text-[0.75rem] font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? "bg-white/15 text-ink-100" : "text-ink-300 hover:bg-white/8"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * "Move to other note…" popover — the same `searchAction` NoteLinkPlugin's
 * "[[" typeahead uses, in a standalone input + list rather than Lexical's
 * TypeaheadMenuPlugin (that plugin is wired to a text trigger typed into the
 * document; this one opens from a toolbar click with no document text to
 * anchor a typeahead match to).
 */
function NoteMovePicker({
  excludeNoteId,
  onPick,
  onClose,
}: {
  excludeNoteId: string | null;
  onPick: (noteId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchNoteResult[]>([]);
  const [searching, setSearching] = useState(false);
  const requestIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchAction(q)
      .then((res) => {
        if (requestIdRef.current !== requestId) return;
        setResults(res.notes.filter((n) => n.id !== excludeNoteId));
        setSearching(false);
      })
      .catch((err) => {
        if (requestIdRef.current !== requestId) return;
        console.error("[selection-actions] note search failed:", err);
        setResults([]);
        setSearching(false);
      });
  }, [query, excludeNoteId]);

  return (
    <div
      className="absolute left-1/2 top-full z-50 mt-1 w-64 -translate-x-1/2 overflow-hidden rounded-lg border border-white/8 bg-card py-1 shadow-lg"
      onMouseDown={(e) => e.preventDefault()}
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
        placeholder="Find a note…"
        aria-label="Find a note to move this into"
        className="w-full border-b border-white/8 bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-ink-500"
      />
      {results.length ? (
        <ul className="max-h-64 overflow-y-auto">
          {results.map((note) => (
            <li key={note.id}>
              <button
                type="button"
                onClick={() => onPick(note.id)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-white/5"
              >
                {note.dailyDate ? (
                  <CalendarDays className="h-4 w-4 shrink-0 text-ink-500" />
                ) : note.bubbleId ? (
                  <CircleDashed className="h-4 w-4 shrink-0 text-ink-500" />
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-ink-500" />
                )}
                <span className="min-w-0 flex-1 truncate">{note.title || "Untitled"}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="px-3 py-2 text-sm italic text-ink-400">
          {!query.trim() ? "Type a note title…" : searching ? "Searching…" : "No matching notes"}
        </div>
      )}
    </div>
  );
}
