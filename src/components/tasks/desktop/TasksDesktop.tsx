"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";

import type { ListTaskResult } from "@/app/app/tasks/actions";
import { PageLayout } from "@/components/layout/PageLayout";
import { SidebarIconButton } from "@/components/layout/sidebar";
import { useRecurringRules } from "@/components/tasks/RecurringRules";
import {
  describeRange,
  matchesTaskFilter,
  EMPTY_TASK_FILTER,
  type TaskTrait,
} from "@/components/tasks/TaskFilterRail";
import { usePersistentState } from "@/lib/hooks/use-persistent-state";
import { localDateString } from "@/lib/dates";
import {
  DEFAULT_VIEW,
  SMART_LIST_LABELS,
  groupTasks,
  inView,
  isSubjectTag,
  isTaskView,
  quickAddDefaults,
  smartListCounts,
  tagCounts as countTags,
  type TaskSort,
  type TaskView,
} from "@/lib/task-lists";

import { TaskDetails } from "./TaskDetails";
import { TaskListPane, toFilterable } from "./TaskListPane";
import { TaskListsSidebar } from "./TaskListsSidebar";
import { useTaskLists } from "./useTaskLists";

/**
 * Desktop/tablet Tasks page (Notes Sidebars design §5b): Sidebar 1 "TASKS"
 * (smart lists, subject LISTS, TAGS, Folders, Workload), the list in the
 * content column, and Sidebar 2 "DETAILS" on the right, open while a task is
 * selected (closing it deselects). The phone keeps `TasksPhone`.
 */

const SORTS: TaskSort[] = ["default", "due", "title", "newest", "oldest"];
const isSort = (v: unknown): v is TaskSort => SORTS.includes(v as TaskSort);

