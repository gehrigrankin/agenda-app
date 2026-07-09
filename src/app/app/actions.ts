"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SerializedEditorState } from "lexical";

import * as bubblesRepo from "@/server/bubbles";
import * as notesRepo from "@/server/notes";
import * as recurringRepo from "@/server/recurring";
import * as tasksRepo from "@/server/tasks";
import { parseRecurrenceInput, type RecurrenceSpec } from "@/lib/recurrence";

async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  return userId;
}

/**
 * Create a note and jump into it (the redirect happens server-side).
 * `title` is optional so existing no-arg callers keep working; the typeof
 * guard also protects against a <form action> binding passing FormData.
 */
export async function createNoteAction(title?: string): Promise<void> {
  const ownerId = await requireUserId();
  const safeTitle =
    (typeof title === "string" ? title.trim().slice(0, 300) : "") || "Untitled";
  const note = await notesRepo.createNote({ ownerId, title: safeTitle });
  revalidatePath("/app", "layout");
  redirect(`/app/notes/${note.id}`);
}

/**
 * Create a note WITHOUT navigating — the `[[…]]` create-as-you-link flow and
 * the rail's mini note composer. The caller decides what to do with the id.
 * `content` (optional, backward compatible) seeds the body: the composer
 * edits a LOCAL Lexical instance before any note row exists, so its state is
 * persisted here via the same path as autosave (plain-text mirror plus
 * task/note-link reconciliation) before the dock window loads the note.
 */
export async function quickCreateNoteAction(
  title?: string,
  content?: SerializedEditorState,
): Promise<{ id: string; title: string }> {
  const ownerId = await requireUserId();
  const safeTitle =
    (typeof title === "string" ? title.trim().slice(0, 300) : "") || "Untitled";
  const note = await notesRepo.createNote({ ownerId, title: safeTitle });
  if (typeof content === "object" && content !== null) {
    await saveNoteContentAction(note.id, content);
  }
  revalidatePath("/app", "layout");
  return { id: note.id, title: note.title };
}

// ---------------------------------------------------------------------------
// Global search (⌘K palette)
// ---------------------------------------------------------------------------

/** Plain-serializable note hit for the command palette. */
export type SearchNoteResult = {
  id: string;
  title: string;
  bubbleId: string | null;
  /** YYYY-MM-DD when the note is a daily jot, else null. */
  dailyDate: string | null;
  /** ISO timestamp (results are already sorted by this, newest first). */
  updatedAt: string;
};

/** Plain-serializable bubble hit for the command palette. */
export type SearchBubbleResult = {
  id: string;
  title: string;
  emoji: string | null;
  parentId: string | null;
};

const SEARCH_QUERY_MAX_LENGTH = 100;

/** Title search across live notes and bubbles for the ⌘K palette. */
export async function searchAction(query: string): Promise<{
  notes: SearchNoteResult[];
  bubbles: SearchBubbleResult[];
}> {
  const ownerId = await requireUserId();
  const q = (typeof query === "string" ? query : "")
    .trim()
    .slice(0, SEARCH_QUERY_MAX_LENGTH);
  if (q.length < 1) return { notes: [], bubbles: [] };

  const [noteRows, bubbleRows] = await Promise.all([
    notesRepo.searchNotes(ownerId, q),
    bubblesRepo.searchBubbles(ownerId, q),
  ]);

  return {
    notes: noteRows.map((n) => ({
      id: n.id,
      title: n.title,
      bubbleId: n.bubbleId,
      dailyDate: n.dailyDate ? n.dailyDate.toISOString().slice(0, 10) : null,
      updatedAt: n.updatedAt.toISOString(),
    })),
    bubbles: bubbleRows.map((b) => ({
      id: b.id,
      title: b.title,
      emoji: b.emoji,
      parentId: b.parentId,
    })),
  };
}

/**
 * Get-or-create the daily jot for the user's LOCAL date (YYYY-MM-DD, supplied
 * by the client — the server can't know the user's timezone). Returns just
 * what the editor needs.
 */
