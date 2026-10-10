import { addDays, formatShortDate } from "./dates";
import { isSubjectColor } from "./subjects";

/**
 * The Tasks page's lists (Notes Sidebars design §5b), as pure rules over one
 * payload of open top-level tasks. Definitions decided with the owner:
 *
 * - **Inbox**: open, no due date, no tags, not someday — captured, untriaged.
 * - **Today**: due today or overdue (overdue splits important/red vs calm).
 * - **Upcoming**: due after today.
 * - **Anytime**: open, no due date, not someday (Inbox rows included).
 * - **Someday**: parked (`someday`), dated or not.
 * - **Logbook**: completed — a separate read, newest first.
 * - **Repeating**: the recurring-rules editor, not a task list.
 *
 * A subject list holds the open tasks carrying that subject; a tag list the
 * open tasks carrying that tag. Subjects are tags with a palette color
 * (`SUBJECT_COLORS`); every other tag is a plain `#tag`. A task's subject —
 * the row's colored label and checkbox ring — is its first subject tag.
 *
 * Subtasks and habit occurrences never reach these functions: the server
 * read excludes them.
 */

export type SmartListId =
  | "inbox"
  | "today"
  | "upcoming"
  | "anytime"
  | "someday"
  | "logbook"
  | "repeating";

export const SMART_LISTS: SmartListId[] = [
  "inbox",
  "today",
  "upcoming",
  "anytime",
  "someday",
  "logbook",
  "repeating",
];

export const SMART_LIST_LABELS: Record<SmartListId, string> = {
  inbox: "Inbox",
  today: "Today",
  upcoming: "Upcoming",
  anytime: "Anytime",
  someday: "Someday",
  logbook: "Logbook",
  repeating: "Repeating",
};

export type TaskView =
  | { kind: "smart"; id: SmartListId }
  | { kind: "subject"; id: string }
  | { kind: "tag"; id: string }
  | { kind: "folder"; title: string }
  /** A window brushed on the workload strip; `start: null` = overdue side. */
  | { kind: "range"; start: string | null; end: string };

export const DEFAULT_VIEW: TaskView = { kind: "smart", id: "today" };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Shape guard for a view read back from localStorage. */
export function isTaskView(v: unknown): v is TaskView {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  switch (o.kind) {
    case "smart":
      return SMART_LISTS.includes(o.id as SmartListId);
    case "subject":
    case "tag":
      return typeof o.id === "string" && o.id.length > 0;
    case "folder":
      return typeof o.title === "string" && o.title.length > 0;
    case "range":
      return (
        (o.start === null ||
          (typeof o.start === "string" && DAY_RE.test(o.start))) &&
        typeof o.end === "string" &&
        DAY_RE.test(o.end)
      );
    default:
      return false;
  }
}

export function sameView(a: TaskView, b: TaskView): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type ListTag = { id: string; name: string; color: string | null };

/** The minimal task shape the rules read. */
export type ListTaskLike = {
  id: string;
  title: string;
  /** YYYY-MM-DD local due day, or null. */
  due: string | null;
  /** "HH:MM" time of day, or null. */
  time: string | null;
  important: boolean;
  someday: boolean;
  /** ISO instant. */
  createdAt: string;
  completedAt: string | null;
  boardTitle: string | null;
  tags: ListTag[];
};

export function isSubjectTag(tag: { color: string | null }): boolean {
  return isSubjectColor(tag.color);
}

/** The task's subject: its first tag with a palette color, if any. */
export function subjectOf<T extends ListTag>(task: { tags: T[] }): T | null {
  return task.tags.find(isSubjectTag) ?? null;
}

export function inSmartList(
  task: ListTaskLike,
  id: SmartListId,
  today: string,
): boolean {
  switch (id) {
    case "inbox":
      return task.due === null && task.tags.length === 0 && !task.someday;
    case "today":
      return task.due !== null && task.due <= today;
    case "upcoming":
      return task.due !== null && task.due > today;
    case "anytime":
      return task.due === null && !task.someday;
    case "someday":
      return task.someday;
    case "logbook":
      return task.completedAt !== null;
    case "repeating":
      return false;
  }
}

