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

  static getType(): string {
    return "task";
  }

  static clone(node: TaskNode): TaskNode {
    return new TaskNode(
      node.__taskId,
      node.__title,
      node.__completed,
      node.__dueAt,
      node.__key,
    );
  }

  constructor(
    taskId: string | null = null,
    title = "",
    completed = false,
    dueAt: string | null = null,
    key?: NodeKey,
  ) {
    super(key);
    this.__taskId = taskId;
    this.__title = title;
    this.__completed = completed;
    this.__dueAt = dueAt;
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
    };
  }

  createDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "my-2";
    return el;
  }

  updateDOM(): false {
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

export function $createTaskNode(
  fields: {
    taskId?: string | null;
    title?: string;
    completed?: boolean;
    dueAt?: string | null;
  } = {},
): TaskNode {
  return $applyNodeReplacement(
    new TaskNode(
      fields.taskId ?? null,
      fields.title ?? "",
      fields.completed ?? false,
      fields.dueAt ?? null,
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
    "flex items-center gap-2.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900";

  // --- Not yet created ---------------------------------------------------------
  if (taskId === null) {
    // Without a hosting note we can't create a task row — render inert.
    if (!noteId) {
      return (
        <div className={rowClass} onMouseDown={(e) => e.stopPropagation()}>
          <span className="h-4 w-4 rounded border border-neutral-300 dark:border-neutral-600" />
          <span className="text-[0.9375rem] text-neutral-400">
            {title || "Task (unavailable here)"}
          </span>
        </div>
      );
    }
    return (
      <div className={rowClass} onMouseDown={(e) => e.stopPropagation()}>
        <span className="h-4 w-4 shrink-0 rounded border border-neutral-300 dark:border-neutral-600" />
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
          placeholder="Task title…"
          disabled={creating}
          latchRef={createLatchRef}
          className="min-w-0 flex-1 bg-transparent text-[0.9375rem] outline-none placeholder:text-neutral-400 disabled:opacity-60"
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
        className="h-4 w-4 shrink-0 cursor-pointer accent-blue-600 disabled:cursor-default"
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
          className="min-w-0 flex-1 border-b border-neutral-300 bg-transparent text-[0.9375rem] outline-none dark:border-neutral-600"
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
              ? "text-neutral-400 line-through dark:text-neutral-500"
              : "text-neutral-800 dark:text-neutral-200"
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
          <span className="flex items-center gap-1 rounded-full border border-neutral-200 px-2 py-0.5 text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
            <CalendarDays className="h-3 w-3" />
            {formatDueChip(dueAt)}
          </span>
        ) : (
          <span className="rounded p-1 text-neutral-300 hover:text-neutral-500 dark:text-neutral-600 dark:hover:text-neutral-400">
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
