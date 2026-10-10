"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  FileText,
  Moon,
  Plus,
  Trash2,
  X,
} from "lucide-react";

import {
  deleteTaskAction,
  renameTaskAction,
  toggleTaskAction,
  type TagResult,
  type TagWithCountResult,
  type TaskNoteLink,
} from "@/app/app/actions";
import {
  createSubtaskAction,
  listSubtasksAction,
  type ListTaskResult,
  type SubtaskResult,
} from "@/app/app/tasks/actions";
import { SIDEBAR_FOCUS } from "@/components/layout/sidebar";
import { ImportantStar } from "@/components/tasks/ImportantStar";
import { TaskTagPicker } from "@/components/tasks/TaskTagPicker";
import { addDays } from "@/lib/dates";
import { useOutsideClose } from "@/lib/hooks/use-outside-close";
import { describeSchedule, formatTimeShort } from "@/lib/recurrence";
import { subjectColor } from "@/lib/subjects";
import { dayHeading, isSubjectTag, subjectOf } from "@/lib/task-lists";
import { loadNotesForTask } from "@/lib/task-note-links";

import type { TaskListsApi } from "./useTaskLists";

/**
 * Sidebar 2 of the Tasks page (design 5b, right): the selected task's
 * details. Checkbox + editable title, PROPERTIES (Due with an optional time,
 * List = subject, Repeat, Tags, Someday), SUBTASKS, NOTES (the task's own
 * description, saved on a debounce) and the LINKED NOTE cards; Move to
 * tomorrow / Delete at the foot. Sized to work in a ~23rem panel — docked on
 * desktop, a slide-over on tablets (PageLayout's call).
 */

const SECTION =
  "mb-1.5 flex items-center gap-1.5 text-[0.6875rem] font-semibold tracking-[0.1em] text-ink-500 uppercase";
const PROP_LABEL = "w-[5.25rem] flex-none text-[0.875rem] text-ink-500";
const PROP_ROW = "flex min-h-[2.3rem] items-center gap-2 touch:min-h-[3.4rem]";
const VALUE_BUTTON = `-mx-1.5 rounded-md px-1.5 py-1 text-left text-[0.875rem] hover:bg-white/5 ${SIDEBAR_FOCUS}`;

