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
import { CalendarDays, Check, Star } from "lucide-react";

import {
  createTaskAction,
  renameTaskAction,
  setTaskDueAction,
  setTaskImportantAction,
  toggleTaskAction,
} from "@/app/app/actions";
import { localDateString } from "@/lib/dates";
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
  /** Starred: the only thing that makes an overdue task read as red. */
  __important: boolean;

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
      node.__key,
    );
  }

  constructor(
    taskId: string | null = null,
    title = "",
    completed = false,
    dueAt: string | null = null,
    important = false,
    key?: NodeKey,
  ) {
    super(key);
    this.__taskId = taskId;
    this.__title = title;
    this.__completed = completed;
    this.__dueAt = dueAt;
    this.__important = important;
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

  setImportant(important: boolean): void {
    this.getWritable().__important = important;
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

export function $createTaskNode(
  fields: {
    taskId?: string | null;
    title?: string;
    completed?: boolean;
    dueAt?: string | null;
    important?: boolean;
  } = {},
): TaskNode {
  return $applyNodeReplacement(
    new TaskNode(
      fields.taskId ?? null,
      fields.title ?? "",
      fields.completed ?? false,
      fields.dueAt ?? null,
      fields.important ?? false,
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
  placeholder,
  className,
  disabled,
  latchRef,
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
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  latchRef?: React.MutableRefObject<{ reset: () => void } | null>;
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
      if ($isTaskNode(node)) node.insertAfter($createTaskNode({}));
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
    "flex items-start gap-2.5 rounded-lg border border-white/10 bg-panel px-3 py-2";
  // The box sits on the text's first line; 4px down from the row's top edge
  // centres it against a 0.9375rem line.
  const boxClass = "mt-[0.1875rem] h-4 w-4 shrink-0 rounded-[0.3125rem] border";

  // --- Not yet created ---------------------------------------------------------
  if (taskId === null) {
    // Without a hosting note we can't create a task row — render inert.
    if (!noteId) {
      return (
        <div className={rowClass} onMouseDown={(e) => e.stopPropagation()}>
          <span className={`${boxClass} border-sage/40`} />
          <span className="whitespace-pre-wrap break-words text-[0.9375rem] text-ink-400">
            {title || "Task (unavailable here)"}
          </span>
        </div>
      );
    }
    return (
      <div className={rowClass} onMouseDown={(e) => e.stopPropagation()}>
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
    <div className={rowClass} onMouseDown={(e) => e.stopPropagation()}>
      {/* Drawn, not a native checkbox: the OS control renders as a white slab
          on this surface. Empty is a sage outline over the panel; done fills
          it with the accent and inks the tick dark. */}
      <button
        type="button"
        role="checkbox"
        aria-checked={completed}
        disabled={readOnly}
        onClick={toggle}
        onMouseDown={(e) => e.stopPropagation()}
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
          // Wraps like a bullet and keeps the newlines Shift+Enter put in it —
          // a task title is never cut off at the row's width.
          className={`min-w-0 flex-1 whitespace-pre-wrap break-words text-[0.9375rem] ${
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