export function TasksDesktop({ cacheScope }: { cacheScope: string }) {
  const api = useTaskLists(cacheScope);
  const { today, tasks, allTags } = api;

  const [view, setViewRaw] = usePersistentState<TaskView>(
    "agenda.tasks.view",
    DEFAULT_VIEW,
    isTaskView,
  );
  const [sort, setSort] = usePersistentState<TaskSort>(
    "agenda.tasks.sort",
    "default",
    isSort,
  );
  const [traits, setTraits] = useState<TaskTrait[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const quickAddRef = useRef<HTMLInputElement | null>(null);

  const recurring = useRecurringRules({ today, onTasksChanged: api.refetch });

  const isLogbook = view.kind === "smart" && view.id === "logbook";
  const { loadLogbook } = api;
  useEffect(() => {
    if (isLogbook) loadLogbook();
    // Load once per visit to the Logbook; later changes refetch via events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLogbook]);

  // ---- derived lists --------------------------------------------------------
  const openTasks = useMemo(
    () => tasks.filter((t) => t.completedAt === null),
    [tasks],
  );
  const subjects = allTags.filter(isSubjectTag);
  const plainTags = allTags.filter((t) => !isSubjectTag(t));
  const counts = useMemo(() => countTags(openTasks), [openTasks]);
  const smartCounts = useMemo(
    () => (today ? smartListCounts(openTasks, today) : {}),
    [openTasks, today],
  );
  const folders = useMemo(() => {
    const map = new Map<string, { color: string | null; count: number }>();
    for (const t of openTasks) {
      if (!t.boardTitle) continue;
      const f = map.get(t.boardTitle);
      if (f) f.count += 1;
      else map.set(t.boardTitle, { color: t.boardColor, count: 1 });
    }
    return [...map]
      .map(([title, f]) => ({ title, ...f }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [openTasks]);

  // A view whose subject/tag/folder vanished falls back to Today.
  const viewValid =
    view.kind === "subject" || view.kind === "tag"
      ? allTags.length === 0 || allTags.some((t) => t.id === view.id)
      : view.kind === "folder"
        ? api.loading || folders.some((f) => f.title === view.title)
        : true;
  const effectiveView: TaskView = viewValid ? view : DEFAULT_VIEW;

  // Rows of the view before traits (the filter's faceted base). Completed
  // rows stay visible for the session in the list they were ticked in.
  const baseRows: ListTaskResult[] = useMemo(() => {
    if (!today) return [];
    if (effectiveView.kind === "smart" && effectiveView.id === "logbook") {
      return api.logbook ?? [];
    }
    if (effectiveView.kind === "smart" && effectiveView.id === "repeating") {
      return [];
    }
    return tasks.filter((t) => inView(t, effectiveView, today));
  }, [tasks, api.logbook, effectiveView, today]);
  const shownRows = useMemo(
    () =>
      traits.length === 0
        ? baseRows
        : baseRows.filter((t) =>
            matchesTaskFilter(
              toFilterable(t),
              { ...EMPTY_TASK_FILTER, traits },
              today,
            ),
          ),
    [baseRows, traits, today],
  );
  const groups = useMemo(
    () =>
      groupTasks(shownRows, effectiveView, today, sort, (iso) =>
        localDateString(new Date(iso)),
      ),
    [shownRows, effectiveView, today, sort],
  );
  const openCount = shownRows.filter(
    (t) => isLogbook || t.completedAt === null,
  ).length;

  const title = (() => {
    switch (effectiveView.kind) {
      case "smart":
        return SMART_LIST_LABELS[effectiveView.id];
      case "subject":
      case "tag": {
        const tag = allTags.find((t) => t.id === effectiveView.id);
        if (!tag) return "List";
        return effectiveView.kind === "tag" ? `#${tag.name}` : tag.name;
      }
      case "folder":
        return effectiveView.title;
      case "range":
        // The strip's "!" bucket has no floor: everything late.
        return effectiveView.start === null
          ? `Overdue · ${describeRange(effectiveView)}`
          : describeRange(effectiveView);
    }
  })();

  const defaults = today ? quickAddDefaults(effectiveView, today) : null;
  const quickAddPlaceholder =
    defaults === null
      ? null
      : `New task${
          effectiveView.kind === "smart" && effectiveView.id === "today"
            ? " for today"
            : effectiveView.kind === "smart" && effectiveView.id === "upcoming"
              ? " for tomorrow"
              : effectiveView.kind === "subject" || effectiveView.kind === "tag"
                ? ` in ${title}`
                : ""
        } — #tag to label it, ! if it matters`;

  const emptyText =
    effectiveView.kind === "smart"
      ? {
          inbox: "Inbox zero. New, undated, untagged tasks land here.",
          today: "Nothing due today.",
          upcoming: "Nothing scheduled ahead.",
          anytime: "No undated tasks.",
          someday: "Nothing parked for someday.",
          logbook: api.logbook === null ? "Loading…" : "Nothing completed yet.",
          repeating: "",
        }[effectiveView.id]
      : traits.length > 0
        ? "No tasks here match the filter."
        : "No open tasks here.";

  // ---- selection --------------------------------------------------------------
  const allRows = isLogbook ? (api.logbook ?? []) : tasks;
  const selected =
    selectedId !== null
      ? (allRows.find((t) => t.id === selectedId) ??
        tasks.find((t) => t.id === selectedId) ??
        null)
      : null;
  // A deleted (or refetched-away) task closes its details.
  useEffect(() => {
    if (selectedId !== null && !selected && !api.loading) setSelectedId(null);
  }, [selectedId, selected, api.loading]);

  const setView = (next: TaskView) => {
    setViewRaw(next);
    setTraits([]);
    setSelectedId(null);
  };

  // Esc anywhere outside a field closes the details.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable=true]")) return;
      // An open menu/popover (its trigger is aria-expanded) takes this Esc.
      // Collapsible sections are aria-expanded too, but name aria-controls.
      if (document.querySelector('[aria-expanded="true"]:not([aria-controls])'))
        return;
      setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const focusQuickAdd = () => {
    if (defaults === null) setView({ kind: "smart", id: "inbox" });
    setTimeout(() => quickAddRef.current?.focus(), 0);
  };

  const onQuickAdd = async (text: string) => {
    if (!defaults) return false;
    const row = await api.create(text, defaults);
    return row !== null;
  };

  const repeating = { kind: "smart", id: "repeating" } as const;

  return (
    <PageLayout
      pageKey="tasks"
      sidebar1={{
        label: "Tasks",
        defaultWidth: 19,
        minWidth: 14,
        maxWidth: 30,
        actions: (
          <SidebarIconButton
            icon={Plus}
            label="New task"
            onClick={focusQuickAdd}
          />
        ),
        children: (
          <TaskListsSidebar
            view={effectiveView}
            onView={setView}
            smartCounts={smartCounts}
            repeatingCount={
              recurring.rulesLoading ? null : recurring.rules.length
            }
            subjects={subjects}
            plainTags={plainTags}
            tagCounts={counts}
            folders={folders}
            workloadTasks={openTasks.map(toFilterable)}
            today={today}
          />
        ),
      }}
      sidebar2={{
        label: "Details",
        defaultWidth: 23,
        minWidth: 19,
        maxWidth: 34,
        open: selected !== null,
        onOpenChange: (open) => {
          if (!open) setSelectedId(null);
          else {
            const first = groups[0]?.tasks[0];
            if (first) setSelectedId(first.id);
          }
        },
        children: selected ? (
          <TaskDetails
            task={selected}
            api={api}
            subjects={subjects}
            onShowRepeating={() => setView(repeating)}
          />
        ) : (
          <p className="px-4 py-6 text-[0.875rem] text-ink-500">
            Select a task to see its details.
          </p>
        ),
      }}
      sidebar2Position="right"
    >
      <TaskListPane
        api={api}
        view={effectiveView}
        title={title}
        groups={groups}
        count={openCount}
        traitBase={baseRows}
        traits={traits}
        onTraitsChange={setTraits}
        sort={sort}
        onSortChange={setSort}
        selectedId={selected?.id ?? null}
        onSelect={setSelectedId}
        onCloseDetails={() => setSelectedId(null)}
        quickAdd={quickAddPlaceholder}
        quickAddRef={quickAddRef}
        onQuickAdd={onQuickAdd}
        recurring={recurring}
        emptyText={emptyText}
      />
    </PageLayout>
  );
}