export function TaskDetails({
  task,
  api,
  subjects,
  onShowRepeating,
}: {
  task: ListTaskResult;
  api: TaskListsApi;
  subjects: TagWithCountResult[];
  onShowRepeating: () => void;
}) {
  const today = api.today;
  const done = task.completedAt !== null;
  const subject = subjectOf(task);
  const plainTags = task.tags.filter((t) => !isSubjectTag(t));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-6">
        {/* Title */}
        <div className="flex items-start gap-2.5">
          <button
            type="button"
            role="checkbox"
            aria-checked={done}
            aria-label={done ? "Mark not done" : "Mark done"}
            onClick={() => api.toggle(task.id)}
            className={`-m-1 mt-0 flex-none rounded-full p-1 touch:-m-2.5 touch:p-2.5 ${SIDEBAR_FOCUS}`}
          >
            <span
              className={`flex h-[1.35rem] w-[1.35rem] items-center justify-center rounded-full border-[1.5px] ${
                done ? "border-transparent bg-sage" : "hover:bg-white/8"
              }`}
              style={
                !done
                  ? {
                      borderColor: subject
                        ? subjectColor(subject.color)
                        : "var(--color-ink-500)",
                    }
                  : undefined
              }
            >
              {done && (
                <Check className="h-3 w-3 text-sage-ink" strokeWidth={3} />
              )}
            </span>
          </button>
          <TitleField
            key={task.id}
            value={task.title}
            done={done}
            onCommit={(t) => api.rename(task.id, t)}
          />
          <span className="mt-0.5">
            <ImportantStar
              important={task.important}
              overdue={!done && task.due !== null && task.due < today}
              onToggle={(next) => api.setImportant(task.id, next)}
            />
          </span>
        </div>
        {task.noteTitle && (
          <p className="mt-1 pl-[2.1rem] text-[0.75rem] text-ink-500">
            from {task.noteTitle}
          </p>
        )}

        {/* Properties */}
        <div className={`${SECTION} mt-5`}>Properties</div>
        <div className="flex flex-col">
          <div className={PROP_ROW}>
            <span className={PROP_LABEL}>Due</span>
            <DuePicker task={task} today={today} api={api} />
          </div>
          <div className={PROP_ROW}>
            <span className={PROP_LABEL}>List</span>
            <SubjectPicker
              subject={subject}
              subjects={subjects}
              onPick={(s) => api.setSubject(task.id, s)}
              onCreate={async (name) => {
                const tag = await api.createSubject(name);
                if (tag) api.setSubject(task.id, tag);
              }}
            />
          </div>
          <div className={PROP_ROW}>
            <span className={PROP_LABEL}>Repeat</span>
            {task.recurring ? (
              <span className="flex min-w-0 flex-1 items-center gap-2 text-[0.875rem] text-ink-200">
                <span className="truncate">
                  {describeSchedule(task.recurring)}
                </span>
                <button
                  type="button"
                  onClick={onShowRepeating}
                  className={`flex-none rounded px-1 text-[0.8125rem] text-sage hover:underline ${SIDEBAR_FOCUS}`}
                >
                  Manage
                </button>
              </span>
            ) : (
              <span className="text-[0.875rem] text-ink-600">—</span>
            )}
          </div>
          <div className={PROP_ROW}>
            <span className={PROP_LABEL}>Tags</span>
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 py-1">
              {plainTags.length === 0 ? (
                <span className="text-[0.875rem] text-ink-600">—</span>
              ) : (
                plainTags.map((t) => (
                  <span key={t.id} className="text-[0.875rem] text-ink-200">
                    #{t.name}
                  </span>
                ))
              )}
              <TaskTagPicker
                taskId={task.id}
                tags={task.tags}
                allTags={api.allTags}
                onTagsChange={api.applyTags}
                onTagCreated={api.registerTag}
              />
            </span>
          </div>
          <div className={PROP_ROW}>
            <span className={PROP_LABEL}>Someday</span>
            <button
              type="button"
              role="switch"
              aria-checked={task.someday}
              aria-label="Someday"
              onClick={() => api.setSomeday(task.id, !task.someday)}
              className={`relative h-[1.2rem] w-[2.1rem] flex-none rounded-full transition-colors ${SIDEBAR_FOCUS} ${
                task.someday ? "bg-sage" : "bg-white/12"
              }`}
            >
              <span
                className={`absolute top-[0.15rem] h-[0.9rem] w-[0.9rem] rounded-full bg-white transition-[left] ${
                  task.someday ? "left-[1.05rem]" : "left-[0.15rem]"
                }`}
              />
            </button>
            {task.someday && (
              <Moon className="h-3.5 w-3.5 text-ink-500" aria-hidden />
            )}
          </div>
        </div>

        <Subtasks key={`s-${task.id}`} task={task} api={api} />

        {/* Notes */}
        <div className={`${SECTION} mt-5`}>Notes</div>
        <NotesField
          key={`n-${task.id}`}
          value={task.description ?? ""}
          onCommit={(v) => api.setDescription(task.id, v)}
        />

        <LinkedNotes key={`l-${task.id}-${task.noteId}`} taskId={task.id} />
      </div>

      {/* Footer actions */}
      <div className="flex flex-none items-center gap-2 border-t border-white/6 px-3 py-2">
        <button
          type="button"
          onClick={() => api.moveToTomorrow(task.id)}
          disabled={done || task.due === addDays(today, 1)}
          className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[0.8125rem] font-medium text-ink-200 hover:bg-white/6 disabled:opacity-40 touch:h-11 ${SIDEBAR_FOCUS}`}
        >
          <ArrowRight className="h-3.5 w-3.5" />
          Move to tomorrow
        </button>
        <DeleteButton key={task.id} onDelete={() => api.remove(task.id)} />
      </div>
    </div>
  );
}

function TitleField({
  value,
  done,
  onCommit,
}: {
  value: string;
  done: boolean;
  onCommit: (title: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  // Follow outside edits while not being typed in.
  useEffect(() => {
    if (document.activeElement !== ref.current) setDraft(value);
  }, [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={draft}
      aria-label="Task title"
      onChange={(e) => setDraft(e.target.value.replace(/\n/g, " "))}
      onBlur={() => {
        if (draft.trim()) onCommit(draft);
        else setDraft(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setDraft(value);
          requestAnimationFrame(() => ref.current?.blur());
        }
      }}
      className={`min-w-0 flex-1 resize-none overflow-hidden rounded-md bg-transparent text-[1.15rem] leading-snug font-semibold outline-none focus-visible:bg-white/4 ${
        done ? "text-ink-500 line-through" : "text-ink-100"
      }`}
    />
  );
}

/** Debounced (800ms) save of the task's own notes; blur saves at once. */
function NotesField({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ draft, onCommit });
  latest.current = { draft, onCommit };
  // Flush on unmount (task switched / panel closed) so nothing typed is lost.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        latest.current.onCommit(latest.current.draft);
      }
    },
    [],
  );
  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    onCommit(draft);
  };
  return (
    <textarea
      value={draft}
      aria-label="Notes"
      placeholder="Add notes…"
      rows={3}
      onChange={(e) => {
        const v = e.target.value;
        setDraft(v);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          latest.current.onCommit(v);
        }, 800);
      }}
      onBlur={flush}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          e.currentTarget.blur();
        }
      }}
      className="field-sizing-content min-h-[4.5rem] w-full resize-none rounded-lg border border-white/6 bg-panel px-3 py-2 text-[0.875rem] leading-relaxed text-ink-200 outline-none placeholder:text-ink-600 focus:border-sage/40"
    />
  );
}

function DuePicker({
  task,
  today,
  api,
}: {
  task: ListTaskResult;
  today: string;
  api: TaskListsApi;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  useOutsideClose(open, wrap, () => setOpen(false));
  const overdue =
    task.completedAt === null && task.due !== null && task.due < today;
  const label =
    task.due === null
      ? null
      : `${dayHeading(task.due, today)}${task.time ? `, ${formatTimeShort(task.time)}` : ""}`;
  const pick = (due: string | null) => {
    api.setDue(task.id, due);
  };
  const QUICK: [string, string][] = [
    ["Today", today],
    ["Tomorrow", addDays(today, 1)],
    ["Next week", addDays(today, 7)],
  ];
  return (
    <div ref={wrap} className="relative min-w-0 flex-1">
      <button
        type="button"
        aria-expanded={open}
        aria-label={label ? `Due ${label}. Change` : "Set a due date"}
        onClick={() => setOpen((o) => !o)}
        className={`${VALUE_BUTTON} ${
          label
            ? overdue
              ? task.important
                ? "text-overdue"
                : "text-overdue-calm"
              : "text-ink-100"
            : "text-ink-600"
        }`}
      >
        {label ?? "No date"}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Due date"
          className="absolute top-full right-0 z-40 mt-1 w-[16.5rem] rounded-xl border border-white/10 bg-panel p-2.5 shadow-2xl"
        >
          <div className="mb-2 flex flex-wrap gap-1.5">
            {QUICK.map(([name, day]) => (
              <button
                key={name}
                type="button"
                onClick={() => pick(day)}
                className={`rounded-md border px-2 py-1 text-[0.8125rem] touch:min-h-11 ${SIDEBAR_FOCUS} ${
                  task.due === day
                    ? "border-sage/40 bg-sage/14 text-sage"
                    : "border-white/10 text-ink-200 hover:bg-white/6"
                }`}
              >
                {name}
              </button>
            ))}
          </div>
          <label className="mb-1.5 flex items-center gap-2 text-[0.8125rem] text-ink-400">
            <span className="w-10">Date</span>
            <input
              type="date"
              value={task.due ?? ""}
              onChange={(e) => pick(e.target.value || null)}
              className="min-w-0 flex-1 rounded-md border border-white/10 bg-input px-2 py-1 text-[0.8125rem] text-ink-100 outline-none [color-scheme:dark]"
            />
          </label>
          <label className="flex items-center gap-2 text-[0.8125rem] text-ink-400">
            <span className="w-10">Time</span>
            <input
              type="time"
              value={task.time ?? ""}
              disabled={task.due === null}
              onChange={(e) => {
                const v = e.target.value;
                api.setTime(task.id, /^\d{2}:\d{2}$/.test(v) ? v : null);
              }}
              className="min-w-0 flex-1 rounded-md border border-white/10 bg-input px-2 py-1 text-[0.8125rem] text-ink-100 outline-none disabled:opacity-40 [color-scheme:dark]"
            />
          </label>
          <p className="mt-1.5 text-[0.75rem] text-ink-600">
            A time also reminds you then.
          </p>
          {task.due !== null && (
            <button
              type="button"
              onClick={() => {
                pick(null);
                setOpen(false);
              }}
              className={`mt-2 rounded px-1 text-[0.8125rem] text-ink-400 hover:text-ink-100 ${SIDEBAR_FOCUS}`}
            >
              Clear date
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SubjectPicker({
  subject,
  subjects,
  onPick,
  onCreate,
}: {
  subject: TagResult | null;
  subjects: TagWithCountResult[];
  onPick: (s: TagResult | null) => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  useOutsideClose(open, wrap, () => {
    setOpen(false);
    setNaming(null);
  });
  const choose = (s: TagResult | null) => {
    onPick(s);
    setOpen(false);
  };
  return (
    <div ref={wrap} className="relative min-w-0 flex-1">
      <button
        type="button"
        aria-expanded={open}
        aria-label={subject ? `List ${subject.name}. Change` : "Choose a list"}
        onClick={() => setOpen((o) => !o)}
        className={`${VALUE_BUTTON} ${subject ? "" : "text-ink-600"}`}
        style={subject ? { color: subjectColor(subject.color) } : undefined}
      >
        {subject?.name ?? "None"}
      </button>
      {open && (
        <div
          role="menu"
          aria-label="List"
          className="absolute top-full left-0 z-40 mt-1 max-h-72 w-56 overflow-y-auto rounded-xl border border-white/10 bg-panel p-1.5 shadow-2xl"
        >
          <MenuItem active={!subject} onClick={() => choose(null)}>
            <span className="h-2.5 w-2.5 rounded-[0.1875rem] border border-white/20" />
            None
          </MenuItem>
          {subjects.map((s) => (
            <MenuItem
              key={s.id}
              active={subject?.id === s.id}
              onClick={() => choose(s)}
            >
              <span
                className="h-2.5 w-2.5 rounded-[0.1875rem]"
                style={{ background: subjectColor(s.color) }}
              />
              {s.name}
            </MenuItem>
          ))}
          {naming === null ? (
            <MenuItem onClick={() => setNaming("")}>
              <Plus className="h-3 w-3" />
              New subject
            </MenuItem>
          ) : (
            <input
              autoFocus
              value={naming}
              aria-label="New subject name"
              placeholder="Subject name"
              onChange={(e) => setNaming(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const name = naming.trim();
                  setNaming(null);
                  setOpen(false);
                  if (name) void onCreate(name);
                } else if (e.key === "Escape") {
                  e.stopPropagation();
                  setNaming(null);
                }
              }}
              className="mt-1 w-full rounded-lg border border-white/10 bg-input px-2.5 py-1.5 text-[0.8125rem] text-ink-100 outline-none"
            />
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[0.8125rem] hover:bg-white/6 touch:min-h-11 ${SIDEBAR_FOCUS} ${
        active ? "text-sage" : "text-ink-200"
      }`}
    >
      {children}
    </button>
  );
}