export async function getOrCreateTodayNoteAction(dateStr: string): Promise<{
  id: string;
  title: string;
  content: SerializedEditorState | null;
}> {
  const ownerId = await requireUserId();
  const note = await notesRepo.getOrCreateDailyNote(ownerId, dateStr);
  // No revalidate: the daily editor is mounted when this runs, and refreshing
  // the layout mid-edit risks remounting it. Lists that show dailies read
  // fresh data on their own navigations.
  return {
    id: note.id,
    title: note.title,
    content: (note.content as SerializedEditorState | null) ?? null,
  };
}

/** The daily note for a date WITHOUT creating it (viewing past days). */
export async function getDailyNoteAction(dateStr: string): Promise<{
  id: string;
  title: string;
  content: SerializedEditorState | null;
} | null> {
  const ownerId = await requireUserId();
  const note = await notesRepo.getDailyNote(ownerId, dateStr);
  if (!note) return null;
  return {
    id: note.id,
    title: note.title,
    content: (note.content as SerializedEditorState | null) ?? null,
  };
}

/** Days in [startStr, endStr] that have a daily note (mini calendar). */
export async function listDailyNoteDatesAction(
  startStr: string,
  endStr: string,
): Promise<{ id: string; title: string; date: string }[]> {
  const ownerId = await requireUserId();
  return notesRepo.listDailyNoteDatesBetween(ownerId, startStr, endStr);
}

export type DaySummaryResult = {
  notesEdited: number;
  linksCreated: number;
  tasksDone: number;
  firstLine: string | null;
};

/**
 * Aggregates for the "Yesterday" widget. The client supplies its local date
 * string plus the day's absolute instant bounds (completedAt/updatedAt are
 * real instants; only the client knows its timezone).
 */
export async function getDaySummaryAction(
  dateStr: string,
  startIso: string,
  endIso: string,
): Promise<DaySummaryResult> {
  const ownerId = await requireUserId();
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid day bounds");
  }
  const [noteSide, tasksDone] = await Promise.all([
    notesRepo.getDaySummary(ownerId, dateStr, start, end),
    tasksRepo.listTasksCompletedBetween(ownerId, start, end),
  ]);
  return { ...noteSide, tasksDone: tasksDone.length };
}

// ---------------------------------------------------------------------------
// Note previews / quick view / linked today (the daily note's card system)
// ---------------------------------------------------------------------------

export type NotePreviewResult = {
  id: string;
  title: string;
  content: SerializedEditorState | null;
  bubbleId: string | null;
  bubbleTitle: string | null;
  bubbleColor: string | null;
  updatedAt: string;
};

/** Batched previews for linked-note cards (ids deduped, capped at 20). */
export async function getNotePreviewsAction(
  ids: string[],
): Promise<NotePreviewResult[]> {
  const ownerId = await requireUserId();
  const unique = [...new Set(ids)].slice(0, 20);
  const rows = await notesRepo.getNotePreviews(ownerId, unique);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    content: (r.content as SerializedEditorState | null) ?? null,
    bubbleId: r.bubbleId,
    bubbleTitle: r.bubbleTitle,
    bubbleColor: r.bubbleColor,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** Plain-serializable id → current-title pair for the link-title refresh. */
export type NoteTitleResult = { id: string; title: string };

/**
 * Current titles for a set of note ids — refreshes the cached title snapshots
 * on [[note-link]] chips / linked-note cards when an editor opens (ids deduped,
 * capped at 200 since they come from client content). No revalidate: read-only.
 */
export async function getNoteTitlesAction(
  ids: string[],
): Promise<NoteTitleResult[]> {
  const ownerId = await requireUserId();
  const unique = [
    ...new Set(
      (Array.isArray(ids) ? ids : []).filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      ),
    ),
  ].slice(0, 200);
  return notesRepo.getNoteTitles(ownerId, unique);
}

