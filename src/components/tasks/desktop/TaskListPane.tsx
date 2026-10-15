"use client";

import { forwardRef, useRef, useState } from "react";
import {
  ArrowUpDown,
  Check,
  ListChecks,
  ListFilter,
  Plus,
  Repeat,
} from "lucide-react";

import type { ListTaskResult } from "@/app/app/tasks/actions";
import { SidebarToggles } from "@/components/layout/PageLayout";
import { SidebarIconButton, SIDEBAR_FOCUS } from "@/components/layout/sidebar";
import { ImportantStar, overdueTone } from "@/components/tasks/ImportantStar";
import {
  RecurringRulesSections,
  type RecurringRulesApi,
} from "@/components/tasks/RecurringRules";
import {
  TraitChips,
  type FilterableTask,
  type TaskTrait,
} from "@/components/tasks/TaskFilterRail";
import { TaskNotesPicker } from "@/components/tasks/TaskNotesPicker";
import { TaskTagPicker } from "@/components/tasks/TaskTagPicker";
import { useOutsideClose } from "@/lib/hooks/use-outside-close";
import { formatTimeShort } from "@/lib/recurrence";
import { subjectColor } from "@/lib/subjects";
import {
  SORT_LABELS,
  dueLabel,
  subjectOf,
  type ListGroup,
  type TaskSort,
  type TaskView,
} from "@/lib/task-lists";

import type { TaskListsApi } from "./useTaskLists";

/**
 * The Tasks page's content column (design 5b): a 42px header with the list's
 * title + count and the sort / filter / details toggles, the quick-add, and
 * the list itself — 30px rows grouped where it helps. The "Repeating" smart
 * list swaps the rows for the recurring-rules editor.
 */

const GROUP_LABEL =
  "flex h-[2.25rem] items-end px-4 pb-1.5 text-[0.6875rem] font-semibold tracking-[0.1em] uppercase";

export function toFilterable(t: ListTaskResult): FilterableTask {
  return {
    due: t.due,
    important: t.important,
    boardTitle: t.boardTitle,
    recurring: t.recurring,
    remindAt: t.time,
    noteId: t.noteId,
    tags: t.tags,
  };
}

