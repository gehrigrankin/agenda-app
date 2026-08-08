"use client";

import {
  createContext,
  useContext,
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
import { CalendarDays } from "lucide-react";

import {
  createTaskAction,
  renameTaskAction,
  setTaskDueAction,
  toggleTaskAction,
} from "@/app/app/actions";
import {
  clampTaskIndent,
  descendantTaskIndices,
  taskHasSection,
  type OutlineRow,
} from "@/lib/task-outline";
import { isCrossOffHotkey } from "../plugins/CrossOffPlugin";
import {
  $replaceBlockWithParagraph,
  isTaskToggleHotkey,
} from "../taskHotkey";

/**
 * First-class task block. The DB `tasks` row is the source of truth; the node
 * carries a CACHED copy of title/completed/dueAt so the editor renders
 * instantly on load. Every edit action (toggle/rename/due) writes the DB and
 * refreshes the cache in the same gesture, and `saveNoteContentAction`
 * reconciles `note_tasks` links from the serialized content on autosave.
 *
 * Tasks can nest — the same parent/child/dropdown behavior as bullet lists —
 * via a persisted `indent` depth (Tab/Shift+Tab) and `collapsed` flag, even
 * though TaskNode is a flat DecoratorNode sibling rather than a real
 * container. A task's "section" (its children, for folding and for
 * cascade-check) is everything after it up to the next task at the same or
 * shallower indent — see `src/lib/task-outline.ts` and CollapsePlugin, which
 * mirrors CollapsibleHeadingNode's section semantics keyed on indent instead
 * of heading level.
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
    indent: number;
    collapsed: boolean;
  },
  SerializedLexicalNode
>;

export class TaskNode extends DecoratorNode<JSX.Element> {
  /** DB task id; null while the inline "new task" input is still open. */
  __taskId: string | null;
  __title: string;
  __completed: boolean;
  /** ISO timestamp (midnight UTC of the chosen day) or null. */
  __dueAt: string | null;
  /** Nesting depth, like a bullet's indent — see the header comment. */
  __indent: number;
  /** Folds this task's section (its children) when true. */
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
    indent = 0,
    collapsed = false,
    key?: NodeKey,
  ) {
    super(key);
    this.__taskId = taskId;
    this.__title = title;
    this.__completed = completed;
    this.__dueAt = dueAt;
    this.__indent = indent;
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
      indent:
        typeof serializedNode.indent === "number" && serializedNode.indent > 0
          ? serializedNode.indent
          : 0,
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
      indent: this.__indent,
      collapsed: this.__collapsed,
    };
  }

  createDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "my-2";
    applyTaskChrome(el, this);
    return el;
  }

  updateDOM(_prevNode: this, dom: HTMLElement): false {
    applyTaskChrome(dom, this);
    return false;
  }

  isInline(): false {
    return false;
  }

  getTextContent(): string {
    return this.__title;
  }

  getTaskId(): string | null {
    return this.getLatest().__taskId;
  }

  getCompleted(): boolean {
    return this.getLatest().__completed;
  }

  getIndent(): number {
    return this.getLatest().__indent;
  }

  getCollapsed(): boolean {
    return this.getLatest().__collapsed;
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

  setIndent(indent: number): void {
    this.getWritable().__indent = indent;
  }

  setCollapsed(collapsed: boolean): void {
    this.getWritable().__collapsed = collapsed;
  }

  decorate(): JSX.Element {
    return (
      <TaskComponent
        nodeKey={this.__key}
        taskId={this.__taskId}
        title={this.__title}
        completed={this.__completed}
        dueAt={this.__dueAt}
      />
    );
  }
}

/** Indent margin + the collapsed marker, shared by createDOM/updateDOM. */
function applyTaskChrome(el: HTMLElement, node: TaskNode): void {
  el.style.marginLeft = node.__indent > 0 ? `${node.__indent * 1.5}rem` : "";
  if (node.__collapsed) el.dataset.collapsed = "true";
  else delete el.dataset.collapsed;
}