export type NoteDetailResult = {
  id: string;
  title: string;
  content: SerializedEditorState | null;
  bubbleId: string | null;
  bubbleTitle: string | null;
  bubbleColor: string | null;
  createdAt: string;
  updatedAt: string;
};

/** One live note with its bubble breadcrumb, for the quick-view overlay. */
export async function getNoteAction(
  id: string,
): Promise<NoteDetailResult | null> {
  const ownerId = await requireUserId();
  const note = await notesRepo.getNote(ownerId, id);
  if (!note || note.deletedAt) return null;
  let bubbleTitle: string | null = null;
  let bubbleColor: string | null = null;
  if (note.bubbleId) {
    const bubble = await bubblesRepo.getBubble(ownerId, note.bubbleId);
    bubbleTitle = bubble?.title ?? null;
    bubbleColor = bubble?.color ?? null;
  }
  return {
    id: note.id,
    title: note.title,
    content: (note.content as SerializedEditorState | null) ?? null,
    bubbleId: note.bubbleId,
    bubbleTitle,
    bubbleColor,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

export type LinkedTodayEntry = {
  id: string;
  title: string;
  updatedAt: string;
  bubbleColor: string | null;
};

/**
 * The "Linked today" widget: notes today's daily note links to, plus notes
 * edited within the client's local-day bounds that aren't linked yet.
 */
export async function getLinkedTodayAction(
  dailyNoteId: string,
  startIso: string,
  endIso: string,
): Promise<{ linked: LinkedTodayEntry[]; editedElsewhere: LinkedTodayEntry[] }> {
  const ownerId = await requireUserId();
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid day bounds");
  }
  const { linked, editedElsewhere } = await notesRepo.getLinkedToday(
    ownerId,
    dailyNoteId,
    start,
    end,
  );
  const toEntry = (r: (typeof linked)[number]): LinkedTodayEntry => ({
    id: r.id,
    title: r.title,
    updatedAt: r.updatedAt.toISOString(),
    bubbleColor: r.bubbleColor,
  });
  return {
    linked: linked.map(toEntry),
    editedElsewhere: editedElsewhere.map(toEntry),
  };
}

/** Autosave: rename. Revalidates so the sidebar title stays in sync. */
export async function renameNoteAction(
  id: string,
  title: string,
): Promise<void> {
  const ownerId = await requireUserId();
  await notesRepo.updateNoteContent(ownerId, id, {
    title: title.trim() || "Untitled",
  });
  revalidatePath("/app", "layout");
}

/**
 * Autosave: persist Lexical content. No revalidate — content isn't shown in the
 * sidebar, so we avoid re-rendering the tree on every keystroke batch.
 */
export async function saveNoteContentAction(
  id: string,
  content: SerializedEditorState,
): Promise<void> {
  const ownerId = await requireUserId();
  const note = await notesRepo.updateNoteContent(ownerId, id, { content });

  // Reconcile note_tasks links (and orphaned tasks) against the saved doc.
  // Fast path: a doc with task nodes always contains `"type":"task"`, so a
  // content string without the "task" substring can be skipped without any DB
  // work. (Narrow known gap: a save that REMOVED the last task node AND has no
  // other occurrence of "task" in the text skips the cleanup; the stale link
  // is swept on the next save that mentions tasks.) Reconciliation errors
  // never fail the save itself — content is already persisted.
  if (!note) return;
  const contentStr = JSON.stringify(content);
  if (contentStr.includes('"task"')) {
    try {
      await tasksRepo.reconcileNoteTasks(ownerId, id, content);
    } catch (err) {
      console.error("[tasks] reconcile failed:", err);
    }
  }
  // Same cheap substring gate for note links — inline "note-link" chips AND
  // block "linked-note-card"s (same known gap: removing the last link node
  // while no matching text remains defers cleanup to the next linky save).
  if (
    contentStr.includes('"note-link"') ||
    contentStr.includes('"linked-note-card"')
  ) {
    try {
      await notesRepo.reconcileNoteLinks(ownerId, id, content);
    } catch (err) {
      console.error("[note-links] reconcile failed:", err);
    }
  }
}

// ---------------------------------------------------------------------------
// Tasks (first-class rows behind the editor's task nodes)
// ---------------------------------------------------------------------------

const TASK_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Create a task linked to a note. No revalidate: the task node lives in
 * unsaved editor state until the autosave persists it, so there is nothing on
 * the server-rendered side to refresh yet.
 */
export async function createTaskAction(
  noteId: string,
  title: string,
): Promise<{ id: string }> {
  const ownerId = await requireUserId();
  const task = await tasksRepo.createTask(
    ownerId,
    noteId,
    typeof title === "string" ? title : "",
  );
  return { id: task.id };
}

/**
 * Toggle/rename/set-due deliberately skip revalidatePath — the live editor is
 * the view, and a revalidation would remount it mid-edit.
 */
export async function toggleTaskAction(
  taskId: string,
  completed: boolean,
): Promise<void> {
  const ownerId = await requireUserId();
  await tasksRepo.toggleTask(ownerId, taskId, completed === true);
}

export async function renameTaskAction(
  taskId: string,
  title: string,
): Promise<void> {
  const ownerId = await requireUserId();
  await tasksRepo.renameTask(
    ownerId,
    taskId,
    typeof title === "string" ? title : "",
  );
}

/** `dateStr` is YYYY-MM-DD (stored as midnight UTC, like dailyDate) or null to clear. */
export async function setTaskDueAction(
  taskId: string,
  dateStr: string | null,
): Promise<void> {
  const ownerId = await requireUserId();
  let dueAt: Date | null = null;
  if (dateStr !== null) {
    if (typeof dateStr !== "string" || !TASK_DATE_RE.test(dateStr)) {
      throw new Error("Invalid due date");
    }
    dueAt = new Date(`${dateStr}T00:00:00.000Z`);
  }
  await tasksRepo.setTaskDue(ownerId, taskId, dueAt);
}

/** Plain-serializable due/overdue task for the Today page. */
export type DueTaskResult = {
  id: string;
  title: string;
  /** ISO timestamp (midnight UTC of the due day). */
  dueAt: string;
  /** A note containing the task, if any (first link wins). */
  noteId: string | null;
  /** Reminder wall-clock time "HH:MM" (bell chip), if any. */
  remindAt: string | null;
  /** Board (bubble) of the containing note, for the board-dot chip. */
  boardTitle: string | null;
  boardColor: string | null;
  /** Recurrence rule behind the task (repeat chip), if any. */
  recurring: RecurrenceSpec | null;
};

function toDueTaskResult(t: tasksRepo.OpenTaskRow): DueTaskResult {
  return {
    id: t.id,
    title: t.title,
    dueAt: t.dueAt.toISOString(),
    noteId: t.noteId,
    remindAt: t.remindAt,
    boardTitle: t.boardTitle,
    boardColor: t.boardColor,
    recurring: t.recurring,
  };
}

/**
 * Incomplete tasks due on or before the viewed local date (YYYY-MM-DD).
 * Materializes due recurring occurrences first, so a rule's task exists the
 * moment any due-list consumer looks at the day.
 *
 * `todayStr` (the client's REAL today) caps materialization: when viewing a
 * FUTURE day the ceiling must stay at today, or the materializer would jump
 * the recurrence cursor ahead and skip the occurrences in between. Listing
 * still uses the viewed `dateStr`. Omitted → ceiling is `dateStr` (today/past
 * callers, unchanged).
 */
export async function listTasksDueAction(
  dateStr: string,
  todayStr?: string,
): Promise<DueTaskResult[]> {
  const ownerId = await requireUserId();
  const ceiling =
    typeof todayStr === "string" && TASK_DATE_RE.test(todayStr) && todayStr < dateStr
      ? todayStr
      : dateStr;
  await recurringRepo.materializeDueOccurrences(ownerId, ceiling);
  const rows = await tasksRepo.listTasksDue(ownerId, dateStr);
  return rows.map(toDueTaskResult);
}

export interface RangeTaskResult {
  id: string;
  title: string;
  /** YYYY-MM-DD of the due day (dueAt is stored as that day's midnight UTC). */
  due: string;
  completed: boolean;
  /** "HH:MM" reminder wall-clock time, if set (display chip only). */
  remindAt: string | null;
}

/** Tasks (open + done) due inside the inclusive range — the calendar month feed. */
export async function listTasksForRangeAction(
  startStr: string,
  endStr: string,
): Promise<RangeTaskResult[]> {
  const ownerId = await requireUserId();
  const rows = await tasksRepo.listTasksInRange(ownerId, startStr, endStr);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    due: r.dueAt.toISOString().slice(0, 10),
    completed: r.completedAt !== null,
    remindAt: r.remindAt,
  }));
}