/** Whether an OPEN task belongs to `view` (Logbook rows come pre-filtered). */
export function inView(
  task: ListTaskLike,
  view: TaskView,
  today: string,
): boolean {
  switch (view.kind) {
    case "smart":
      return view.id === "logbook" ? true : inSmartList(task, view.id, today);
    case "subject":
    case "tag":
      return task.tags.some((t) => t.id === view.id);
    case "folder":
      return task.boardTitle === view.title;
    case "range":
      return (
        task.due !== null &&
        (view.start === null || task.due >= view.start) &&
        task.due <= view.end
      );
  }
}

/** Open-task counts per smart list (Logbook/Repeating aren't counted). */
export function smartListCounts(
  tasks: ListTaskLike[],
  today: string,
): Record<"inbox" | "today" | "upcoming" | "anytime" | "someday", number> {
  const counts = { inbox: 0, today: 0, upcoming: 0, anytime: 0, someday: 0 };
  for (const t of tasks) {
    for (const id of Object.keys(counts) as (keyof typeof counts)[]) {
      if (inSmartList(t, id, today)) counts[id] += 1;
    }
  }
  return counts;
}

/** Open-task count per tag id (subjects and plain tags alike). */
export function tagCounts(tasks: ListTaskLike[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of tasks) {
    for (const tag of t.tags) out.set(tag.id, (out.get(tag.id) ?? 0) + 1);
  }
  return out;
}

export type TaskSort = "default" | "due" | "title" | "newest" | "oldest";

export const SORT_LABELS: Record<TaskSort, string> = {
  default: "Default",
  due: "Due date",
  title: "Title",
  newest: "Newest first",
  oldest: "Oldest first",
};

export type ListGroup<T> = {
  key: string;
  /** Null = no header (the first, unlabeled group). */
  label: string | null;
  tone?: "overdue" | "calm";
  tasks: T[];
};

/** Tasks timed after this read as "This evening" on Today (design 5b). */
export const EVENING_AFTER = "17:00";

const byCreatedDesc = (a: ListTaskLike, b: ListTaskLike) =>
  b.createdAt.localeCompare(a.createdAt);
const byCreatedAsc = (a: ListTaskLike, b: ListTaskLike) =>
  a.createdAt.localeCompare(b.createdAt);
/** Due day (undated last), then time (untimed first), then capture order. */
const byDue = (a: ListTaskLike, b: ListTaskLike) => {
  if (a.due !== b.due) {
    if (a.due === null) return 1;
    if (b.due === null) return -1;
    return a.due.localeCompare(b.due);
  }
  if (a.time !== b.time) {
    if (a.time === null) return -1;
    if (b.time === null) return 1;
    return a.time.localeCompare(b.time);
  }
  return byCreatedAsc(a, b);
};
const byTitle = (a: ListTaskLike, b: ListTaskLike) =>
  a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
const byCompletedDesc = (a: ListTaskLike, b: ListTaskLike) =>
  (b.completedAt ?? "").localeCompare(a.completedAt ?? "");

const SORTERS: Record<
  Exclude<TaskSort, "default">,
  (a: ListTaskLike, b: ListTaskLike) => number
> = {
  due: byDue,
  title: byTitle,
  newest: byCreatedDesc,
  oldest: byCreatedAsc,
};

/** "Tomorrow" / "Sat, Oct 10" for a day header. */
export function dayHeading(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  if (day === addDays(today, -1)) return "Yesterday";
  return formatShortDate(day);
}

/**
 * The rows of a view, grouped where grouping helps:
 * - Today: Overdue (important, red) · Carried over (calm) · today · This evening
 * - Upcoming: one group per due day
 * - Logbook: one group per completion day (`completedDay` maps the ISO
 *   instant to a local day — injected so this stays timezone-free)
 * - everything else: one unlabeled group
 * A non-default sort flattens to one group in that order.
 */
