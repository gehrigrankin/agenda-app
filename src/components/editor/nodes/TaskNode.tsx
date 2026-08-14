"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type JSX,
} from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $applyNodeReplacement,
  $getNodeByKey,
  DecoratorNode,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import { CalendarDays, Check, GripVertical, Star } from "lucide-react";

import {
  createTaskAction,
  renameTaskAction,
  setTaskDueAction,
  setTaskImportantAction,
  toggleTaskAction,
} from "@/app/app/actions";
import { localDateString } from "@/lib/dates";
import { clampToParentDepth } from "@/lib/task-tree";
import { TaskParentPicker } from "../TaskParentPicker";
import { isCrossOffHotkey } from "../plugins/CrossOffPlugin";
import {
  $replaceBlockWithParagraph,
  isTaskToggleHotkey,
} from "../taskHotkey";

/**
 * First-class task block. The DB `tasks` row is the source of truth; the node
 * carries a CACHED copy of title/completed/dueAt/important so the editor
 * renders instantly on load. Every edit action (toggle/rename/due/important)
 * writes the DB and refreshes the cache in the same gesture, and
 * `saveNoteContentAction` reconciles `note_tasks` links from the serialized
 * content on autosave.
 */

// ---------------------------------------------------------------------------
// Context: the note hosting this editor (needed to link a new task to a note).
// Provided by NoteEditor; absent (e.g. a detached preview) => read-only chips.
// ---------------------------------------------------------------------------
export const NoteTaskContext = createContext<{ noteId: string } | null>(null);

export type SerializedTaskNode = Spread<
  {
    taskId: string | null;
    title: string;
    completed: boolean;
    dueAt: string | null;
    /** Optional: notes saved before the star shipped simply don't carry it. */
    important?: boolean;
    /** Optional, same reason: absent means "not indented". */
    indent?: number;
    /** Optional: folded, hiding the tasks nested under this one. */
    collapsed?: boolean;
  },
  SerializedLexicalNode
>;

/**
 * Drag payload for moving a task chip between editors (or up and down inside
 * one). A private MIME type rather than text/plain: the drop site has to be
 * able to tell "a task block is being moved here" from "some text was dragged
 * in", and only the former should build a chip. TaskDropPlugin is the reader.
 */
export const TASK_DRAG_TYPE = "application/x-agenda-task";

export interface TaskDragPayload {
  taskId: string;
  title: string;
  completed: boolean;
  dueAt: string | null;
  important: boolean;
  indent: number;
}

/**
 * How far Tab can push a task. Deep enough for a real sub-list, shallow
 * enough that a task can't walk off the right edge of a dock window.
 */
const MAX_TASK_INDENT = 6;
/** One indent step, matching the editor's list indentation. */
const INDENT_STEP_REM = 1.5;

export class TaskNode extends DecoratorNode<JSX.Element> {
  /** DB task id; null while the inline "new task" input is still open. */
  __taskId: string | null;
  __title: string;
  __completed: boolean;
  /** ISO timestamp (midnight UTC of the chosen day) or null. */
  __dueAt: string | null;
  /** Starred: the only thing that makes an overdue task read as red. */
  __important: boolean;
  /**
   * Nesting depth, 0..MAX_TASK_INDENT. A DecoratorNode has no `indent` of its
   * own (that lives on ElementNode), so Tab/Shift+Tab move this and the DOM
   * wrapper turns it into a margin — the block is still a top-level sibling,
   * which is what keeps reconciliation and the log walk simple.
   */
  __indent: number;
  /**
   * Folded. Which blocks that hides is NOT stored — it is derived from indent
   * and document order by `lib/task-tree`, because a task can live in several
   * notes at once and its nesting is a fact about the document, not the row.
   */
  __collapsed: boolean;

  static getType(): string {
    return "task";
  }

  static clone(node: TaskNode): TaskNode {
    return new TaskNode(
      node.__taskId,
      node.__title,
      node.__completed,
      node.__dueAt,
      node.__important,
      node.__indent,
      node.__collapsed,
      node.__key,
    );
  }