/** Days (YYYY-MM-DD) with open tasks due in the inclusive range — calendar dots. */
export async function listTaskDueDatesAction(
  startStr: string,
  endStr: string,
): Promise<string[]> {
  const ownerId = await requireUserId();
  return tasksRepo.listTaskDueDates(ownerId, startStr, endStr);
}

/** Incomplete tasks due strictly after the client's local date, soonest first. */
export async function listTasksUpcomingAction(
  dateStr: string,
): Promise<DueTaskResult[]> {
  const ownerId = await requireUserId();
  const rows = await tasksRepo.listTasksUpcoming(ownerId, dateStr);
  return rows.map(toDueTaskResult);
}

/** Create a note-less task due on the client's local date (task dock input). */
export async function createStandaloneTaskAction(
  title: string,
  dateStr: string | null,
): Promise<{ id: string }> {
  const ownerId = await requireUserId();
  let dueAt: Date | null = null;
  if (dateStr !== null) {
    if (typeof dateStr !== "string" || !TASK_DATE_RE.test(dateStr)) {
      throw new Error("Invalid due date");
    }
    dueAt = new Date(`${dateStr}T00:00:00.000Z`);
  }
  const task = await tasksRepo.createStandaloneTask(
    ownerId,
    typeof title === "string" ? title : "",
    dueAt,
  );
  return { id: task.id };
}