export function groupTasks<T extends ListTaskLike>(
  rows: T[],
  view: TaskView,
  today: string,
  sort: TaskSort,
  completedDay: (iso: string) => string = (iso) => iso.slice(0, 10),
): ListGroup<T>[] {
  if (rows.length === 0) return [];
  if (sort !== "default") {
    return [{ key: "all", label: null, tasks: [...rows].sort(SORTERS[sort]) }];
  }
  const smart = view.kind === "smart" ? view.id : null;

  if (smart === "today") {
    const overdue = rows.filter((t) => t.due !== null && t.due < today);
    const due = rows.filter((t) => t.due === today);
    const dayOrder = (list: T[]) => [...list].sort(byDue);
    const evening = due.filter(
      (t) => t.time !== null && t.time > EVENING_AFTER,
    );
    const daytime = due.filter((t) => !evening.includes(t));
    const groups: ListGroup<T>[] = [
      {
        key: "overdue",
        label: "Overdue",
        tone: "overdue",
        tasks: dayOrder(overdue.filter((t) => t.important)),
      },
      {
        key: "carried",
        label: "Carried over",
        tone: "calm",
        tasks: dayOrder(overdue.filter((t) => !t.important)),
      },
      {
        key: "today",
        label: overdue.length > 0 ? "Today" : null,
        tasks: dayOrder(daytime),
      },
      { key: "evening", label: "This evening", tasks: dayOrder(evening) },
    ];
    return groups.filter((g) => g.tasks.length > 0);
  }

  if (smart === "upcoming") {
    return groupBy(
      [...rows].sort(byDue),
      (t) => t.due ?? "",
      (day) => dayHeading(day, today),
    );
  }

  if (smart === "logbook") {
    return groupBy(
      [...rows].sort(byCompletedDesc),
      (t) => (t.completedAt ? completedDay(t.completedAt) : ""),
      (day) => (day ? dayHeading(day, today) : "Done"),
    );
  }

  // Inbox / Anytime / Someday read newest-first (capture order); subject,
  // tag, folder and range lists read by due day.
  const order = view.kind === "smart" ? byCreatedDesc : byDue;
  return [{ key: "all", label: null, tasks: [...rows].sort(order) }];
}

/** Consecutive-run grouping over an already sorted list. */
function groupBy<T>(
  rows: T[],
  keyOf: (t: T) => string,
  labelOf: (key: string) => string,
): ListGroup<T>[] {
  const groups: ListGroup<T>[] = [];
  for (const row of rows) {
    const key = keyOf(row);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.tasks.push(row);
    else groups.push({ key, label: labelOf(key), tasks: [row] });
  }
  return groups;
}

/**
 * What a quick-add typed into `view` should start as, so the new task lands
 * in the list it was typed into: Today → due today, Upcoming → due tomorrow,
 * Someday → parked, a subject/tag list → carries it. Null = no quick-add in
 * this view (Logbook, Repeating, folders and strip ranges, which a bare task
 * can't join).
 */
export function quickAddDefaults(
  view: TaskView,
  today: string,
): { due: string | null; someday: boolean; tagId: string | null } | null {
  switch (view.kind) {
    case "smart":
      switch (view.id) {
        case "today":
          return { due: today, someday: false, tagId: null };
        case "upcoming":
          return { due: addDays(today, 1), someday: false, tagId: null };
        case "someday":
          return { due: null, someday: true, tagId: null };
        case "inbox":
        case "anytime":
          return { due: null, someday: false, tagId: null };
        default:
          return null;
      }
    case "subject":
    case "tag":
      return { due: null, someday: false, tagId: view.id };
    default:
      return null;
  }
}

/** Short right-hand due label for a row: "Oct 3" / "Tomorrow" / "Sat". */
export function dueLabel(due: string, today: string): string {
  if (due === today) return "Today";
  if (due === addDays(today, 1)) return "Tomorrow";
  if (due > today && due <= addDays(today, 6)) {
    return new Date(`${due}T12:00:00`).toLocaleDateString("en-US", {
      weekday: "short",
    });
  }
  return new Date(`${due}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