export function $createTaskNode(
  fields: {
    taskId?: string | null;
    title?: string;
    completed?: boolean;
    dueAt?: string | null;
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

/**
 * `node`'s outline row plus every following sibling's row, `node`'s own row
 * first (index 0) so the pure `task-outline` helpers (which take a
 * parent-index into a flat row list) can be reused as-is. Non-task siblings
 * get an indent of `Infinity` — they never bound a task's section themselves,
 * only another task at the same-or-shallower depth does.
 */
function $outlineFrom(node: TaskNode): {
  rows: OutlineRow[];
  siblings: LexicalNode[];
} {
  const siblings: LexicalNode[] = [];
  const rows: OutlineRow[] = [{ indent: node.getIndent(), isTask: true }];
  for (let sib = node.getNextSibling(); sib; sib = sib.getNextSibling()) {
    siblings.push(sib);
    rows.push({
      indent: $isTaskNode(sib) ? sib.getIndent() : Infinity,
      isTask: $isTaskNode(sib),
    });
  }
  return { rows, siblings };
}

/** Whether folding `node` would actually hide anything. */
export function $taskHasSection(node: TaskNode): boolean {
  return taskHasSection($outlineFrom(node).rows, 0);
}

/** Nested task rows under `node` — the rows a parent-check cascades to. */
export function $descendantTasks(node: TaskNode): TaskNode[] {
  const { rows, siblings } = $outlineFrom(node);
  return descendantTaskIndices(rows, 0).map((i) => siblings[i - 1] as TaskNode);
}

/** Tab/Shift+Tab: indent one level deeper than the previous row, or outdent. */
export function $indentTaskNode(node: TaskNode, direction: 1 | -1): void {
  const prev = node.getPreviousSibling();
  const previousIndent = $isTaskNode(prev) ? prev.getIndent() : null;
  node.setIndent(clampTaskIndent(node.getIndent(), previousIndent, direction));
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
 * Text input whose commit/cancel fires exactly once (Enter/blur commits,
 * Escape — or an empty commit — cancels). Local replica of the doneRef latch
 * pattern (see BubbleView's LatchedInput; deliberately not imported across
 * features). `resetLatch` lets the task-create flow re-arm the input after a
 * failed server call so the user can retry.
 */
function LatchedInput({
  value,
  onChange,
  onCommit,
  onCancel,
  onToggleHotkey,
  onCrossOffHotkey,
  onBackspaceAtStart,
  onIndentHotkey,
  placeholder,
  className,
  disabled,
  latchRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
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
  /** Tab (indent) / Shift+Tab (outdent) — nest this task under/out from the previous one. */
  onIndentHotkey?: (direction: 1 | -1) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  latchRef?: React.MutableRefObject<{ reset: () => void } | null>;
}) {
  const doneRef = useRef(false);
  if (latchRef) {
    latchRef.current = {
      reset: () => {
        doneRef.current = false;
      },
    };
  }
  const finish = (commit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (commit && value.trim()) onCommit();
    else onCancel();
  };

  return (
    <input
      autoFocus
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
        if (onIndentHotkey && e.key === "Tab") {
          e.preventDefault();
          onIndentHotkey(e.shiftKey ? -1 : 1);
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        }
        if (e.key === "Escape") finish(false);
      }}
      // Keep Lexical from reacting to clicks inside the input.
      onMouseDown={(e) => e.stopPropagation()}
      placeholder={placeholder}
      className={className}
    />
  );
}

function TaskComponent({
  nodeKey,
  taskId,
  title,
  completed,
  dueAt,
}: {
  nodeKey: NodeKey;
  taskId: string | null;
  title: string;
  completed: boolean;
  dueAt: string | null;
}) {
  const [editor] = useLexicalComposerContext();
  const noteCtx = useContext(NoteTaskContext);
  const noteId = noteCtx?.noteId ?? null;

  // Draft (not-yet-created) state.
  const [draft, setDraft] = useState(title);
  const [creating, setCreating] = useState(false);
  const createLatchRef = useRef<{ reset: () => void } | null>(null);

  // Inline title editing (created state).
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  /** Run a mutation against a (writable) node inside an editor update — this
   * node by default, or another task's by key (used for cascade-check). */
  const withNode = (fn: (node: TaskNode) => void, key: NodeKey = nodeKey) => {
    editor.update(() => {
      const node = $getNodeByKey(key);
      if ($isTaskNode(node)) fn(node);
    });
  };

  const indent = (direction: 1 | -1) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isTaskNode(node)) $indentTaskNode(node, direction);
    });
  };

  const removeSelf = () => {
    editor.update(() => {
      $getNodeByKey(nodeKey)?.remove();
    });
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

  // --- Create flow (taskId === null) ---------------------------------------
  const submitCreate = () => {
    const value = draft.trim();
    if (!value || !noteId) {
      removeSelf();
      return;
    }
    setCreating(true);
    createTaskAction(noteId, value)
      .then(({ id }) => {
        withNode((node) => {
          node.setTaskId(id);
          node.setTitle(value);
        });
      })
      .catch((err) => {
        console.error("[tasks] create failed:", err);
        // Re-arm the input so the user can retry (or Escape to discard).
        setCreating(false);
        createLatchRef.current?.reset();
      });
  };

  // --- Toggle (optimistic, cascades to nested child tasks) -------------------
  const toggle = () => {
    if (!taskId) return;
    const next = !completed;
    // Checking/unchecking a parent applies the same state to every task
    // nested under it (its "section" — see $descendantTasks), same as
    // checking a bullet-list parent would visually imply for its children.
    const cascaded: { key: NodeKey; taskId: string }[] = [];
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (!$isTaskNode(node)) return;
      node.setCompleted(next);
      for (const child of $descendantTasks(node)) {
        if (child.getCompleted() === next) continue;
        child.setCompleted(next);
        const childTaskId = child.getTaskId();
        if (childTaskId) cascaded.push({ key: child.getKey(), taskId: childTaskId });
      }
    });
    toggleTaskAction(taskId, next).catch((err) => {
      console.error("[tasks] toggle failed:", err);
      withNode((node) => node.setCompleted(!next));
    });
    for (const child of cascaded) {
      toggleTaskAction(child.taskId, next).catch((err) => {
        console.error("[tasks] child toggle failed:", err);
        withNode((node) => node.setCompleted(!next), child.key);
      });
    }
  };

  // --- Rename (optimistic) ---------------------------------------------------
  const submitRename = () => {
    setEditingTitle(false);
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

  const rowClass =
    "flex items-center gap-2.5 rounded-lg border border-white/10 bg-panel px-3 py-2";

  // --- Not yet created ---------------------------------------------------------
  if (taskId === null) {
    // Without a hosting note we can't create a task row — render inert.
    if (!noteId) {
      return (
        <div className={rowClass} onMouseDown={(e) => e.stopPropagation()}>
          <span className="h-4 w-4 rounded border border-ink-600" />
          <span className="text-[0.9375rem] text-ink-400">
            {title || "Task (unavailable here)"}
          </span>
        </div>
      );
    }
    return (
      <div className={rowClass} onMouseDown={(e) => e.stopPropagation()}>
        <span className="h-4 w-4 shrink-0 rounded border border-ink-600" />
        <LatchedInput
          value={draft}
          onChange={setDraft}
          onCommit={submitCreate}
          // Escape keeps typed/converted text as a paragraph — a row that was
          // toggled into a task must never lose its text on cancel.
          onCancel={() => (draft.trim() ? toParagraph(draft) : removeSelf())}
          onToggleHotkey={() => toParagraph(draft)}
          // Backspace right after the checkbox: un-task the row (text kept;
          // an empty draft just becomes an empty paragraph).
          onBackspaceAtStart={() => toParagraph(draft, "start")}
          onIndentHotkey={indent}
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

  return (
    <div className={rowClass} onMouseDown={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        checked={completed}
        disabled={readOnly}
        onChange={toggle}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label={completed ? "Mark task incomplete" : "Mark task complete"}
        className="h-4 w-4 shrink-0 cursor-pointer accent-sage disabled:cursor-default"
      />

      {editingTitle ? (
        <LatchedInput
          value={titleDraft}
          onChange={setTitleDraft}
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
          onIndentHotkey={indent}
          className="min-w-0 flex-1 border-b border-ink-600 bg-transparent text-[0.9375rem] outline-none"
        />
      ) : (
        <span
          onClick={() => {
            if (readOnly) return;
            setTitleDraft(title);
            setEditingTitle(true);
          }}
          title={readOnly ? undefined : "Click to edit"}
          className={`min-w-0 flex-1 truncate text-[0.9375rem] ${
            completed
              ? "text-ink-500 line-through"
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
          <span className="flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-xs text-ink-400">
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
    </div>
  );
}