export function TaskListPane({
  api,
  view,
  title,
  groups,
  count,
  traitBase,
  traits,
  onTraitsChange,
  sort,
  onSortChange,
  selectedId,
  onSelect,
  onCloseDetails,
  quickAdd,
  quickAddRef,
  onQuickAdd,
  recurring,
  emptyText,
}: {
  api: TaskListsApi;
  view: TaskView;
  title: string;
  groups: ListGroup<ListTaskResult>[];
  count: number;
  /** The view's rows before traits apply — the filter chips' counts. */
  traitBase: ListTaskResult[];
  traits: TaskTrait[];
  onTraitsChange: (next: TaskTrait[]) => void;
  sort: TaskSort;
  onSortChange: (next: TaskSort) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCloseDetails: () => void;
  /** Placeholder for the quick-add, or null when this view has none. */
  quickAdd: string | null;
  quickAddRef: React.RefObject<HTMLInputElement | null>;
  onQuickAdd: (title: string) => Promise<boolean>;
  recurring: RecurringRulesApi;
  emptyText: string;
}) {
  const isRepeating = view.kind === "smart" && view.id === "repeating";
  const isLogbook = view.kind === "smart" && view.id === "logbook";
  const today = api.today;
  const rows = groups.flatMap((g) => g.tasks);
  const listRef = useRef<HTMLDivElement | null>(null);

  const subtitle = isRepeating
    ? `${recurring.rules.length} rule${recurring.rules.length === 1 ? "" : "s"}`
    : api.loading
      ? "Loading…"
      : `${count} task${count === 1 ? "" : "s"}${
          traits.length > 0 ? " · filtered" : ""
        }`;

  /** ↑/↓ move the selection; Enter/Space toggle; Esc closes details. */
  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, [role=dialog]")) return;
    const onRow = target.getAttribute("role") === "option";
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (rows.length === 0) return;
      e.preventDefault();
      const i = rows.findIndex((t) => t.id === selectedId);
      const next =
        i === -1
          ? e.key === "ArrowDown"
            ? 0
            : rows.length - 1
          : Math.min(
              rows.length - 1,
              Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)),
            );
      const id = rows[next].id;
      onSelect(id);
      listRef.current
        ?.querySelector<HTMLElement>(`[data-task-id="${id}"]`)
        ?.focus();
    } else if ((e.key === "Enter" || e.key === " ") && onRow) {
      e.preventDefault();
      const id = target.dataset.taskId;
      if (id) api.toggle(id);
    } else if (e.key === "Escape" && selectedId) {
      e.preventDefault();
      onCloseDetails();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      {/* Header — same 42px as the sidebars' */}
      <div className="flex h-[3.25rem] flex-none items-center gap-2 border-b border-white/6 pr-2 pl-2 touch:h-[3.75rem]">
        <SidebarToggles />
        <div className="flex min-w-0 flex-1 flex-col justify-center pl-2 leading-tight">
          <h1 className="truncate text-[1.15rem] font-semibold text-ink-100">
            {title}
          </h1>
          <span className="truncate text-[0.75rem] text-ink-500">
            {subtitle}
          </span>
        </div>
        {!isRepeating && (
          <>
            <SortMenu sort={sort} onChange={onSortChange} />
            <FilterMenu
              tasks={traitBase}
              today={today}
              traits={traits}
              onChange={onTraitsChange}
            />
          </>
        )}
        <SidebarToggles side="right" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isRepeating ? (
          <div className="mx-auto w-full max-w-[52rem] px-5 pt-5">
            <RecurringRulesSections
              api={recurring}
              hint="pick a schedule — each occurrence lands in Today on its day"
            />
          </div>
        ) : (
          <>
            {quickAdd !== null && (
              <QuickAdd
                ref={quickAddRef}
                placeholder={quickAdd}
                onSubmit={onQuickAdd}
              />
            )}
            {api.loading && rows.length === 0 ? (
              <RowsSkeleton />
            ) : rows.length === 0 ? (
              <p className="px-5 py-6 text-[0.875rem] text-ink-500">
                {emptyText}
              </p>
            ) : (
              <div
                ref={listRef}
                role="listbox"
                aria-label={`${title} tasks`}
                onKeyDown={onListKeyDown}
                className="pb-8"
              >
                {groups.map((group) => (
                  <div
                    key={group.key}
                    role="group"
                    aria-label={group.label ?? title}
                  >
                    {group.label && (
                      <div
                        className={`${GROUP_LABEL} ${
                          group.tone === "overdue"
                            ? "text-overdue"
                            : group.tone === "calm"
                              ? "text-overdue-calm"
                              : "text-ink-500"
                        }`}
                      >
                        {group.label}
                      </div>
                    )}
                    {group.tasks.map((task, i) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        api={api}
                        view={view}
                        selected={task.id === selectedId}
                        // Roving tabindex: the selection, else the first row.
                        tabbable={
                          selectedId
                            ? task.id === selectedId
                            : group === groups[0] && i === 0
                        }
                        onSelect={onSelect}
                      />
                    ))}
                  </div>
                ))}
                {isLogbook &&
                  api.logbook !== null &&
                  api.logbook.length >= api.logbookLimit && (
                    <button
                      type="button"
                      onClick={api.showMoreLogbook}
                      className={`mx-4 mt-3 rounded-md px-2 py-1.5 text-[0.8125rem] font-medium text-sage hover:bg-white/4 ${SIDEBAR_FOCUS}`}
                    >
                      Show more
                    </button>
                  )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** One ~30px row: subject-tinted round checkbox, title (+ "from <note>"),
 *  hover affordances, and the subject / time / due on the right. */
function TaskRow({
  task,
  api,
  view,
  selected,
  tabbable,
  onSelect,
}: {
  task: ListTaskResult;
  api: TaskListsApi;
  view: TaskView;
  selected: boolean;
  tabbable: boolean;
  onSelect: (id: string) => void;
}) {
  const today = api.today;
  const done = task.completedAt !== null;
  const subject = subjectOf(task);
  const ring = subject ? subjectColor(subject.color) : null;
  const overdue = !done && task.due !== null && task.due < today;
  const inToday = view.kind === "smart" && view.id === "today";
  const inUpcoming = view.kind === "smart" && view.id === "upcoming";
  const inSubject = view.kind === "subject" && subject?.id === view.id;

  // Right side: the time on Today/Upcoming (the group already says the day),
  // otherwise the due day (+ time); a late row's date takes the overdue tone.
  const timeText = task.time ? formatTimeShort(task.time) : null;
  let whenText: string | null = null;
  if (done) {
    whenText = task.completedAt
      ? new Date(task.completedAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })
      : null;
  } else if (task.due !== null) {
    if ((inToday && !overdue) || inUpcoming) whenText = timeText;
    else
      whenText = `${dueLabel(task.due, today)}${timeText ? ` · ${timeText}` : ""}`;
  }

  const subline = [task.noteTitle ? `from ${task.noteTitle}` : null].filter(
    Boolean,
  );

  return (
    <div
      role="option"
      aria-selected={selected}
      aria-label={task.title}
      data-task-id={task.id}
      tabIndex={tabbable ? 0 : -1}
      onClick={() => onSelect(task.id)}
      className={`group relative flex w-full cursor-default items-center gap-3 border-b border-white/5 pr-4 pl-4 text-left transition-colors ${
        subline.length > 0 ? "min-h-[2.9rem] py-1" : "min-h-[2.3rem]"
      } touch:min-h-[3.4rem] ${SIDEBAR_FOCUS} ${
        selected ? "bg-sage/10" : "hover:bg-white/3"
      }`}
    >
      {selected && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[2px] bg-sage"
        />
      )}
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={
          done ? `Mark “${task.title}” not done` : `Complete “${task.title}”`
        }
        onClick={(e) => {
          e.stopPropagation();
          api.toggle(task.id);
        }}
        className="-m-1.5 flex flex-none items-center justify-center p-1.5 touch:-m-3 touch:p-3"
      >
        <span
          className={`flex h-[1.05rem] w-[1.05rem] items-center justify-center rounded-full border-[1.5px] transition-colors ${
            done ? "border-transparent bg-sage" : "hover:bg-white/8"
          }`}
          style={
            !done ? { borderColor: ring ?? "var(--color-ink-500)" } : undefined
          }
        >
          {done && (
            <Check className="h-2.5 w-2.5 text-sage-ink" strokeWidth={3} />
          )}
        </span>
      </button>

      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={`truncate text-[0.9375rem] leading-snug ${
            done ? "text-ink-500 line-through" : "text-ink-100"
          }`}
        >
          {task.title}
        </span>
        {subline.length > 0 && (
          <span className="truncate text-[0.75rem] leading-tight text-ink-500">
            {subline.join(" · ")}
          </span>
        )}
      </span>

      {/* Inline affordances — on hover/focus, or while selected. */}
      <span
        className={`flex flex-none items-center gap-0.5 ${
          selected
            ? "opacity-100"
            : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <TaskTagPicker
          taskId={task.id}
          tags={task.tags}
          allTags={api.allTags}
          onTagsChange={api.applyTags}
          onTagCreated={api.registerTag}
        />
        <TaskNotesPicker
          taskId={task.id}
          currentNoteId={task.noteId}
          onRemovedFromCurrentNote={
            task.noteId
              ? () => api.noteRemoved(task.id, task.noteId!)
              : undefined
          }
        />
      </span>
      {/* The star stays visible once lit — it's state, not an affordance. */}
      <span
        className={`flex-none ${
          task.important || selected
            ? ""
            : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <ImportantStar
          important={task.important}
          overdue={overdue}
          onToggle={(next) => api.setImportant(task.id, next)}
        />
      </span>

      {(task.subtaskCount > 0 || task.recurring) && (
        <span className="flex flex-none items-center gap-2 text-[0.75rem] text-ink-500">
          {task.recurring && (
            <Repeat className="h-3 w-3" aria-label="Repeats" />
          )}
          {task.subtaskCount > 0 && (
            <span className="flex items-center gap-1 tabular-nums">
              <ListChecks className="h-3 w-3" aria-hidden />
              {task.subtaskDone}/{task.subtaskCount}
            </span>
          )}
        </span>
      )}
      {subject && !inSubject && (
        <span
          className="max-w-[8rem] flex-none truncate text-[0.8125rem]"
          style={{ color: subjectColor(subject.color) }}
        >
          {subject.name}
        </span>
      )}
      {whenText && (
        <span
          className={`flex-none font-mono text-[0.75rem] tabular-nums ${
            overdueTone(overdue, task.important) ?? "text-ink-500"
          }`}
        >
          {whenText}
        </span>
      )}
    </div>
  );
}

const QuickAdd = forwardRef<
  HTMLInputElement,
  { placeholder: string; onSubmit: (title: string) => Promise<boolean> }
>(function QuickAdd({ placeholder, onSubmit }, ref) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setDraft("");
    const ok = await onSubmit(text);
    if (!ok) setDraft(text);
    setBusy(false);
  };
  return (
    <div className="flex min-h-[2.6rem] items-center gap-3 border-b border-white/5 px-4 touch:min-h-[3.4rem]">
      <Plus
        className="h-[1.05rem] w-[1.05rem] flex-none text-ink-500"
        aria-hidden
      />
      <input
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            setDraft("");
            e.currentTarget.blur();
          }
        }}
        aria-label="New task"
        placeholder={placeholder}
        className="h-full min-w-0 flex-1 bg-transparent py-2 text-[0.9375rem] text-ink-100 outline-none placeholder:text-ink-600"
      />
    </div>
  );
});