/** Plain-serializable completed task for the dock's Done section. */
export type DoneTaskResult = { id: string; title: string };

/** Tasks completed within the client's local day [startIso, endIso). */
export async function listTasksDoneAction(
  startIso: string,
  endIso: string,
): Promise<DoneTaskResult[]> {
  const ownerId = await requireUserId();
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid range");
  }
  const rows = await tasksRepo.listTasksCompletedBetween(ownerId, start, end);
  return rows.map((t) => ({ id: t.id, title: t.title }));
}

// ---------------------------------------------------------------------------
// Recurring tasks (rules; occurrences materialize into ordinary tasks)
// ---------------------------------------------------------------------------

/** Plain-serializable recurrence rule for the Tasks page. */
export type RecurringRuleResult = {
  id: string;
  title: string;
  spec: RecurrenceSpec;
  paused: boolean;
  anchorDate: string;
  lastDate: string | null;
  /** Whether this rule is tracked as a habit (design 16b). */
  isHabit: boolean;
  /** false = structured "Recurring task"; true = typed "Rule" (section split). */
  isRule: boolean;
};

function toRuleResult(
  rule: NonNullable<Awaited<ReturnType<typeof recurringRepo.updateRecurringTask>>>,
): RecurringRuleResult {
  return {
    id: rule.id,
    title: rule.title,
    spec: recurringRepo.specOf(rule),
    paused: rule.paused,
    anchorDate: rule.anchorDate,
    lastDate: rule.lastDate,
    isHabit: rule.isHabit,
    isRule: rule.isRule,
  };
}

const TIME_STR_RE = /^\d{2}:\d{2}$/;

/**
 * Validate + normalize a client-supplied recurrence spec for the structured
 * picker. Throws on anything malformed so a bad payload never reaches the DB.
 */