  constructor(
    taskId: string | null = null,
    title = "",
    completed = false,
    dueAt: string | null = null,
    important = false,
    indent = 0,
    collapsed = false,
    key?: NodeKey,
  ) {
    super(key);
    this.__taskId = taskId;
    this.__title = title;
    this.__completed = completed;
    this.__dueAt = dueAt;
    this.__important = important;
    this.__indent = clampIndent(indent);
    this.__collapsed = collapsed;
  }

  /** Tolerates missing/malformed fields so old or hand-edited JSON never throws. */
  static importJSON(serializedNode: SerializedTaskNode): TaskNode {
    return $createTaskNode({
      taskId:
        typeof serializedNode.taskId === "string" ? serializedNode.taskId : null,
      title: typeof serializedNode.title === "string" ? serializedNode.title : "",
      completed: serializedNode.completed === true,
      dueAt:
        typeof serializedNode.dueAt === "string" ? serializedNode.dueAt : null,
      // `important` post-dates every note already on disk, so the key is
      // simply ABSENT in all existing content. `=== true` makes missing (and
      // any malformed value) mean "not important" instead of `undefined`,
      // which would leak into the DecoratorNode props and the next save.
      important: serializedNode.important === true,
      indent:
        typeof serializedNode.indent === "number" ? serializedNode.indent : 0,
      collapsed: serializedNode.collapsed === true,
    });
  }

  exportJSON(): SerializedTaskNode {
    return {
      ...super.exportJSON(),
      type: "task",
      version: 1,
      taskId: this.__taskId,
      title: this.__title,
      completed: this.__completed,
      dueAt: this.__dueAt,
      important: this.__important,
      indent: this.__indent,
      collapsed: this.__collapsed,
    };
  }

  createDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "my-2";
    if (this.__indent > 0) {
      el.style.marginInlineStart = `${this.__indent * INDENT_STEP_REM}rem`;
    }
    return el;
  }

  /**
   * Never recreate (false) — the chip holds a live React tree with focus and
   * draft state in it. Indent is a style on the wrapper, so it's patched in
   * place instead.
   */
  updateDOM(prevNode: this, dom: HTMLElement): false {
    if (prevNode.__indent !== this.__indent) {
      dom.style.marginInlineStart =
        this.__indent > 0 ? `${this.__indent * INDENT_STEP_REM}rem` : "";
    }
    return false;
  }

  isInline(): false {
    return false;
  }

  getTextContent(): string {
    return this.__title;
  }

  setTaskId(taskId: string | null): void {
    this.getWritable().__taskId = taskId;
  }

  setTitle(title: string): void {
    this.getWritable().__title = title;
  }

  setCompleted(completed: boolean): void {
    this.getWritable().__completed = completed;
  }

  setDueAt(dueAt: string | null): void {
    this.getWritable().__dueAt = dueAt;
  }

  setImportant(important: boolean): void {
    this.getWritable().__important = important;
  }

  getIndentLevel(): number {
    return this.getLatest().__indent;
  }

  getCollapsed(): boolean {
    return this.getLatest().__collapsed;
  }

  setCollapsed(collapsed: boolean): void {
    this.getWritable().__collapsed = collapsed;
  }

  setIndentLevel(indent: number): void {
    this.getWritable().__indent = clampIndent(indent);
  }

  decorate(): JSX.Element {
    return (
      <TaskComponent
        nodeKey={this.__key}
        taskId={this.__taskId}
        title={this.__title}
        completed={this.__completed}
        dueAt={this.__dueAt}
        important={this.__important}
      />
    );
  }
}

function clampIndent(indent: number): number {
  if (!Number.isFinite(indent)) return 0;
  return Math.min(Math.max(Math.round(indent), 0), MAX_TASK_INDENT);
}

