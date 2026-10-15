"use server";

import { revalidatePath } from "next/cache";

import type { RecurrenceSpec } from "@/lib/recurrence";
import * as recurringRepo from "@/server/recurring";
import * as tagsRepo from "@/server/tags";
import * as tasksRepo from "@/server/tasks";

import { createStandaloneTaskAction, type TagResult } from "../actions";
import { requireOwnerId } from "../owner";

/**
 * Server actions for the desktop Tasks page (Notes Sidebars design §5b):
 * the smart/subject/tag lists' single payload, the Logbook, subtasks, the
 * Someday flag, a task's time of day and the list-aware quick-add.
 *
 * Toggling, renaming, due dates, notes, importance, tags and deletes reuse
 * the existing task actions in `../actions.ts`. Everything here is plain HTTP
 * underneath, so inputs are validated at runtime. The page loads its data
 * client-side; `revalidatePath` only keeps the router cache honest for the
 * next visit.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    throw new Error("Invalid id");
  }
}

/** Plain-serializable row of any Tasks-page list. */
export type ListTaskResult = {
  id: string;
  title: string;
  description: string | null;
  /** YYYY-MM-DD local due day (stored as that day's midnight UTC), or null. */
  due: string | null;
  /** "HH:MM" time of day (also the reminder time), or null. */
  time: string | null;
  important: boolean;
  someday: boolean;
  /** ISO instants. */
  createdAt: string;
  completedAt: string | null;
  /** First live note the task sits on. */
  noteId: string | null;
  noteTitle: string | null;
  boardTitle: string | null;
  boardColor: string | null;
  recurring: RecurrenceSpec | null;
  tags: TagResult[];
  subtaskCount: number;
  subtaskDone: number;
};

function toResult(
  t: tasksRepo.ListTaskRow,
  tags: Map<string, TagResult[]>,
): ListTaskResult {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    due: t.dueAt ? t.dueAt.toISOString().slice(0, 10) : null,
    time: t.remindAt,
    important: t.important,
    someday: t.someday,
    createdAt: t.createdAt.toISOString(),
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    noteId: t.noteId,
    noteTitle: t.noteTitle,
    boardTitle: t.boardTitle,
    boardColor: t.boardColor,
    recurring: t.recurring,
    tags: tags.get(t.id) ?? [],
    subtaskCount: t.subtaskCount,
    subtaskDone: t.subtaskDone,
  };
}

async function withTags(
  ownerId: string,
  rows: tasksRepo.ListTaskRow[],
): Promise<ListTaskResult[]> {
  const tags = await tagsRepo.listTagsForTasks(
    ownerId,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toResult(r, tags));
}

/**
 * Every open top-level task — the page cuts Inbox/Today/Upcoming/Anytime/
 * Someday and the subject/tag lists from this client-side. Materializes due
 * recurring occurrences first (same as the old Tasks page), with the client's
 * local `todayStr` as the ceiling.
 */
export async function getTaskListsAction(
  todayStr: string,
): Promise<ListTaskResult[]> {
  const ownerId = await requireOwnerId();
  if (typeof todayStr !== "string" || !DATE_RE.test(todayStr)) {
    throw new Error("Invalid date");
  }
  await recurringRepo.materializeDueOccurrences(ownerId, todayStr);
  return withTags(ownerId, await tasksRepo.listOpenTasksForLists(ownerId));
}

/** Completed top-level tasks, most recently completed first. */
export async function listLogbookAction(
  limit = 100,
): Promise<ListTaskResult[]> {
  const ownerId = await requireOwnerId();
  const n = typeof limit === "number" && Number.isFinite(limit) ? limit : 100;
  return withTags(ownerId, await tasksRepo.listLogbookTasks(ownerId, n));
}

export type SubtaskResult = { id: string; title: string; done: boolean };

export async function listSubtasksAction(
  parentId: string,
): Promise<SubtaskResult[]> {
  const ownerId = await requireOwnerId();
  assertId(parentId);
  const rows = await tasksRepo.listSubtasks(ownerId, parentId);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    done: r.completedAt !== null,
  }));
}

/** Add a subtask; null when the parent isn't the owner's top-level task. */
export async function createSubtaskAction(
  parentId: string,
  title: string,
): Promise<SubtaskResult | null> {
  const ownerId = await requireOwnerId();
  assertId(parentId);
  const text = typeof title === "string" ? title.trim() : "";
  if (!text) return null;
  const row = await tasksRepo.createSubtask(ownerId, parentId, text);
  revalidatePath("/app/tasks");
  return row ? { id: row.id, title: row.title, done: false } : null;
}

export async function setTaskSomedayAction(
  taskId: string,
  someday: boolean,
): Promise<void> {
  const ownerId = await requireOwnerId();
  assertId(taskId);
  await tasksRepo.setTaskSomeday(ownerId, taskId, someday === true);
  revalidatePath("/app/tasks");
}

/** Time of day "HH:MM" (or null to clear) — also the task's reminder time. */
export async function setTaskTimeAction(
  taskId: string,
  time: string | null,
): Promise<void> {
  const ownerId = await requireOwnerId();
  assertId(taskId);
  if (time !== null && (typeof time !== "string" || !TIME_RE.test(time))) {
    throw new Error("Invalid time");
  }
  await tasksRepo.setTaskTime(ownerId, taskId, time);
  revalidatePath("/app/tasks");
}

/**
 * Quick-add for a list: `createStandaloneTaskAction` (which parses `#tags`
 * and `!`), then whatever puts the task in the list it was typed into — the
 * Someday flag, or the selected subject/tag. Returns the full row so the page
 * can render it without a refetch.
 */
export async function createTaskInListAction(
  title: string,
  opts: { due: string | null; someday: boolean; tagId: string | null },
): Promise<ListTaskResult> {
  const ownerId = await requireOwnerId();
  const due =
    opts && typeof opts.due === "string" && DATE_RE.test(opts.due)
      ? opts.due
      : null;
  const created = await createStandaloneTaskAction(title, due);
  if (opts?.someday === true) {
    await tasksRepo.setTaskSomeday(ownerId, created.id, true);
  }
  let tags = created.tags;
  if (
    typeof opts?.tagId === "string" &&
    UUID_RE.test(opts.tagId) &&
    !tags.some((t) => t.id === opts.tagId)
  ) {
    try {
      tags = await tagsRepo.addTaskTags(ownerId, created.id, [opts.tagId]);
    } catch (err) {
      // The task exists either way; losing the list's tag mustn't lose it.
      console.error("[tasks] list tag on create failed:", err);
    }
  }
  revalidatePath("/app/tasks");
  const now = new Date().toISOString();
  return {
    id: created.id,
    title: created.title,
    description: null,
    due,
    time: null,
    important: created.important,
    someday: opts?.someday === true,
    createdAt: now,
    completedAt: null,
    noteId: null,
    noteTitle: null,
    boardTitle: null,
    boardColor: null,
    recurring: null,
    tags,
    subtaskCount: 0,
    subtaskDone: 0,
  };
}