/** Real subtasks (tasks.parent_id): one level, checkable, renamable. */
function Subtasks({ task, api }: { task: ListTaskResult; api: TaskListsApi }) {
  const [items, setItems] = useState<SubtaskResult[] | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    let live = true;
    listSubtasksAction(task.id)
      .then((rows) => {
        if (live) setItems(rows);
      })
      .catch((err) => {
        console.error("[tasks] subtasks load failed:", err);
        if (live) setItems([]);
      });
    return () => {
      live = false;
    };
  }, [task.id]);

  // The parent row's "1/3" follows the checklist.
  const sync = (next: SubtaskResult[]) => {
    setItems(next);
    api.patchLocal(task.id, {
      subtaskCount: next.length,
      subtaskDone: next.filter((s) => s.done).length,
    });
  };

  const toggle = (s: SubtaskResult) => {
    if (!items) return;
    const before = items;
    sync(items.map((x) => (x.id === s.id ? { ...x, done: !s.done } : x)));
    toggleTaskAction(s.id, !s.done).catch((err) => {
      console.error("[tasks] subtask toggle failed:", err);
      sync(before);
    });
  };
  const rename = (s: SubtaskResult, title: string) => {
    if (!items || !title.trim() || title.trim() === s.title) return;
    const before = items;
    sync(items.map((x) => (x.id === s.id ? { ...x, title: title.trim() } : x)));
    renameTaskAction(s.id, title).catch((err) => {
      console.error("[tasks] subtask rename failed:", err);
      sync(before);
    });
  };
  const remove = (s: SubtaskResult) => {
    if (!items) return;
    const before = items;
    sync(items.filter((x) => x.id !== s.id));
    deleteTaskAction(s.id).catch((err) => {
      console.error("[tasks] subtask delete failed:", err);
      sync(before);
    });
  };
  const add = async () => {
    const title = draft.trim();
    if (!title || !items) return;
    setDraft("");
    try {
      const row = await createSubtaskAction(task.id, title);
      if (row) sync([...(items ?? []), row]);
    } catch (err) {
      console.error("[tasks] subtask create failed:", err);
      setDraft(title);
    }
  };

  const doneCount = items?.filter((s) => s.done).length ?? task.subtaskDone;
  const total = items?.length ?? task.subtaskCount;

  return (
    <>
      <div className={`${SECTION} mt-5`}>
        Subtasks
        {total > 0 && (
          <span className="tabular-nums">
            · {doneCount} / {total}
          </span>
        )}
      </div>
      <div className="flex flex-col">
        {items?.map((s) => (
          <div
            key={s.id}
            className="group flex min-h-[2.3rem] items-center gap-2.5 border-b border-white/5 touch:min-h-[3.4rem]"
          >
            <button
              type="button"
              role="checkbox"
              aria-checked={s.done}
              aria-label={
                s.done ? `Reopen “${s.title}”` : `Complete “${s.title}”`
              }
              onClick={() => toggle(s)}
              className={`-m-1 flex-none rounded p-1 touch:-m-2.5 touch:p-2.5 ${SIDEBAR_FOCUS}`}
            >
              <span
                className={`flex h-[0.95rem] w-[0.95rem] items-center justify-center rounded-[0.25rem] border-[1.5px] ${
                  s.done
                    ? "border-transparent bg-sage"
                    : "border-ink-500 hover:bg-white/8"
                }`}
              >
                {s.done && (
                  <Check
                    className="h-2.5 w-2.5 text-sage-ink"
                    strokeWidth={3}
                  />
                )}
              </span>
            </button>
            <input
              defaultValue={s.title}
              aria-label="Subtask"
              onBlur={(e) => rename(s, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  e.stopPropagation();
                  e.currentTarget.value = s.title;
                  e.currentTarget.blur();
                }
              }}
              className={`min-w-0 flex-1 bg-transparent text-[0.875rem] outline-none ${
                s.done ? "text-ink-500 line-through" : "text-ink-200"
              }`}
            />
            <button
              type="button"
              aria-label={`Delete subtask “${s.title}”`}
              onClick={() => remove(s)}
              className={`flex h-6 w-6 flex-none items-center justify-center rounded text-ink-600 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-white/6 hover:text-ink-200 touch:h-11 touch:w-11 touch:opacity-100 ${SIDEBAR_FOCUS}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <div className="flex min-h-[2.3rem] items-center gap-2.5 touch:min-h-[3.4rem]">
          <Plus
            className="h-[0.95rem] w-[0.95rem] flex-none text-ink-600"
            aria-hidden
          />
          <input
            value={draft}
            disabled={items === null}
            aria-label="Add a subtask"
            placeholder="Add subtask"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              } else if (e.key === "Escape") {
                e.stopPropagation();
                setDraft("");
                e.currentTarget.blur();
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-[0.875rem] text-ink-200 outline-none placeholder:text-ink-600"
          />
        </div>
      </div>
    </>
  );
}

function LinkedNotes({ taskId }: { taskId: string }) {
  const [notes, setNotes] = useState<TaskNoteLink[] | null>(null);
  useEffect(() => {
    let live = true;
    loadNotesForTask(taskId)
      .then((rows) => {
        if (live) setNotes(rows);
      })
      .catch((err) => console.error("[tasks] linked notes failed:", err));
    return () => {
      live = false;
    };
  }, [taskId]);
  if (!notes || notes.length === 0) return null;
  return (
    <>
      <div className={`${SECTION} mt-5`}>
        Linked note{notes.length === 1 ? "" : "s"}
      </div>
      <div className="flex flex-col gap-1.5">
        {notes.map((n) => (
          <Link
            key={n.id}
            href={`/app/notes/${n.id}`}
            className={`flex min-h-[2.6rem] items-center gap-2.5 rounded-lg border border-white/8 bg-panel px-3 text-[0.875rem] text-ink-200 hover:border-white/14 hover:text-ink-100 touch:min-h-11 ${SIDEBAR_FOCUS}`}
          >
            <FileText className="h-4 w-4 flex-none text-sage" aria-hidden />
            <span className="truncate">{n.title || "Untitled"}</span>
          </Link>
        ))}
      </div>
    </>
  );
}

function DeleteButton({ onDelete }: { onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <button
      type="button"
      onClick={() => (confirming ? onDelete() : setConfirming(true))}
      onBlur={() => setConfirming(false)}
      className={`ml-auto flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[0.8125rem] font-medium hover:bg-white/6 touch:h-11 ${SIDEBAR_FOCUS} ${
        confirming ? "bg-overdue/12 text-overdue" : "text-ink-400"
      }`}
    >
      <Trash2 className="h-3.5 w-3.5" />
      {confirming ? "Delete task?" : "Delete"}
    </button>
  );
}
