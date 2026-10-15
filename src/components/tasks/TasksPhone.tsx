"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Hash,
  Inbox,
  Layers,
  ListChecks,
  MoreHorizontal,
  Moon,
  Plus,
  Repeat,
  Search,
  Star,
  Sun,
  type LucideIcon,
} from "lucide-react";

import type { ListTaskResult } from "@/app/app/tasks/actions";
import { BottomSheet } from "@/components/layout/BottomSheet";
import { overdueTone } from "@/components/tasks/ImportantStar";
import {
  RecurringRulesSections,
  useRecurringRules,
} from "@/components/tasks/RecurringRules";
import {
  describeRange,
  matchesTaskFilter,
  EMPTY_TASK_FILTER,
  TraitChips,
  WorkloadStrip,
  type DayRange,
  type TaskTrait,
} from "@/components/tasks/TaskFilterRail";
import { TaskDetails } from "@/components/tasks/desktop/TaskDetails";
import { toFilterable } from "@/components/tasks/desktop/TaskListPane";
import {
  useTaskLists,
  type TaskListsApi,
} from "@/components/tasks/desktop/useTaskLists";
import { localDateString } from "@/lib/dates";
import { usePersistentState } from "@/lib/hooks/use-persistent-state";
import { formatTimeShort } from "@/lib/recurrence";
import { subjectColor } from "@/lib/subjects";
import {
  SMART_LIST_LABELS,
  SORT_LABELS,
  dueLabel,
  groupTasks,
  inView,
  isSubjectTag,
  isTaskView,
  quickAddDefaults,
  smartListCounts,
  subjectOf,
  tagCounts as countTags,
  type ListGroup,
  type SmartListId,
  type TaskSort,
  type TaskView,
} from "@/lib/task-lists";

/**
 * The Tasks page on a phone (Notes Sidebars design §6h/§6i): the LISTS are
 * the first screen (smart lists, subject lists, tags), tapping one goes INTO
 * it (grouped rows + quick-add), and tapping a task opens the same Details
 * panel the tablet shows, as a bottom sheet. State is the desktop's
 * `useTaskLists`; the list rules are `src/lib/task-lists.ts`.
 *
 * The open list lives in the URL hash (`#list=smart:today`, `subject:<id>`, …) so reload
 * and the browser's back/forward behave: opening a list pushes one history
 * entry, back returns to the lists screen.
 *
 * What the old phone page had that has moved: the All/Today/Recurring chips
 * are the Today and Repeating lists; Unscheduled is Anytime; Recently added
 * is Anytime/Inbox sorted "Newest first" (⋯ → Sort); the folder chip is the
 * FOLDERS section; the workload strip is the collapsible WORKLOAD section;
 * the Recurring tasks + Rules editors are the Repeating list; trait filters
 * are in the list's ⋯ sheet.
 */

const SORTS: TaskSort[] = ["default", "due", "title", "newest", "oldest"];
const isSort = (v: unknown): v is TaskSort => SORTS.includes(v as TaskSort);

const SMART_ICONS: Record<SmartListId, LucideIcon> = {
  inbox: Inbox,
  today: Sun,
  upcoming: CalendarDays,
  anytime: Layers,
  someday: Moon,
  logbook: CircleCheck,
  repeating: Repeat,
};

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-sage/60 focus-visible:ring-inset";
const HEADER_BTN = `flex h-11 w-11 items-center justify-center rounded-full text-ink-300 active:bg-white/8 ${FOCUS}`;
const SECTION_LABEL =
  "px-5 pt-5 pb-1.5 text-[0.6875rem] font-semibold tracking-[0.1em] text-ink-500 uppercase";

// ---- the open list in the URL ------------------------------------------------

function encodeView(v: TaskView): string {
  switch (v.kind) {
    case "smart":
      return `smart:${v.id}`;
    case "subject":
    case "tag":
      return `${v.kind}:${v.id}`;
    case "folder":
      return `folder:${v.title}`;
    case "range":
      return `range:${v.start ?? "late"}:${v.end}`;
  }
}