function SortMenu({
  sort,
  onChange,
}: {
  sort: TaskSort;
  onChange: (next: TaskSort) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  useOutsideClose(open, wrap, () => setOpen(false));
  return (
    <div ref={wrap} className="relative">
      <SidebarIconButton
        icon={ArrowUpDown}
        label={`Sort: ${SORT_LABELS[sort]}`}
        active={sort !== "default"}
        expanded={open}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div
          role="menu"
          aria-label="Sort tasks"
          className="absolute top-full right-0 z-40 mt-1.5 w-44 rounded-xl border border-white/10 bg-panel p-1.5 shadow-2xl"
        >
          {(Object.keys(SORT_LABELS) as TaskSort[]).map((s) => (
            <button
              key={s}
              type="button"
              role="menuitemradio"
              aria-checked={sort === s}
              onClick={() => {
                onChange(s);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[0.8125rem] hover:bg-white/6 touch:min-h-11 ${SIDEBAR_FOCUS} ${
                sort === s ? "text-sage" : "text-ink-200"
              }`}
            >
              <Check
                className={`h-3.5 w-3.5 flex-none ${sort === s ? "" : "opacity-0"}`}
              />
              {SORT_LABELS[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterMenu({
  tasks,
  today,
  traits,
  onChange,
}: {
  tasks: ListTaskResult[];
  today: string;
  traits: TaskTrait[];
  onChange: (next: TaskTrait[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  useOutsideClose(open, wrap, () => setOpen(false));
  return (
    <div ref={wrap} className="relative">
      <SidebarIconButton
        icon={ListFilter}
        label={traits.length > 0 ? `Filter (${traits.length} on)` : "Filter"}
        active={traits.length > 0}
        expanded={open}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div
          role="dialog"
          aria-label="Filter tasks"
          className="absolute top-full right-0 z-40 mt-1.5 w-[18rem] rounded-xl border border-white/10 bg-panel p-3 shadow-2xl"
        >
          <div className="mb-2 flex items-center">
            <span className="flex-1 text-[0.6875rem] font-semibold tracking-[0.1em] text-ink-500 uppercase">
              Traits
            </span>
            {traits.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className={`rounded px-1 text-[0.75rem] text-ink-400 hover:text-ink-100 ${SIDEBAR_FOCUS}`}
              >
                Clear
              </button>
            )}
          </div>
          <TraitChips
            tasks={tasks.map(toFilterable)}
            today={today}
            traits={traits}
            onChange={onChange}
          />
        </div>
      )}
    </div>
  );
}

function RowsSkeleton() {
  return (
    <div className="flex animate-pulse flex-col">
      {[72, 54, 64, 40, 58].map((w, i) => (
        <div
          key={i}
          className="flex h-[2.3rem] items-center gap-3 border-b border-white/5 px-4"
        >
          <span className="h-[1.05rem] w-[1.05rem] rounded-full bg-white/7" />
          <span className="h-3 rounded bg-white/7" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}