function sanitizeSpec(spec: RecurrenceSpec): RecurrenceSpec {
  const remindAt =
    typeof spec?.remindAt === "string" && TIME_STR_RE.test(spec.remindAt)
      ? spec.remindAt
      : null;
  switch (spec?.freq) {
    case "daily":
      return { freq: "daily", weekday: null, intervalDays: null, monthDay: null, remindAt };
    case "weekly": {
      const wd = Number(spec.weekday);
      if (!Number.isInteger(wd) || wd < 0 || wd > 6) throw new Error("Invalid weekday");
      return { freq: "weekly", weekday: wd, intervalDays: null, monthDay: null, remindAt };
    }
    case "interval": {
      const n = Number(spec.intervalDays);
      if (!Number.isInteger(n) || n < 1 || n > 365) throw new Error("Invalid interval");
      return { freq: "interval", weekday: null, intervalDays: n, monthDay: null, remindAt };
    }
    case "monthly": {
      const md = Number(spec.monthDay);
      if (!Number.isInteger(md) || md < 1 || md > 31) throw new Error("Invalid month day");
      return { freq: "monthly", weekday: null, intervalDays: null, monthDay: md, remindAt };
    }
    default:
      throw new Error("Invalid frequency");
  }
}

export async function listRecurringTasksAction(): Promise<
  RecurringRuleResult[]
> {
  const ownerId = await requireUserId();
  const rules = await recurringRepo.listRecurringTasks(ownerId);
  return rules.map(toRuleResult);
}

/**
 * Create a rule from a natural-language phrase ("review inbox every friday
 * 4pm"). `dateStr` is the client's local day — it anchors the schedule.
 * Returns null when the phrase has no recognizable recurrence.
 */
export async function createRecurringTaskAction(
  input: string,
  dateStr: string,
): Promise<RecurringRuleResult | null> {
  const ownerId = await requireUserId();
  if (typeof input !== "string" || !TASK_DATE_RE.test(dateStr)) return null;
  const parsed = parseRecurrenceInput(input, dateStr);
  if (!parsed) return null;
  const rule = await recurringRepo.createRecurringTask(
    ownerId,
    parsed.title,
    parsed.spec,
    dateStr,
    true, // typed phrase → lives in the "Rules" section
  );
  return toRuleResult(rule);
}

/**
 * Create a recurring task from the structured schedule picker (frequency +
 * day/interval + optional reminder time). Unlike the NL path this never
 * "fails to parse" — the client already assembled a valid spec.
 */
export async function createRecurringTaskStructuredAction(
  title: string,
  spec: RecurrenceSpec,
  dateStr: string,
): Promise<RecurringRuleResult> {
  const ownerId = await requireUserId();
  if (!TASK_DATE_RE.test(dateStr)) throw new Error("Invalid date");
  const cleanTitle = (typeof title === "string" ? title : "").trim().slice(0, 500);
  if (!cleanTitle) throw new Error("Title required");
  const rule = await recurringRepo.createRecurringTask(
    ownerId,
    cleanTitle,
    sanitizeSpec(spec),
    dateStr,
    false, // structured → lives in the "Recurring tasks" section
  );
  return toRuleResult(rule);
}

/** Reschedule a recurring task from the structured picker. */
export async function updateRecurringTaskStructuredAction(
  id: string,
  title: string,
  spec: RecurrenceSpec,
  dateStr: string,
): Promise<RecurringRuleResult | null> {
  const ownerId = await requireUserId();
  if (!TASK_DATE_RE.test(dateStr)) throw new Error("Invalid date");
  const cleanTitle = (typeof title === "string" ? title : "").trim().slice(0, 500);
  if (!cleanTitle) throw new Error("Title required");
  const rule = await recurringRepo.updateRecurringTask(
    ownerId,
    id,
    cleanTitle,
    sanitizeSpec(spec),
    dateStr,
  );
  return rule ? toRuleResult(rule) : null;
}