function decodeView(raw: string | null): TaskView | null {
  if (!raw) return null;
  const i = raw.indexOf(":");
  if (i < 0) {
    // Bare smart-list id (`?list=today`).
    const bare: TaskView = { kind: "smart", id: raw as SmartListId };
    return isTaskView(bare) ? bare : null;
  }
  const kind = raw.slice(0, i);
  const rest = raw.slice(i + 1);
  let view: unknown = null;
  if (kind === "smart") view = { kind, id: rest };
  else if (kind === "subject" || kind === "tag") view = { kind, id: rest };
  else if (kind === "folder") view = { kind, title: rest };
  else if (kind === "range") {
    const [start, end] = rest.split(":");
    view = { kind, start: start === "late" ? null : start, end };
  }
  return isTaskView(view) ? view : null;
}

const LIST_PATH = "/app/tasks";

/**
 * The open list rides in the URL HASH (`#list=smart%3Atoday`), not the query:
 * a query change re-keys the page segment, so Next would remount the page and
 * reload every list on each tap. A hash change leaves the tree alone.
 */
const hashFor = (v: TaskView) => `#list=${encodeURIComponent(encodeView(v))}`;

function readHashView(): TaskView | null {
  if (typeof window === "undefined") return null;
  return decodeView(
    new URLSearchParams(window.location.hash.slice(1)).get("list"),
  );
}

// ---- the page ------------------------------------------------------------------

type Sheet = "new" | "options" | null;