export function $createTaskNode(
  fields: {
    taskId?: string | null;
    title?: string;
    completed?: boolean;
    dueAt?: string | null;
    important?: boolean;
    indent?: number;
    collapsed?: boolean;
  } = {},
): TaskNode {
  return $applyNodeReplacement(
    new TaskNode(
      fields.taskId ?? null,
      fields.title ?? "",
      fields.completed ?? false,
      fields.dueAt ?? null,
      fields.important ?? false,
      fields.indent ?? 0,
      fields.collapsed ?? false,
    ),
  );
}

export function $isTaskNode(
  node: LexicalNode | null | undefined,
): node is TaskNode {
  return node instanceof TaskNode;
}

// ---------------------------------------------------------------------------
// React chip
// ---------------------------------------------------------------------------

/** "Jul 5" from the stored midnight-UTC ISO due date. */
function formatDueChip(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Character offset within `el`'s text at a viewport point, or null when the
 * browser won't resolve one.
 *
 * The committed title is a plain span, so switching to the input throws the
 * click away unless the offset is read off the DOM first. `caretPositionFromPoint`
 * is the standard; WebKit only has the older `caretRangeFromPoint`. Both answer
 * with a TEXT node + offset inside it, which is walked back to an offset in the
 * span's whole string — the title may be several text nodes (it wraps, and it
 * keeps Shift+Enter newlines).
 */
function caretOffsetAt(el: HTMLElement, x: number, y: number): number | null {
  const doc = el.ownerDocument as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | null = null;
  let offset = 0;
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position) {
    node = position.offsetNode;
    offset = position.offset;
  } else {
    const range = doc.caretRangeFromPoint?.(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }
  if (!node || !el.contains(node)) return null;

  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let before = 0;
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const length = text.textContent?.length ?? 0;
    if (text === node) return before + Math.min(offset, length);
    before += length;
  }
  // The point landed on the element itself (padding, past the last line) —
  // the caller's fallback ("end") is a better answer than a guessed 0.
  return null;
}

/**
 * Text field whose commit/cancel fires exactly once (Enter/blur commits,
 * Escape — or an empty commit — cancels). Local replica of the doneRef latch
 * pattern (see BubbleView's LatchedInput; deliberately not imported across
 * features). `resetLatch` lets the task-create flow re-arm the input after a
 * failed server call so the user can retry.
 *
 * Enter and blur both commit but are NOT the same event: `onCommit` is told
 * which one it was, because Enter means "next one, please" (the create flow
 * chains a fresh task) while clicking away means "I'm done here". Same split
 * on the empty path — Enter on an empty row ends the list via `onEmptyEnter`,
 * whereas blurring an empty row just cancels it.
 *
 * A textarea rather than an input, grown to fit its content: a task title is a
 * sentence, not a field, and Shift+Enter puts a second line in the SAME task
 * (plain Enter still commits and chains the next one). The row wraps, so long
 * titles read like a bullet instead of being cut off at the row's width.
 */