/** Reschedule a rule from a re-edited phrase; null when it doesn't parse. */
export async function updateRecurringTaskAction(
  id: string,
  input: string,
  dateStr: string,
): Promise<RecurringRuleResult | null> {
  const ownerId = await requireUserId();
  if (typeof input !== "string" || !TASK_DATE_RE.test(dateStr)) return null;
  const parsed = parseRecurrenceInput(input, dateStr);
  if (!parsed) return null;
  const rule = await recurringRepo.updateRecurringTask(
    ownerId,
    id,
    parsed.title,
    parsed.spec,
    dateStr,
  );
  return rule ? toRuleResult(rule) : null;
}

export async function setRecurringPausedAction(
  id: string,
  paused: boolean,
): Promise<void> {
  const ownerId = await requireUserId();
  await recurringRepo.setRecurringPaused(ownerId, id, paused === true);
}

export async function deleteRecurringTaskAction(id: string): Promise<void> {
  const ownerId = await requireUserId();
  await recurringRepo.deleteRecurringTask(ownerId, id);
}

// ---------------------------------------------------------------------------
// Folders (bubbles with isFolder — THE folder system; see ROADMAP.md)
// ---------------------------------------------------------------------------

/** Plain-serializable folder bubble for the editor's "move to folder" menu. */
export type FolderBubbleResult = {
  id: string;
  title: string;
  emoji: string | null;
};

/** Folder bubbles (isFolder), ordered by title. */
export async function listFolderBubblesAction(): Promise<FolderBubbleResult[]> {
  const ownerId = await requireUserId();
  const rows = await bubblesRepo.listFolderBubbles(ownerId);
  return rows.map((b) => ({ id: b.id, title: b.title, emoji: b.emoji }));
}

/**
 * Move a note into a bubble folder, or out to the standalone list (null).
 * Revalidates the layout so the sidebar (folders + notes list) updates.
 */
export async function moveNoteToBubbleAction(
  noteId: string,
  bubbleId: string | null,
): Promise<void> {
  const ownerId = await requireUserId();
  await notesRepo.moveNoteToBubble(ownerId, noteId, bubbleId);
  revalidatePath("/app", "layout");
}

/**
 * Soft-delete (move to Trash). No redirect here — callers decide where to go
 * (the full-page note view navigates to /app/notes; dock windows and quick
 * view just close themselves).
 */
export async function trashNoteAction(id: string): Promise<void> {
  const ownerId = await requireUserId();
  await notesRepo.trashNote(ownerId, id);
  revalidatePath("/app", "layout");
}

/**
 * Duplicate a live note: new row, "<title> (copy)" title, same bubble/content,
 * but never a `dailyDate` (unique per day) and with the source's note_tasks
 * links replicated so shared tasks still appear in both notes.
 */
export async function duplicateNoteAction(id: string): Promise<{ id: string }> {
  const ownerId = await requireUserId();
  const note = await notesRepo.duplicateNote(ownerId, id);
  if (!note) throw new Error("Note not found");
  revalidatePath("/app", "layout");
  return { id: note.id };
}

/** Restore a note from the Trash (a daily-date collision restores it as a regular note). */
export async function restoreNoteAction(id: string): Promise<void> {
  const ownerId = await requireUserId();
  await notesRepo.restoreNote(ownerId, id);
  revalidatePath("/app", "layout");
  revalidatePath("/app/trash");
}

/** Permanently delete a trashed note. */
export async function purgeNoteAction(id: string): Promise<void> {
  const ownerId = await requireUserId();
  await notesRepo.purgeNote(ownerId, id);
  revalidatePath("/app", "layout");
  revalidatePath("/app/trash");
}

/**
 * Permanently delete every trashed note (the Trash page's "Empty trash"
 * action, behind an inline confirm in the UI). Returns the count removed so
 * the confirm copy can read back "Deleted N notes" if the caller wants it.
 */
export async function emptyTrashAction(): Promise<{ count: number }> {
  const ownerId = await requireUserId();
  const count = await notesRepo.purgeAllTrashedNotes(ownerId);
  revalidatePath("/app", "layout");
  revalidatePath("/app/trash");
  return { count };
}