export function TasksPhone({ cacheScope }: { cacheScope: string }) {
  const api = useTaskLists(cacheScope);
  const { today, tasks, allTags } = api;

  // The URL is the source of truth: our own pushes, the browser's back and
  // forward, and Next's navigations (tapping the Tasks tab again drops the
  // hash) all land here. `useSearchParams` re-renders on any canonical-URL
  // change, which is the only signal Next gives for a hash-only navigation.
  const [view, setView] = useState<TaskView | null>(readHashView);
  const urlParams = useSearchParams();
  useEffect(() => {
    const sync = () => setView(readHashView());
    sync();
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
    };
  }, [urlParams]);

  const [sort, setSort] = usePersistentState<TaskSort>(
    "agenda.tasks.sort",
    "default",
    isSort,
  );
  const [traits, setTraits] = useState<TaskTrait[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const quickAddRef = useRef<HTMLInputElement | null>(null);

  const recurring = useRecurringRules({ today, onTasksChanged: api.refetch });

  const viewKey = view ? encodeView(view) : "";
  useEffect(() => {
    // A different list starts unfiltered, with no sheet open.
    setTraits([]);
    setSheet(null);
    setSelectedId(null);
  }, [viewKey]);

  const isLogbook = view?.kind === "smart" && view.id === "logbook";
  const { loadLogbook } = api;
  useEffect(() => {
    if (isLogbook) loadLogbook();
    // Load once per visit to the Logbook; later changes refetch via events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLogbook]);

  // ---- derived lists (same cuts as the desktop page) ---------------------------
  const openTasks = useMemo(
    () => tasks.filter((t) => t.completedAt === null),
    [tasks],
  );
  const subjects = allTags.filter(isSubjectTag);
  const plainTags = allTags.filter((t) => !isSubjectTag(t));
  const counts = useMemo(() => countTags(openTasks), [openTasks]);
  const smartCounts = useMemo(
    () => (today ? smartListCounts(openTasks, today) : null),
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

  // A list whose subject/tag/folder vanished falls back to the lists screen.
  const viewValid =
    view === null
      ? true
      : view.kind === "subject" || view.kind === "tag"
        ? allTags.length === 0 || allTags.some((t) => t.id === view.id)
        : view.kind === "folder"
          ? api.loading || folders.some((f) => f.title === view.title)
          : true;
  const effectiveView: TaskView | null = viewValid ? view : null;

  const baseRows: ListTaskResult[] = useMemo(() => {
    if (!today || !effectiveView) return [];
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
      effectiveView
        ? groupTasks(shownRows, effectiveView, today, sort, (iso) =>
            localDateString(new Date(iso)),
          )
        : [],
    [shownRows, effectiveView, today, sort],
  );
  const openCount = shownRows.filter(
    (t) => isLogbook || t.completedAt === null,
  ).length;

  const title = (() => {
    if (!effectiveView) return "Tasks";
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
        return effectiveView.start === null
          ? `Overdue · ${describeRange(effectiveView)}`
          : describeRange(effectiveView);
    }
  })();

  const defaults =
    today && effectiveView ? quickAddDefaults(effectiveView, today) : null;
  const quickAddPlaceholder =
    defaults === null || !effectiveView
      ? null
      : `New task${
          effectiveView.kind === "smart" && effectiveView.id === "today"
            ? " for today"
            : effectiveView.kind === "smart" && effectiveView.id === "upcoming"
              ? " for tomorrow"
              : effectiveView.kind === "subject" || effectiveView.kind === "tag"
                ? ` in ${title}`
                : ""
        }`;

  const emptyText =
    effectiveView?.kind === "smart"
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

  // ---- selection -----------------------------------------------------------------
  const allRows = isLogbook ? (api.logbook ?? []) : tasks;
  const selected =
    selectedId !== null
      ? (allRows.find((t) => t.id === selectedId) ??
        tasks.find((t) => t.id === selectedId) ??
        null)
      : null;
  // A deleted (or refetched-away) task closes its sheet.
  useEffect(() => {
    if (selectedId !== null && !selected && !api.loading) setSelectedId(null);
  }, [selectedId, selected, api.loading]);

  // Stable: BottomSheet re-runs its focus effect whenever `onClose` changes,
  // which would yank focus out of a field on every parent render.
  const closeDetails = useCallback(() => setSelectedId(null), []);
  const closeSheet = useCallback(() => setSheet(null), []);

  const openList = (next: TaskView) => {
    setSearching(false);
    setQuery("");
    window.history.pushState(
      { tasksList: true },
      "",
      `${LIST_PATH}${hashFor(next)}`,
    );
    setView(next);
  };
  /** Back to the lists screen: pop our own entry, or (deep link/reload) rewrite. */
  const leaveList = () => {
    const state = window.history.state as { tasksList?: boolean } | null;
    if (state?.tasksList) window.history.back();
    else {
      window.history.replaceState(null, "", LIST_PATH);
      setView(null);
    }
  };
  const showRepeating = () => {
    setSelectedId(null);
    const repeating: TaskView = { kind: "smart", id: "repeating" };
    if (view === null) {
      openList(repeating);
      return;
    }
    window.history.replaceState(
      { tasksList: true },
      "",
      `${LIST_PATH}${hashFor(repeating)}`,
    );
    setView(repeating);
  };

  const onQuickAdd = async (text: string) => {
    if (!defaults) return false;
    const row = await api.create(text, defaults);
    return row !== null;
  };

  const focusQuickAdd = () => {
    if (quickAddPlaceholder === null) {
      setSheet("new");
      return;
    }
    quickAddRef.current?.scrollIntoView({ block: "nearest" });
    quickAddRef.current?.focus();
  };

  const rowsApi = { api, today, onOpen: setSelectedId };

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-canvas">
      {effectiveView === null ? (
        <ListsScreen
          api={api}
          searching={searching}
          query={query}
          onQuery={setQuery}
          onSearching={(on) => {
            setSearching(on);
            if (!on) setQuery("");
          }}
          onNew={() => setSheet("new")}
          onOpenList={openList}
          smartCounts={smartCounts}
          repeatingCount={
            recurring.rulesLoading ? null : recurring.rules.length
          }
          subjects={subjects}
          plainTags={plainTags}
          tagCounts={counts}
          folders={folders}
          openTasks={openTasks}
          rowsApi={rowsApi}
        />
      ) : (
        <ListScreen
          view={effectiveView}
          title={title}
          groups={groups}
          count={openCount}
          loading={api.loading}
          optionsActive={sort !== "default" || traits.length > 0}
          onBack={leaveList}
          onOptions={() => setSheet("options")}
          onNew={focusQuickAdd}
          quickAdd={quickAddPlaceholder}
          quickAddRef={quickAddRef}
          onQuickAdd={onQuickAdd}
          emptyText={emptyText}
          recurring={recurring}
          rowsApi={rowsApi}
          onShowMoreLogbook={
            isLogbook &&
            api.logbook !== null &&
            api.logbook.length >= api.logbookLimit
              ? api.showMoreLogbook
              : null
          }
        />
      )}

      {selected && (
        <BottomSheet
          label="Task details"
          onClose={closeDetails}
          className="h-[min(88dvh,46rem)]"
        >
          {/* Fixed-height sheet: the fields scroll, Move/Delete stay pinned. */}
          <div className="flex h-full min-h-0 flex-col">
            <TaskDetails
              task={selected}
              api={api}
              subjects={subjects}
              onShowRepeating={showRepeating}
              onDone={closeDetails}
            />
          </div>
        </BottomSheet>
      )}

      {sheet === "new" && (
        <NewTaskSheet
          onClose={closeSheet}
          onCreate={async (text) => {
            const row = await api.create(text, {
              due: null,
              someday: false,
              tagId: null,
            });
            return row !== null;
          }}
        />
      )}

      {sheet === "options" && effectiveView && (
        <OptionsSheet
          onClose={closeSheet}
          sort={sort}
          onSort={setSort}
          traits={traits}
          onTraits={setTraits}
          rows={baseRows}
          today={today}
          canFilter={
            !(
              effectiveView.kind === "smart" && effectiveView.id === "repeating"
            )
          }
        />
      )}
    </div>
  );
}

type RowsApi = {
  api: TaskListsApi;
  today: string;
  onOpen: (id: string) => void;
};

// ---- screen 1: the lists ---------------------------------------------------------

function ListsScreen({
  api,
  searching,
  query,
  onQuery,
  onSearching,
  onNew,
  onOpenList,
  smartCounts,
  repeatingCount,
  subjects,
  plainTags,
  tagCounts,
  folders,
  openTasks,
  rowsApi,
}: {
  api: TaskListsApi;
  searching: boolean;
  query: string;
  onQuery: (q: string) => void;
  onSearching: (on: boolean) => void;
  onNew: () => void;
  onOpenList: (v: TaskView) => void;
  smartCounts: Partial<Record<SmartListId, number>> | null;
  repeatingCount: number | null;
  subjects: { id: string; name: string; color: string | null }[];
  plainTags: { id: string; name: string }[];
  tagCounts: Map<string, number>;
  folders: { title: string; color: string | null; count: number }[];
  openTasks: ListTaskResult[];
  rowsApi: RowsApi;
}) {
  const [workloadOpen, setWorkloadOpen] = usePersistentState<boolean>(
    "agenda.tasks.phone.workload",
    false,
    (v): v is boolean => typeof v === "boolean",
  );
  const [brush, setBrush] = useState<DayRange | null>(null);
  const smart = (
    id: SmartListId,
    count: number | null | undefined,
  ): React.ReactNode => (
    <ListRow
      key={id}
      icon={SMART_ICONS[id]}
      label={SMART_LIST_LABELS[id]}
      count={count}
      onClick={() => onOpenList({ kind: "smart", id })}
    />
  );
  const c = (id: SmartListId) =>
    api.loading || smartCounts === null ? null : smartCounts[id];

  const q = query.trim().toLowerCase();
  const hits = useMemo(
    () =>
      q
        ? openTasks.filter(
            (t) =>
              t.title.toLowerCase().includes(q) ||
              (t.noteTitle ?? "").toLowerCase().includes(q) ||
              t.tags.some((tag) => tag.name.toLowerCase().includes(q)),
          )
        : [],
    [openTasks, q],
  );

  const brushed = brush
    ? openTasks.filter((t) =>
        inView(
          t,
          { kind: "range", start: brush.start, end: brush.end },
          api.today,
        ),
      ).length
    : 0;

  return (
    <>
      {searching ? (
        <div className="flex h-14 flex-none items-center gap-1 px-2">
          <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/8 bg-white/4 px-3">
            <Search className="h-4 w-4 flex-none text-ink-500" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              aria-label="Search tasks"
              placeholder="Search tasks"
              className="h-full min-w-0 flex-1 bg-transparent text-[1rem] text-ink-100 outline-none placeholder:text-ink-600"
            />
          </div>
          <button
            type="button"
            onClick={() => onSearching(false)}
            className={`h-11 rounded-lg px-3 text-[1rem] font-medium text-sage ${FOCUS}`}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex h-14 flex-none items-center gap-1 px-2">
          <h1 className="min-w-0 flex-1 truncate px-2.5 text-[1.75rem] font-semibold text-ink-100">
            Tasks
          </h1>
          <button
            type="button"
            aria-label="Search tasks"
            onClick={() => onSearching(true)}
            className={HEADER_BTN}
          >
            <Search className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="New task"
            onClick={onNew}
            className={`${HEADER_BTN} text-sage`}
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pb-8">
        {searching ? (
          q === "" ? (
            <p className="px-5 py-6 text-[0.9375rem] text-ink-500">
              Search every open task by title, note or tag.
            </p>
          ) : hits.length === 0 ? (
            <p className="px-5 py-6 text-[0.9375rem] text-ink-500">
              No open tasks match “{query.trim()}”.
            </p>
          ) : (
            <div role="list" aria-label="Search results">
              {hits.map((t) => (
                <TaskRow key={t.id} task={t} view={null} {...rowsApi} />
              ))}
            </div>
          )
        ) : (
          <>
            <nav aria-label="Task lists">
              <div className="border-t border-white/6">
                {smart("inbox", c("inbox"))}
                {smart("today", c("today"))}
                {smart("upcoming", c("upcoming"))}
                {smart("anytime", c("anytime"))}
                {smart("someday", c("someday"))}
              </div>
              <div className="mt-3 border-t border-white/6">
                {smart("logbook", undefined)}
                {smart("repeating", repeatingCount)}
              </div>

              <div className={SECTION_LABEL}>Lists</div>
              <div className="border-t border-white/6">
                {subjects.length === 0 ? (
                  <p className="px-5 py-3 text-[0.875rem] text-ink-600">
                    Subjects you color on Today show up here.
                  </p>
                ) : (
                  subjects.map((s) => (
                    <ListRow
                      key={s.id}
                      iconNode={
                        <span
                          aria-hidden
                          className="h-3 w-3 rounded-[0.25rem]"
                          style={{ background: subjectColor(s.color) }}
                        />
                      }
                      label={s.name}
                      count={api.loading ? null : (tagCounts.get(s.id) ?? 0)}
                      onClick={() => onOpenList({ kind: "subject", id: s.id })}
                    />
                  ))
                )}
              </div>

              {plainTags.length > 0 && (
                <>
                  <div className={SECTION_LABEL}>Tags</div>
                  <div className="border-t border-white/6">
                    {plainTags.map((t) => {
                      const count = tagCounts.get(t.id) ?? 0;
                      return (
                        <ListRow
                          key={t.id}
                          icon={Hash}
                          label={t.name}
                          count={api.loading ? null : count || undefined}
                          dim={count === 0}
                          onClick={() => onOpenList({ kind: "tag", id: t.id })}
                        />
                      );
                    })}
                  </div>
                </>
              )}

              {folders.length > 0 && (
                <>
                  <div className={SECTION_LABEL}>Folders</div>
                  <div className="border-t border-white/6">
                    {folders.map((f) => (
                      <ListRow
                        key={f.title}
                        iconNode={
                          <span
                            aria-hidden
                            className="h-2.5 w-2.5 rounded-full"
                            style={{
                              background: f.color ?? "var(--color-sage)",
                            }}
                          />
                        }
                        label={f.title}
                        count={f.count}
                        onClick={() =>
                          onOpenList({ kind: "folder", title: f.title })
                        }
                      />
                    ))}
                  </div>
                </>
              )}
            </nav>

            <div className="mt-5 border-t border-white/6">
              <button
                type="button"
                aria-expanded={workloadOpen}
                aria-controls="tasks-workload"
                onClick={() => setWorkloadOpen((o) => !o)}
                className={`flex min-h-12 w-full items-center gap-2 px-5 text-left ${FOCUS}`}
              >
                <span className="flex-1 text-[0.6875rem] font-semibold tracking-[0.1em] text-ink-500 uppercase">
                  Workload
                </span>
                <ChevronDown
                  className={`h-4 w-4 text-ink-500 transition-transform ${
                    workloadOpen ? "" : "-rotate-90"
                  }`}
                  aria-hidden
                />
              </button>
              {workloadOpen && (
                <div id="tasks-workload" className="-mx-1 pb-2">
                  <WorkloadStrip
                    tasks={openTasks.map(toFilterable)}
                    today={api.today}
                    range={brush}
                    onRangeChange={setBrush}
                  />
                  {brush && (
                    <button
                      type="button"
                      onClick={() =>
                        onOpenList({
                          kind: "range",
                          start: brush.start,
                          end: brush.end,
                        })
                      }
                      className={`mx-5 flex min-h-11 items-center gap-1 rounded-lg px-1 text-[0.9375rem] font-medium text-sage ${FOCUS}`}
                    >
                      Open {describeRange(brush)} · {brushed} task
                      {brushed === 1 ? "" : "s"}
                      <ChevronRight className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function ListRow({
  icon: Icon,
  iconNode,
  label,
  count,
  dim,
  onClick,
}: {
  icon?: LucideIcon;
  iconNode?: React.ReactNode;
  label: string;
  count?: number | null;
  dim?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[3.25rem] w-full items-center gap-3.5 border-b border-white/6 px-5 text-left active:bg-white/4 ${FOCUS}`}
    >
      <span className="flex h-5 w-5 flex-none items-center justify-center text-ink-300">
        {Icon ? <Icon className="h-5 w-5" aria-hidden /> : iconNode}
      </span>
      <span
        className={`min-w-0 flex-1 truncate text-[1.0625rem] ${
          dim ? "text-ink-500" : "text-ink-100"
        }`}
      >
        {label}
      </span>
      {count !== null && count !== undefined && (
        <span className="flex-none text-[0.9375rem] text-ink-500 tabular-nums">
          {count}
        </span>
      )}
      <ChevronRight className="h-4 w-4 flex-none text-ink-600" aria-hidden />
    </button>
  );
}

// ---- screen 2: one list -----------------------------------------------------------

const GROUP_LABEL =
  "flex h-10 items-end px-5 pb-1.5 text-[0.6875rem] font-semibold tracking-[0.1em] uppercase";

function ListScreen({
  view,
  title,
  groups,
  count,
  loading,
  optionsActive,
  onBack,
  onOptions,
  onNew,
  quickAdd,
  quickAddRef,
  onQuickAdd,
  emptyText,
  recurring,
  rowsApi,
  onShowMoreLogbook,
}: {
  view: TaskView;
  title: string;
  groups: ListGroup<ListTaskResult>[];
  count: number;
  loading: boolean;
  optionsActive: boolean;
  onBack: () => void;
  onOptions: () => void;
  onNew: () => void;
  quickAdd: string | null;
  quickAddRef: React.RefObject<HTMLInputElement | null>;
  onQuickAdd: (title: string) => Promise<boolean>;
  emptyText: string;
  recurring: ReturnType<typeof useRecurringRules>;
  rowsApi: RowsApi;
  onShowMoreLogbook: (() => void) | null;
}) {
  const isRepeating = view.kind === "smart" && view.id === "repeating";
  const rows = groups.flatMap((g) => g.tasks);
  const subtitle = isRepeating
    ? `${recurring.rules.length} rule${recurring.rules.length === 1 ? "" : "s"}`
    : loading
      ? "Loading…"
      : `${count} task${count === 1 ? "" : "s"}`;

  return (
    <>
      <div className="flex h-14 flex-none items-center gap-1 pr-2 pl-1">
        <button
          type="button"
          onClick={onBack}
          className={`flex h-11 min-w-0 items-center gap-0.5 rounded-lg pr-3 pl-1 text-[1rem] font-medium text-sage ${FOCUS}`}
        >
          <ChevronLeft className="h-5 w-5 flex-none" aria-hidden />
          Lists
        </button>
        <span className="flex-1" />
        {!isRepeating && (
          <button
            type="button"
            aria-label={
              optionsActive ? "Sort and filter (on)" : "Sort and filter"
            }
            onClick={onOptions}
            className={`${HEADER_BTN} relative`}
          >
            <MoreHorizontal className="h-5 w-5" />
            {optionsActive && (
              <span
                aria-hidden
                className="absolute top-2.5 right-2.5 h-2 w-2 rounded-full bg-sage"
              />
            )}
          </button>
        )}
        {!isRepeating && (
          <button
            type="button"
            aria-label="New task"
            onClick={onNew}
            className={`${HEADER_BTN} text-sage`}
          >
            <Plus className="h-5 w-5" />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pb-8">
        <div className="px-5 pt-1 pb-3">
          <h1 className="truncate text-[1.75rem] leading-tight font-semibold text-ink-100">
            {title}
          </h1>
          <p className="mt-0.5 text-[0.8125rem] text-ink-500">{subtitle}</p>
        </div>

        {isRepeating ? (
          // The rules editors were sized for a mouse: lift their controls to 44px.
          <div className="px-4 pt-2 [&_button]:min-h-11 [&_input]:min-h-11 [&_input]:text-[1rem] [&_select]:min-h-11 [&_select]:text-[1rem]">
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
            {loading && rows.length === 0 ? (
              <RowsSkeleton />
            ) : rows.length === 0 ? (
              <p className="px-5 py-6 text-[0.9375rem] text-ink-500">
                {emptyText}
              </p>
            ) : (
              <div role="list" aria-label={`${title} tasks`}>
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
                    {group.tasks.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        view={view}
                        {...rowsApi}
                      />
                    ))}
                  </div>
                ))}
                {onShowMoreLogbook && (
                  <button
                    type="button"
                    onClick={onShowMoreLogbook}
                    className={`mx-4 mt-3 min-h-11 rounded-lg px-3 text-[0.9375rem] font-medium text-sage ${FOCUS}`}
                  >
                    Show more
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** One 44px+ row: subject-ringed round checkbox, title (+ "from <note>"), and
 *  the subject / time / due on the right. Tapping the text opens Details. */
function TaskRow({
  task,
  view,
  api,
  today,
  onOpen,
}: {
  task: ListTaskResult;
  view: TaskView | null;
} & RowsApi) {
  const done = task.completedAt !== null;
  const subject = subjectOf(task);
  const ring = subject ? subjectColor(subject.color) : null;
  const overdue = !done && task.due !== null && task.due < today;
  const inToday = view?.kind === "smart" && view.id === "today";
  const inUpcoming = view?.kind === "smart" && view.id === "upcoming";
  const inSubject = view?.kind === "subject" && subject?.id === view.id;

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

  return (
    <div
      role="listitem"
      className="flex min-h-[3.25rem] items-stretch border-b border-white/6"
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={
          done ? `Mark “${task.title}” not done` : `Complete “${task.title}”`
        }
        onClick={() => api.toggle(task.id)}
        className={`flex w-14 flex-none items-center justify-center pl-2 ${FOCUS}`}
      >
        <span
          className={`flex h-[1.375rem] w-[1.375rem] items-center justify-center rounded-full border-[1.5px] transition-colors ${
            done ? "border-transparent bg-sage" : ""
          }`}
          style={
            !done ? { borderColor: ring ?? "var(--color-ink-500)" } : undefined
          }
        >
          {done && <Check className="h-3 w-3 text-sage-ink" strokeWidth={3} />}
        </span>
      </button>

      <button
        type="button"
        onClick={() => onOpen(task.id)}
        className={`flex min-w-0 flex-1 items-center gap-2.5 py-2 pr-5 text-left active:bg-white/4 ${FOCUS}`}
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={`truncate text-[1rem] leading-snug ${
              done ? "text-ink-500 line-through" : "text-ink-100"
            }`}
          >
            {task.title}
          </span>
          {task.noteTitle && (
            <span className="truncate text-[0.8125rem] leading-tight text-ink-500">
              from {task.noteTitle}
            </span>
          )}
        </span>

        {(task.important || task.subtaskCount > 0 || task.recurring) && (
          <span className="flex flex-none items-center gap-2 text-[0.75rem] text-ink-500">
            {task.important && (
              <Star
                className={`h-3 w-3 fill-current ${
                  overdue ? "text-overdue" : "text-ink-300"
                }`}
                aria-label="Important"
              />
            )}
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
        {(subject && !inSubject) || whenText ? (
          <span className="flex max-w-[45%] flex-none flex-col items-end gap-0.5 text-right">
            {subject && !inSubject && (
              <span
                className="max-w-full truncate text-[0.8125rem]"
                style={{ color: subjectColor(subject.color) }}
              >
                {subject.name}
              </span>
            )}
            {whenText && (
              <span
                className={`font-mono text-[0.75rem] tabular-nums ${
                  overdueTone(overdue, task.important) ?? "text-ink-500"
                }`}
              >
                {whenText}
              </span>
            )}
          </span>
        ) : null}
      </button>
    </div>
  );
}

function QuickAdd({
  ref,
  placeholder,
  onSubmit,
}: {
  ref: React.Ref<HTMLInputElement>;
  placeholder: string;
  onSubmit: (title: string) => Promise<boolean>;
}) {
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
    <div className="flex min-h-[3.25rem] items-center gap-3.5 border-y border-white/6 pr-3 pl-5">
      <Plus className="h-5 w-5 flex-none text-ink-500" aria-hidden />
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
        enterKeyHint="done"
        aria-label="New task"
        placeholder={placeholder}
        className="h-full min-h-11 min-w-0 flex-1 bg-transparent text-[1rem] text-ink-100 outline-none placeholder:text-ink-600"
      />
      {draft.trim() && (
        <button
          type="button"
          onClick={() => void submit()}
          className={`h-11 flex-none rounded-lg px-3 text-[1rem] font-medium text-sage ${FOCUS}`}
        >
          Add
        </button>
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
          className="flex h-[3.25rem] items-center gap-4 border-b border-white/6 px-5"
        >
          <span className="h-[1.375rem] w-[1.375rem] rounded-full bg-white/7" />
          <span
            className="h-3.5 rounded bg-white/7"
            style={{ width: `${w}%` }}
          />
        </div>
      ))}
    </div>
  );
}

// ---- sheets ---------------------------------------------------------------------

/** + on the lists screen: a quick capture that lands in the Inbox. */
function NewTaskSheet({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (title: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // BottomSheet focuses the first control in DOM order — the header's Done —
  // so typing (and Space) would land on it. Our effect runs after the sheet's.
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);
  const submit = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setDraft("");
    const ok = await onCreate(text);
    if (ok) setAdded(text);
    else setDraft(text);
    setBusy(false);
  };
  return (
    <BottomSheet
      label="New task"
      onClose={onClose}
      header={
        <div className="flex h-11 items-center justify-between px-5">
          <h2 className="text-[1.0625rem] font-semibold text-ink-100">
            New task
          </h2>
          <button
            type="button"
            onClick={onClose}
            className={`-mr-2 flex h-11 items-center rounded-md px-2 text-[1rem] font-medium text-sage ${FOCUS}`}
          >
            Done
          </button>
        </div>
      }
    >
      <div className="px-5 pt-1 pb-3">
        <div className="flex min-h-12 items-center gap-2 rounded-xl border border-white/8 bg-input px-3.5">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
            enterKeyHint="done"
            aria-label="Task title"
            placeholder="What needs doing? #tag to label it, ! if it matters"
            className="h-12 min-w-0 flex-1 bg-transparent text-[1rem] text-ink-100 outline-none placeholder:text-ink-600"
          />
          <button
            type="button"
            disabled={!draft.trim() || busy}
            onClick={() => void submit()}
            className={`h-11 flex-none rounded-lg px-2 text-[1rem] font-medium text-sage disabled:opacity-40 ${FOCUS}`}
          >
            Add
          </button>
        </div>
        <p className="mt-2 text-[0.8125rem] text-ink-500" aria-live="polite">
          {added ? `Added “${added}” to Inbox.` : "Lands in your Inbox."}
        </p>
      </div>
    </BottomSheet>
  );
}

/** ⋯ on a list: sort order and trait filters (the old chips / rail). */
function OptionsSheet({
  onClose,
  sort,
  onSort,
  traits,
  onTraits,
  rows,
  today,
  canFilter,
}: {
  onClose: () => void;
  sort: TaskSort;
  onSort: (next: TaskSort) => void;
  traits: TaskTrait[];
  onTraits: (next: TaskTrait[]) => void;
  rows: ListTaskResult[];
  today: string;
  canFilter: boolean;
}) {
  return (
    <BottomSheet
      label="Sort and filter"
      onClose={onClose}
      header={
        <div className="flex h-11 items-center justify-between px-5">
          <h2 className="text-[1.0625rem] font-semibold text-ink-100">
            Sort &amp; filter
          </h2>
          <button
            type="button"
            onClick={onClose}
            className={`-mr-2 flex h-11 items-center rounded-md px-2 text-[1rem] font-medium text-sage ${FOCUS}`}
          >
            Done
          </button>
        </div>
      }
    >
      <div className="pb-3">
        <div className={`${SECTION_LABEL} pt-2`}>Sort</div>
        <div role="radiogroup" aria-label="Sort tasks">
          {SORTS.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={sort === s}
              onClick={() => onSort(s)}
              className={`flex min-h-12 w-full items-center gap-3 border-b border-white/6 px-5 text-left text-[1rem] ${FOCUS} ${
                sort === s ? "text-sage" : "text-ink-200"
              }`}
            >
              <Check
                className={`h-4 w-4 flex-none ${sort === s ? "" : "opacity-0"}`}
                aria-hidden
              />
              {SORT_LABELS[s]}
            </button>
          ))}
        </div>
        {canFilter && (
          <>
            <div className="flex items-center">
              <div className={`${SECTION_LABEL} flex-1`}>Filter</div>
              {traits.length > 0 && (
                <button
                  type="button"
                  onClick={() => onTraits([])}
                  className={`mt-3 mr-3 h-11 rounded-lg px-2 text-[0.9375rem] text-ink-400 ${FOCUS}`}
                >
                  Clear
                </button>
              )}
            </div>
            <div className="px-5 pt-1">
              <TraitChips
                tasks={rows.map(toFilterable)}
                today={today}
                traits={traits}
                onChange={onTraits}
              />
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