function LatchedInput({
  value,
  onChange,
  onCommit,
  onEmptyEnter,
  onCancel,
  onToggleHotkey,
  onCrossOffHotkey,
  onBackspaceAtStart,
  onIndent,
  placeholder,
  className,
  disabled,
  latchRef,
  initialSelection = "end",
}: {
  value: string;
  onChange: (v: string) => void;
  /** `viaEnter` is false when the commit came from blurring the input. */
  onCommit: (viaEnter: boolean) => void;
  /** Enter on an empty row. Falls back to `onCancel` when not supplied. */
  onEmptyEnter?: () => void;
  onCancel: () => void;
  /** Mod+E inside the input: convert this task back to plain text. */
  onToggleHotkey?: () => void;
  /** Mod+Enter inside the input: cross the task off (mirror of CrossOffPlugin). */
  onCrossOffHotkey?: () => void;
  /**
   * Backspace with the caret at position 0 ("right after the checkbox"),
   * regardless of text after it: un-task the row back to plain text.
   */
  onBackspaceAtStart?: () => void;
  /** Tab / Shift+Tab: nest this task one level deeper (+1) or shallower (-1). */
  onIndent?: (delta: number) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  latchRef?: React.MutableRefObject<{ reset: () => void } | null>;
  /**
   * Where the caret lands on mount: a character offset, or "end" (the
   * default). Never silently 0 — `autoFocus` alone parks it at the start,
   * which is what made clicking the END of a title jump to the beginning.
   */
  initialSelection?: number | "end";
}) {
  const doneRef = useRef(false);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  if (latchRef) {
    latchRef.current = {
      reset: () => {
        doneRef.current = false;
      },
    };
  }
  const finish = (commit: boolean, viaEnter = false) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (commit && value.trim()) onCommit(viaEnter);
    else if (viaEnter && onEmptyEnter) onEmptyEnter();
    else onCancel();
  };

  // Place the caret once, on mount: `autoFocus` focuses but selects nothing,
  // so without this every edit starts at offset 0 whatever the user clicked.
  const initialSelectionRef = useRef(initialSelection);
  useEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    const wanted = initialSelectionRef.current;
    const at =
      wanted === "end"
        ? el.value.length
        : Math.max(0, Math.min(wanted, el.value.length));
    el.setSelectionRange(at, at);
  }, []);

  // Grow to the content: collapse first so the height can also come DOWN when
  // a line is deleted, then take whatever the content needs.
  useEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={fieldRef}
      autoFocus
      rows={1}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (onToggleHotkey && isTaskToggleHotkey(e.nativeEvent)) {
          e.preventDefault();
          if (doneRef.current) return;
          doneRef.current = true;
          onToggleHotkey();
          return;
        }
        // Before the plain-Enter commit: Mod+Enter crosses off, not commits.
        if (onCrossOffHotkey && isCrossOffHotkey(e.nativeEvent)) {
          e.preventDefault();
          if (doneRef.current) return;
          doneRef.current = true;
          onCrossOffHotkey();
          return;
        }
        // Tab indents the task instead of moving focus, the way it nests a
        // bullet. It doesn't commit, so the caret stays where it was and you
        // can keep typing at the new depth.
        if (onIndent && e.key === "Tab") {
          e.preventDefault();
          onIndent(e.shiftKey ? -1 : 1);
          return;
        }
        if (
          onBackspaceAtStart &&
          e.key === "Backspace" &&
          e.currentTarget.selectionStart === 0 &&
          e.currentTarget.selectionEnd === 0
        ) {
          e.preventDefault();
          if (doneRef.current) return;
          doneRef.current = true;
          onBackspaceAtStart();
          return;
        }
        // Shift+Enter is the one Enter that isn't a commit: it falls through
        // to the textarea and adds a line inside this task.
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          finish(true, true);
        }
        if (e.key === "Escape") finish(false);
      }}
      // Keep Lexical from reacting to clicks inside the input.
      onMouseDown={(e) => e.stopPropagation()}
      placeholder={placeholder}
      className={`resize-none overflow-hidden ${className ?? ""}`}
    />
  );
}

function TaskComponent({
  nodeKey,
  taskId,
  title,
  completed,
  dueAt,
  important,
}: {
  nodeKey: NodeKey;
  taskId: string | null;
  title: string;
  completed: boolean;
  dueAt: string | null;
  important: boolean;
}) {
  const [editor] = useLexicalComposerContext();
  const noteCtx = useContext(NoteTaskContext);
  const noteId = noteCtx?.noteId ?? null;

  // The user's LOCAL calendar day, resolved after mount — only the client
  // knows its timezone, so computing it during render would risk a hydration
  // mismatch on a server-rendered note. Until it lands nothing reads overdue.
  const [todayStr, setTodayStr] = useState<string | null>(null);
  useEffect(() => setTodayStr(localDateString()), []);

  // Draft (not-yet-created) state.
  const [draft, setDraft] = useState(title);
  const [creating, setCreating] = useState(false);
  const createLatchRef = useRef<{ reset: () => void } | null>(null);

  // Inline title editing (created state).
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  // Where the click that opened the editor landed in the title; null = end.
  const [titleCaret, setTitleCaret] = useState<number | null>(null);

  // Drag state: the row dims in place while its copy travels with the cursor,
  // so the gesture reads as "this one is moving" rather than "one appeared".
  const rowRef = useRef<HTMLDivElement | null>(null);
  const ghostRef = useRef<HTMLElement | null>(null);
  const [dragging, setDragging] = useState(false);
  // A drag interrupted by the tab closing/navigating never fires dragend.
  useEffect(() => () => ghostRef.current?.remove(), []);

  /** Run a mutation against the (writable) node inside an editor update. */
  const withNode = (fn: (node: TaskNode) => void) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isTaskNode(node)) fn(node);
    });
  };

  const removeSelf = () => {
    editor.update(() => {
      $getNodeByKey(nodeKey)?.remove();
    });
  };

  /**
   * Tab / Shift+Tab while typing in the task.
   *
   * Clamped against the task ABOVE, not just the 0..MAX range: a task may go
   * at most one level deeper than its predecessor. Tabbing twice in a row used
   * to produce a task that rendered indented but was a child of nothing — it
   * folded with neither its neighbour nor the task above it.
   */
  const indentBy = (delta: number) => {
    withNode((node) => {
      const prev = node.getPreviousSibling();
      const previousIndent = $isTaskNode(prev) ? prev.getIndentLevel() : null;
      node.setIndentLevel(
        clampToParentDepth(
          node.getIndentLevel() + delta,
          previousIndent,
          MAX_TASK_INDENT,
        ),
      );
    });
  };

  /**
   * Dragging a task is a MOVE of the block, not a copy of its text. The
   * payload is everything the drop site needs to rebuild the chip (the DB row
   * is shared, so the task itself is untouched by the trip), and the source
   * removes itself on dragend — but only if a drop site actually accepted it,
   * which `dropEffect` reports. Drop it on the desktop and nothing is lost.
   */
  const onDragStart = (event: React.DragEvent) => {
    if (!taskId) return;
    // The browser's default drag image is a snapshot of the DRAGGED element —
    // here a 12px grip, which looks like nothing is moving at all. Snapshot a
    // copy of the whole row instead, held under the cursor where it was
    // grabbed, so the task itself visibly travels.
    const row = rowRef.current;
    if (row) {
      const rect = row.getBoundingClientRect();
      const ghost = row.cloneNode(true) as HTMLElement;
      ghost.style.position = "fixed";
      // Off-screen but still rendered: the snapshot is taken from a live
      // element, so it has to be in the document and painted.
      ghost.style.top = "-10000px";
      ghost.style.left = "0";
      ghost.style.width = `${rect.width}px`;
      ghost.style.pointerEvents = "none";
      ghost.style.opacity = "0.95";
      ghost.style.boxShadow = "0 12px 32px rgba(0,0,0,0.55)";
      document.body.appendChild(ghost);
      ghostRef.current = ghost;
      event.dataTransfer.setDragImage(
        ghost,
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
    }
    setDragging(true);

    const payload: TaskDragPayload = {
      taskId,
      title,
      completed,
      dueAt,
      important,
      indent: 0,
    };
    editor.getEditorState().read(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isTaskNode(node)) payload.indent = node.getIndentLevel();
    });
    event.dataTransfer.setData(TASK_DRAG_TYPE, JSON.stringify(payload));
    // Plain text so a task dragged into any other app (or a plain textarea)
    // arrives as its title rather than as nothing.
    event.dataTransfer.setData("text/plain", title);
    event.dataTransfer.effectAllowed = "move";
  };

  const onDragEnd = (event: React.DragEvent) => {
    ghostRef.current?.remove();
    ghostRef.current = null;
    setDragging(false);
    if (event.dataTransfer.dropEffect === "move") removeSelf();
  };

  /**
   * Task → plain paragraph carrying `text` (the un-task conversion). Caret at
   * the end for the toggle hotkey; the backspace-at-start path passes "start"
   * so the caret stays where the checkbox was.
   */
  const toParagraph = (text: string, caret: "start" | "end" = "end") => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isTaskNode(node)) $replaceBlockWithParagraph(node, text, caret);
    });
    // DOM focus is still in the chip's (unmounting) input; reclaim it so the
    // caret visibly lands in the new paragraph.
    editor.focus();
  };

  /**
   * Drop a fresh empty task right below this one. Its input autofocuses, so
   * this is what makes a run of tasks type like a checklist: title, Enter,
   * title, Enter. Inserted immediately rather than after the create round
   * trip — waiting on the network to show the next row would make Enter feel
   * like it dropped the keystroke.
   */
  const appendEmptyTask = () => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      // Same depth as the task it follows: Enter continues the run you're in,
      // it doesn't unindent you out of it.
      if ($isTaskNode(node)) {
        node.insertAfter($createTaskNode({ indent: node.getIndentLevel() }));
      }
    });
  };

  // --- Create flow (taskId === null) ---------------------------------------
  const submitCreate = (chain: boolean) => {
    const value = draft.trim();
    if (!value || !noteId) {
      removeSelf();
      return;
    }
    setCreating(true);
    if (chain) appendEmptyTask();
    createTaskAction(noteId, value)
      .then(({ id, dueAt: created }) => {
        withNode((node) => {
          node.setTaskId(id);
          node.setTitle(value);
          // The server may have defaulted a due date (daily jots schedule
          // their tasks for that day). Mirror it into the node so the chip
          // renders now rather than on the next load.
          if (created) node.setDueAt(created);
        });
      })
      .catch((err) => {
        console.error("[tasks] create failed:", err);
        // Re-arm the input so the user can retry (or Escape to discard).
        setCreating(false);
        createLatchRef.current?.reset();
      });
  };

  // --- Toggle (optimistic) ---------------------------------------------------
  const toggle = () => {
    if (!taskId) return;
    const next = !completed;
    withNode((node) => node.setCompleted(next));
    toggleTaskAction(taskId, next).catch((err) => {
      console.error("[tasks] toggle failed:", err);
      withNode((node) => node.setCompleted(!next));
    });
  };

  // --- Rename (optimistic) ---------------------------------------------------
  /**
   * `viaEnter` chains a fresh task below, the way Enter continues a bullet
   * list — an existing task behaves like a new one once you're typing in it.
   * Blur (or Escape) just commits and leaves the run where it is.
   */
  const submitRename = (viaEnter = false) => {
    setEditingTitle(false);
    if (viaEnter) appendEmptyTask();
    if (!taskId) return;
    const value = titleDraft.trim() || "Untitled task";
    if (value === title) return;
    const prev = title;
    withNode((node) => node.setTitle(value));
    renameTaskAction(taskId, value).catch((err) => {
      console.error("[tasks] rename failed:", err);
      withNode((node) => node.setTitle(prev));
    });
  };

  // --- Due date (optimistic) ---------------------------------------------------
  const setDue = (dateStr: string) => {
    if (!taskId) return;
    const next = dateStr ? `${dateStr}T00:00:00.000Z` : null;
    if (next === dueAt) return;
    const prev = dueAt;
    withNode((node) => node.setDueAt(next));
    setTaskDueAction(taskId, dateStr || null).catch((err) => {
      console.error("[tasks] set due failed:", err);
      withNode((node) => node.setDueAt(prev));
    });
  };

  // --- Important star (optimistic) ---------------------------------------------
  const toggleImportant = () => {
    if (!taskId) return;
    const next = !important;
    withNode((node) => node.setImportant(next));
    setTaskImportantAction(taskId, next).catch((err) => {
      console.error("[tasks] set important failed:", err);
      withNode((node) => node.setImportant(!next));
    });
  };

  // items-start, not items-center: a task title wraps, and the checkbox and
  // the controls belong on its FIRST line rather than floating to the middle
  // of a three-line task.
  const rowClass =
    "group flex items-start gap-2.5 rounded-lg border border-white/10 bg-panel px-3 py-2";
  // The box sits on the text's first line; 4px down from the row's top edge
  // centres it against a 0.9375rem line.
  const boxClass = "mt-[0.1875rem] h-4 w-4 shrink-0 rounded-md border";
  // Every row is contentEditable={false} (see LinkedNoteCardNode, same reason):
  // the chip lives inside the note's contenteditable, so without it the browser
  // will park the text caret inside the row — a blinking bar in the checkbox
  // that reads as a stray dot. The row's own input/textarea still take focus
  // and edit normally; form fields are editable inside a non-editable subtree.

  // --- Not yet created ---------------------------------------------------------
  if (taskId === null) {
    // Without a hosting note we can't create a task row — render inert.
    if (!noteId) {
      return (
        <div
          className={rowClass}
          contentEditable={false}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span className={`${boxClass} border-sage/40`} />
          <span className="whitespace-pre-wrap break-words text-[0.9375rem] text-ink-400">
            {title || "Task (unavailable here)"}
          </span>
        </div>
      );
    }
    return (
      <div
        className={rowClass}
        contentEditable={false}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <span className={`${boxClass} border-sage/40`} />
        <LatchedInput
          value={draft}
          onChange={setDraft}
          onCommit={submitCreate}
          // Enter on an empty row ends the run: the trailing task becomes an
          // empty paragraph with the caret in it, so you type your way out of
          // the list the same way you'd leave a bullet list.
          onEmptyEnter={() => toParagraph("")}
          // Escape keeps typed/converted text as a paragraph — a row that was
          // toggled into a task must never lose its text on cancel.
          onCancel={() => (draft.trim() ? toParagraph(draft) : removeSelf())}
          onToggleHotkey={() => toParagraph(draft)}
          // Backspace right after the checkbox: un-task the row (text kept;
          // an empty draft just becomes an empty paragraph).
          onBackspaceAtStart={() => toParagraph(draft, "start")}
          onIndent={indentBy}
          placeholder="Task title…"
          disabled={creating}
          latchRef={createLatchRef}
          className="min-w-0 flex-1 bg-transparent text-[0.9375rem] outline-none placeholder:text-ink-400 disabled:opacity-60"
        />
      </div>
    );
  }

  // --- Created ---------------------------------------------------------------
  const readOnly = !noteCtx;
  const dueDateValue = dueAt ? dueAt.slice(0, 10) : "";

  /**
   * Overdue = due strictly before the local today, compared as YYYY-MM-DD
   * strings (the stored ISO is midnight UTC of the chosen day, so its first
   * ten chars ARE the calendar day — same comparison the tasks surfaces use).
   * A crossed-off task is never overdue; it's already done.
   */
  const overdue =
    !completed &&
    dueAt !== null &&
    todayStr !== null &&
    dueAt.slice(0, 10) < todayStr;
  // Red is reserved for overdue AND important, so the star is what makes a
  // late task shout; everything else overdue reads calm blue.
  const dueClass = overdue
    ? important
      ? "text-overdue"
      : "text-overdue-calm"
    : "text-ink-400";
  const starClass = important
    ? overdue
      ? "text-overdue"
      : "text-ink-300"
    : "text-ink-600 hover:text-ink-300";
  const starLabel = important ? "Unmark important" : "Mark important";

  return (
    <div
      ref={rowRef}
      className={`${rowClass} ${
        dragging ? "opacity-40 ring-1 ring-sage/40" : ""
      }`}
      contentEditable={false}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Drag handle. Only the grip is draggable, never the row: the title is
          selectable text and the checkbox is a click target, and making the
          whole row a drag source would steal both gestures. */}
      {!readOnly && (
        <span
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          aria-hidden
          title="Drag to move this task"
          className="mt-[0.1875rem] -ml-1 flex h-4 w-3 flex-none cursor-grab items-center justify-center text-ink-700 opacity-0 transition-opacity hover:text-ink-400 group-hover:opacity-100 active:cursor-grabbing"
        >
          <GripVertical className="h-3 w-3" />
        </span>
      )}

      {/* Drawn, not a native checkbox: the OS control renders as a white slab
          on this surface. Empty is a sage outline over the panel; done fills
          it with the accent and inks the tick dark. */}
      <button
        type="button"
        role="checkbox"
        aria-checked={completed}
        disabled={readOnly}
        onClick={toggle}
        // preventDefault as well as stopPropagation: ticking a box is not a
        // selection gesture, so it must not move the caret either.
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        aria-label={completed ? "Mark task incomplete" : "Mark task complete"}
        className={`${boxClass} flex cursor-pointer items-center justify-center transition-colors disabled:cursor-default ${
          completed
            ? "border-sage bg-sage text-sage-ink"
            : "border-sage/55 bg-transparent hover:border-sage hover:bg-sage/10"
        }`}
      >
        {completed && <Check className="h-3 w-3" strokeWidth={3.5} />}
      </button>

      {editingTitle ? (
        <LatchedInput
          value={titleDraft}
          onChange={setTitleDraft}
          // The clicked character, or the end of the title — never the start.
          initialSelection={titleCaret ?? "end"}
          onCommit={submitRename}
          onCancel={() => setEditingTitle(false)}
          onToggleHotkey={() => {
            setEditingTitle(false);
            toParagraph(titleDraft.trim() || title);
          }}
          // Mod+Enter mid-edit: commit any rename, then cross the task off.
          onCrossOffHotkey={() => {
            submitRename();
            toggle();
          }}
          // Backspace right after the checkbox: turn the task back into plain
          // text carrying whatever is in the input (the DB row survives —
          // autosave reconciles the note_tasks link away).
          onBackspaceAtStart={() => {
            setEditingTitle(false);
            toParagraph(titleDraft, "start");
          }}
          onIndent={indentBy}
          className="min-w-0 flex-1 border-b border-ink-600 bg-transparent text-[0.9375rem] outline-none"
        />
      ) : (
        <span
          onClick={(e) => {
            if (readOnly) return;
            // Read the caret out of the span before it unmounts: the input
            // that replaces it has no idea where the click was.
            setTitleCaret(caretOffsetAt(e.currentTarget, e.clientX, e.clientY));
            setTitleDraft(title);
            setEditingTitle(true);
          }}
          title={readOnly ? undefined : "Click to edit"}
          // Wraps like a bullet and keeps the newlines Shift+Enter put in it —
          // a task title is never cut off at the row's width.
          className={`min-w-0 flex-1 whitespace-pre-wrap break-words text-[0.9375rem] ${
            completed
              ? "text-ink-500 line-through strike-muted"
              : "text-ink-200"
          } ${readOnly ? "" : "cursor-text"}`}
        >
          {title || "Untitled task"}
        </span>
      )}

      {/* Due date: the native date input sits invisibly on top of the trigger
          so a click opens the OS picker without any showPicker() gymnastics. */}
      <span
        className="relative flex shrink-0 items-center"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {dueAt ? (
          <span
            className={`flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-xs ${dueClass}`}
          >
            <CalendarDays className="h-3 w-3" />
            {formatDueChip(dueAt)}
          </span>
        ) : (
          <span className="rounded p-1 text-ink-600 hover:text-ink-400">
            <CalendarDays className="h-4 w-4" />
          </span>
        )}
        {!readOnly && (
          <input
            type="date"
            value={dueDateValue}
            onChange={(e) => setDue(e.target.value)}
            aria-label="Set due date"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        )}
      </span>

      {/* Parent picker: Tab can only nest a task under the row above it, so
          this is the way to hang it off any other task in the note. It writes
          indent + position, never a stored parent — see TaskParentPicker. */}
      {!readOnly && (
        <TaskParentPicker nodeKey={nodeKey} maxIndent={MAX_TASK_INDENT} />
      )}

      {/* Important star. In a detached (read-only) preview it stays as a mute
          indicator — rendered only when the task is actually starred. */}
      {(!readOnly || important) && (
        <button
          type="button"
          disabled={readOnly}
          onClick={toggleImportant}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label={starLabel}
          title={starLabel}
          className={`shrink-0 rounded p-1 ${starClass} disabled:cursor-default`}
        >
          <Star className={`h-4 w-4 ${important ? "fill-current" : ""}`} />
        </button>
      )}
    </div>
  );
}
