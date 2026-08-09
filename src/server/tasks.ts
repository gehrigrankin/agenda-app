import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  notInArray,
  or,
} from "drizzle-orm";
import type { SerializedEditorState } from "lexical";

import { db } from "@/db";
import {
  bubbles,
  notes,
  noteTasks,
  recurringTasks,
  tasks,
  type Task,
} from "@/db/schema";
import type { RecurrenceSpec } from "@/lib/recurrence";

import { escapeLikePattern, getNote } from "./notes";

/**
 * Data-access layer for tasks. Tasks are FIRST-CLASS rows (see schema notes):
 * a task node in the editor only caches title/completed/dueAt — these rows are
 * the source of truth, and `note_tasks` records which notes a task appears in.
 */

const TITLE_MAX = 500;
const DESCRIPTION_MAX = 5000;
const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Habits are not tasks (CONTEXT.md, product coherence): occurrences of an
 * `isHabit` recurrence rule must never leave this module through a
 * task-shaped read — they'd show up as overdue "carried" rows next to their
 * gentle habit-strip dot. Every list/read below joins `recurring_tasks` and
 * applies this predicate; only the habits repo reads those rows.
 * (Mutations stay habit-agnostic — the habits repo completes rows through
 * them.)
 */
const notHabitOccurrence = or(
  isNull(recurringTasks.id),
  eq(recurringTasks.isHabit, false),
);

function sanitizeTitle(title: string): string {
  return title.trim().slice(0, TITLE_MAX) || "Untitled task";
}

/**
 * Create a task and link it to the note it was typed into. Verifies the note
 * belongs to the owner first. No transaction (Neon HTTP): if the link insert
 * fails after the task insert, the task is a linkless orphan the next
 * reconciliation pass won't touch — harmless, and the user simply retries.
 */
export async function createTask(
  ownerId: string,
  noteId: string,
  title: string,
) {
  const note = await getNote(ownerId, noteId);
  if (!note || note.deletedAt) throw new Error("Note not found");

  const [task] = await db
    .insert(tasks)
    .values({ ownerId, title: sanitizeTitle(title) })
    .returning();
  await db
    .insert(noteTasks)
    .values({ noteId, taskId: task.id })
    .onConflictDoNothing();
  return task;
}

/** One task by id. No habit filter: an id lookup asks for that exact row. */
export async function getTask(
  ownerId: string,
  taskId: string,
): Promise<Task | null> {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.ownerId, ownerId)))
    .limit(1);
  return task ?? null;
}

export async function toggleTask(
  ownerId: string,
  taskId: string,
  completed: boolean,
) {
  const [task] = await db
    .update(tasks)
    .set({ completedAt: completed ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.ownerId, ownerId)))
    .returning();
  return task ?? null;
}

export async function renameTask(
  ownerId: string,
  taskId: string,
  title: string,
) {
  const [task] = await db
    .update(tasks)
    .set({ title: sanitizeTitle(title), updatedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.ownerId, ownerId)))
    .returning();
  return task ?? null;
}

/**
 * Patch a task's title and/or description. Kept separate from `renameTask`
 * rather than widening it: `description` had no writer anywhere but
 * `POST /api/tasks` before this, so every renameTask caller is a title-only
 * editor path and folding the two together would invite blanking a body by
 * omission. Same reason only `!== undefined` fields are written here — a
 * caller patching just the description must not wipe the title.
 */
export async function updateTask(
  ownerId: string,
  taskId: string,
  data: { title?: string; description?: string | null; important?: boolean },
): Promise<Task | null> {
  // A patch that names no field is a read: issuing an UPDATE would only bump
  // updatedAt and make the task look edited when nothing changed.
  if (
    data.title === undefined &&
    data.description === undefined &&
    data.important === undefined
  ) {
    return getTask(ownerId, taskId);
  }

  const set: {
    title?: string;
    description?: string | null;
    important?: boolean;
    updatedAt: Date;
  } = {
    updatedAt: new Date(),
  };
  if (data.title !== undefined) set.title = sanitizeTitle(data.title);
  if (data.important !== undefined) set.important = data.important;
  if (data.description !== undefined) {
    // Whitespace-only reads as "cleared", so it stores as null rather than as
    // a body that renders blank but counts as present.
    set.description = data.description?.trim().slice(0, DESCRIPTION_MAX) || null;
  }

  const [task] = await db
    .update(tasks)
    .set(set)
    .where(and(eq(tasks.id, taskId), eq(tasks.ownerId, ownerId)))
    .returning();
  return task ?? null;
}

export async function setTaskDue(
  ownerId: string,
  taskId: string,
  dueAt: Date | null,
) {
  const [task] = await db
    .update(tasks)
    .set({ dueAt, updatedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.ownerId, ownerId)))
    .returning();
  return task ?? null;
}

/**
 * Create a task with no note link (typed into the daily map's task dock).
 * `dueAt` is midnight UTC of the client's local date, matching setTaskDue.
 */
export async function createStandaloneTask(
  ownerId: string,
  title: string,
  dueAt: Date | null,
  important = false,
) {
  const [task] = await db
    .insert(tasks)
    .values({ ownerId, title: sanitizeTitle(title), dueAt, important })
    .returning();
  return task;
}

/**
 * Flip the "this one actually matters" flag. Separate from `updateTask` so the
 * row-level star has a one-argument action to call optimistically; both write
 * the same column.
 */
export async function setTaskImportant(
  ownerId: string,
  taskId: string,
  important: boolean,
) {
  const [task] = await db
    .update(tasks)
    .set({ important, updatedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.ownerId, ownerId)))
    .returning();
  return task ?? null;
}

/**
 * Tasks completed within [start, end) — the client supplies its local day's
 * absolute bounds since completedAt is a real instant, not a calendar date.
 */
export async function listTasksCompletedBetween(
  ownerId: string,
  start: Date,
  end: Date,
) {
  return db
    .select({ id: tasks.id, title: tasks.title, completedAt: tasks.completedAt })
    .from(tasks)
    .leftJoin(recurringTasks, eq(recurringTasks.id, tasks.recurringTaskId))
    .where(
      and(
        eq(tasks.ownerId, ownerId),
        isNotNull(tasks.completedAt),
        gte(tasks.completedAt, start),
        lt(tasks.completedAt, end),
        notHabitOccurrence,
      ),
    )
    .orderBy(asc(tasks.completedAt));
}

/**
 * Incomplete tasks due on — or overdue as of — the user's local date
 * (`dateStr` = YYYY-MM-DD from the client, same convention as daily jots).
 * Due dates are stored as midnight UTC of the chosen day, so "due by the end
 * of dateStr" is simply `dueAt < next-day midnight UTC`.
 *
 * Left-joined to note_tasks for a note to link to; a task linked to several
 * notes is deduped to its first link, and an unlinked task yields noteId null.
 */
export async function listTasksDue(ownerId: string, dateStr: string) {
  if (!DATE_STR_RE.test(dateStr)) {
    throw new Error(`Invalid date: ${dateStr}`);
  }
  const [y, m, d] = dateStr.split("-").map(Number);
  // Date.UTC normalizes overflow (Jan 32 -> Feb 1), so +1 day is safe.
  const endExclusive = new Date(Date.UTC(y, m - 1, d + 1));

  const rows = await db
    .select(openTaskColumns)
    .from(tasks)
    .leftJoin(noteTasks, eq(noteTasks.taskId, tasks.id))
    // Trashed notes don't count as a home for the task: the link chip would
    // 404. The task itself still lists (left join), just without a note.
    .leftJoin(
      notes,
      and(eq(notes.id, noteTasks.noteId), isNull(notes.deletedAt)),
    )
    .leftJoin(bubbles, eq(bubbles.id, notes.bubbleId))
    .leftJoin(recurringTasks, eq(recurringTasks.id, tasks.recurringTaskId))
    .where(
      and(
        eq(tasks.ownerId, ownerId),
        isNull(tasks.completedAt),
        isNotNull(tasks.dueAt),
        lt(tasks.dueAt, endExclusive),
        notHabitOccurrence,
      ),
    )
    .orderBy(asc(tasks.dueAt));

  return dedupeOpenTasks(rows);
}

/**
 * Distinct days (YYYY-MM-DD) with OPEN tasks due between startStr and endStr
 * inclusive — the calendar's "something is due here" indicator. Due dates are
 * midnight-UTC of the local day, so the date part of the ISO string is the
 * local day by construction.
 */
export async function listTaskDueDates(
  ownerId: string,
  startStr: string,
  endStr: string,
): Promise<string[]> {
  if (!DATE_STR_RE.test(startStr) || !DATE_STR_RE.test(endStr)) {
    throw new Error("Invalid date range");
  }
  const start = new Date(`${startStr}T00:00:00.000Z`);
  const [y, m, d] = endStr.split("-").map(Number);
  const endExclusive = new Date(Date.UTC(y, m - 1, d + 1));

  const rows = await db
    .select({ dueAt: tasks.dueAt })
    .from(tasks)
    .leftJoin(recurringTasks, eq(recurringTasks.id, tasks.recurringTaskId))
    .where(
      and(
        eq(tasks.ownerId, ownerId),
        isNull(tasks.completedAt),
        isNotNull(tasks.dueAt),
        gte(tasks.dueAt, start),
        lt(tasks.dueAt, endExclusive),
        notHabitOccurrence,
      ),
    );

  const days = new Set<string>();
  for (const r of rows) {
    if (r.dueAt) days.add(r.dueAt.toISOString().slice(0, 10));
  }
  return [...days].sort();
}

/**
 * All tasks (open and completed) with a due date inside [startStr, endStr]
 * inclusive — the calendar page's month feed. Lean columns on purpose.
 */
export async function listTasksInRange(
  ownerId: string,
  startStr: string,
  endStr: string,
): Promise<
  {
    id: string;
    title: string;
    dueAt: Date;
    completedAt: Date | null;
    remindAt: string | null;
  }[]
> {
  if (!DATE_STR_RE.test(startStr) || !DATE_STR_RE.test(endStr)) {
    throw new Error("Invalid date range");
  }
  const start = new Date(`${startStr}T00:00:00.000Z`);
  const [y, m, d] = endStr.split("-").map(Number);
  const endExclusive = new Date(Date.UTC(y, m - 1, d + 1));

  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      dueAt: tasks.dueAt,
      completedAt: tasks.completedAt,
      remindAt: tasks.remindAtLocal,
    })
    .from(tasks)
    .leftJoin(recurringTasks, eq(recurringTasks.id, tasks.recurringTaskId))
    .where(
      and(
        eq(tasks.ownerId, ownerId),
        isNotNull(tasks.dueAt),
        gte(tasks.dueAt, start),
        lt(tasks.dueAt, endExclusive),
        notHabitOccurrence,
      ),
    )
    .orderBy(asc(tasks.dueAt));

  return rows.filter((r): r is typeof r & { dueAt: Date } => r.dueAt !== null);
}

/** Incomplete tasks due strictly AFTER the user's local date, soonest first. */
export async function listTasksUpcoming(
  ownerId: string,
  dateStr: string,
  limit = 30,
) {
  if (!DATE_STR_RE.test(dateStr)) {
    throw new Error(`Invalid date: ${dateStr}`);
  }
  const [y, m, d] = dateStr.split("-").map(Number);
  const startInclusive = new Date(Date.UTC(y, m - 1, d + 1));

  const rows = await db
    .select(openTaskColumns)
    .from(tasks)
    .leftJoin(noteTasks, eq(noteTasks.taskId, tasks.id))
    // Same trashed-note exclusion as listTasksDue above.
    .leftJoin(
      notes,
      and(eq(notes.id, noteTasks.noteId), isNull(notes.deletedAt)),
    )
    .leftJoin(bubbles, eq(bubbles.id, notes.bubbleId))
    .leftJoin(recurringTasks, eq(recurringTasks.id, tasks.recurringTaskId))
    .where(
      and(
        eq(tasks.ownerId, ownerId),
        isNull(tasks.completedAt),
        isNotNull(tasks.dueAt),
        gte(tasks.dueAt, startInclusive),
        notHabitOccurrence,
      ),
    )
    .orderBy(asc(tasks.dueAt))
    // Dedupe below collapses multi-note links, so over-fetch a little.
    .limit(limit * 2);

  return dedupeOpenTasks(rows).slice(0, limit);
}

export type UnscheduledTaskRow = {
  id: string;
  title: string;
  createdAt: Date;
  important: boolean;
  noteId: string | null;
  noteTitle: string | null;
  boardTitle: string | null;
  boardColor: string | null;
};

/**
 * Open tasks with NO due date, newest first — the Tasks page's "Unscheduled"
 * section, so captured-but-never-scheduled tasks stay visible instead of
 * silently accumulating. Same live-note left-join pattern as listTasksDue
 * (first live link wins; a link to a trashed note reads as "no note"), plus
 * the note's title for the source-note chip. Recurrence columns are omitted:
 * materialized occurrences always carry a due date, so they can't land here.
 */
export async function listTasksUnscheduled(
  ownerId: string,
  limit = 50,
): Promise<UnscheduledTaskRow[]> {
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      createdAt: tasks.createdAt,
      important: tasks.important,
      noteId: notes.id,
      noteTitle: notes.title,
      boardTitle: bubbles.title,
      boardColor: bubbles.color,
    })
    .from(tasks)
    .leftJoin(noteTasks, eq(noteTasks.taskId, tasks.id))
    // Trashed notes don't count as a home for the task (see listTasksDue).
    .leftJoin(
      notes,
      and(eq(notes.id, noteTasks.noteId), isNull(notes.deletedAt)),
    )
    .leftJoin(bubbles, eq(bubbles.id, notes.bubbleId))
    .leftJoin(recurringTasks, eq(recurringTasks.id, tasks.recurringTaskId))
    .where(
      and(
        eq(tasks.ownerId, ownerId),
        isNull(tasks.completedAt),
        isNull(tasks.dueAt),
        notHabitOccurrence,
      ),
    )
    .orderBy(desc(tasks.createdAt))
    // Dedupe below collapses multi-note links, so over-fetch a little.
    .limit(limit * 2);

  return dedupeByLiveNoteLink(rows).slice(0, limit);
}

/** The note/board columns the note-chip lists select alongside their own. */
type NoteLinkColumns = {
  id: string;
  noteId: string | null;
  noteTitle: string | null;
  boardTitle: string | null;
  boardColor: string | null;
};

/**
 * Collapse the one-row-per-note-link fan-out of the note-chip lists (see
 * `dedupeOpenTasks`, which does the same for the due lists but carries
 * recurrence instead of a note title): first row per task wins, except that a
 * trashed link (noteId null) is upgraded when a live one comes along.
 */
function dedupeByLiveNoteLink<T extends NoteLinkColumns>(rows: T[]): T[] {
  const seen = new Map<string, T>();
  const result: T[] = [];
  for (const row of rows) {
    const existing = seen.get(row.id);
    if (existing) {
      if (existing.noteId === null && row.noteId !== null) {
        existing.noteId = row.noteId;
        existing.noteTitle = row.noteTitle;
        existing.boardTitle = row.boardTitle;
        existing.boardColor = row.boardColor;
      }
      continue;
    }
    const entry = { ...row };
    seen.set(row.id, entry);
    result.push(entry);
  }
  return result;
}

export type RecentTaskRow = NoteLinkColumns & {
  title: string;
  createdAt: Date;
  important: boolean;
  /** Null for tasks captured without a date (they also sit in Unscheduled). */
  dueAt: Date | null;
};

/**
 * Open tasks by capture time, newest first — the Tasks page's "Recently added"
 * lens, which cuts across Today/Upcoming/Unscheduled so a batch of just-captured
 * tasks can be reviewed as a batch. Same live-note left-join as the lists above.
 *
 * Occurrences of recurrence rules are excluded (`recurringTaskId` is null): the
 * materializer stamps a fresh row every day a rule fires, so a couple of daily
 * rules would otherwise crowd out everything the user actually added.
 */
export async function listTasksRecentlyAdded(
  ownerId: string,
  limit = 25,
): Promise<RecentTaskRow[]> {
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      createdAt: tasks.createdAt,
      dueAt: tasks.dueAt,
      important: tasks.important,
      noteId: notes.id,
      noteTitle: notes.title,
      boardTitle: bubbles.title,
      boardColor: bubbles.color,
    })
    .from(tasks)
    .leftJoin(noteTasks, eq(noteTasks.taskId, tasks.id))
    // Trashed notes don't count as a home for the task (see listTasksDue).
    .leftJoin(
      notes,
      and(eq(notes.id, noteTasks.noteId), isNull(notes.deletedAt)),
    )
    .leftJoin(bubbles, eq(bubbles.id, notes.bubbleId))
    .where(
      and(
        eq(tasks.ownerId, ownerId),
        isNull(tasks.completedAt),
        isNull(tasks.recurringTaskId),
      ),
    )
    .orderBy(desc(tasks.createdAt))
    // Dedupe below collapses multi-note links, so over-fetch a little.
    .limit(limit * 2);

  return dedupeByLiveNoteLink(rows).slice(0, limit);
}

/**
 * Shared row shape for the open-task lists: the containing note (first link
 * wins), its board (bubble) chip, and the recurrence rule behind the task.
 */
const openTaskColumns = {
  id: tasks.id,
  title: tasks.title,
  dueAt: tasks.dueAt,
  important: tasks.important,
  remindAt: tasks.remindAtLocal,
  // From the (trash-filtered) notes join, NOT noteTasks: a link to a trashed
  // note must read as "no note", not as a note id that 404s.
  noteId: notes.id,
  boardTitle: bubbles.title,
  boardColor: bubbles.color,
  ruleFreq: recurringTasks.freq,
  ruleWeekday: recurringTasks.weekday,
  ruleIntervalDays: recurringTasks.intervalDays,
  ruleMonthDay: recurringTasks.monthDay,
};

export type OpenTaskRow = {
  id: string;
  title: string;
  dueAt: Date;
  important: boolean;
  remindAt: string | null;
  noteId: string | null;
  boardTitle: string | null;
  boardColor: string | null;
  recurring: RecurrenceSpec | null;
};

function dedupeOpenTasks(
  rows: Array<
    Omit<OpenTaskRow, "dueAt" | "recurring"> & {
      dueAt: Date | null;
      ruleFreq: RecurrenceSpec["freq"] | null;
      ruleWeekday: number | null;
      ruleIntervalDays: number | null;
      ruleMonthDay: number | null;
    }
  >,
): OpenTaskRow[] {
  const seen = new Map<string, OpenTaskRow>();
  const result: OpenTaskRow[] = [];
  for (const row of rows) {
    if (row.dueAt === null) continue;
    const existing = seen.get(row.id);
    if (existing) {
      // A task can link to several notes and the first row may be a trashed
      // link (noteId null) — upgrade to a live link when one comes along.
      if (existing.noteId === null && row.noteId !== null) {
        existing.noteId = row.noteId;
        existing.boardTitle = row.boardTitle;
        existing.boardColor = row.boardColor;
      }
      continue;
    }
    const entry: OpenTaskRow = {
      id: row.id,
      title: row.title,
      dueAt: row.dueAt,
      important: row.important,
      remindAt: row.remindAt,
      noteId: row.noteId,
      boardTitle: row.boardTitle,
      boardColor: row.boardColor,
      recurring: row.ruleFreq
        ? {
            freq: row.ruleFreq,
            weekday: row.ruleWeekday,
            intervalDays: row.ruleIntervalDays,
            monthDay: row.ruleMonthDay,
            remindAt: row.remindAt,
          }
        : null,
    };
    seen.set(row.id, entry);
    result.push(entry);
  }
  return result;
}

/** Recursively collect taskIds of "task" nodes in serialized Lexical JSON. */
function collectTaskIds(node: unknown, out: Set<string>): void {
  if (node === null || typeof node !== "object") return;
  const n = node as { type?: unknown; taskId?: unknown; children?: unknown };
  if (n.type === "task" && typeof n.taskId === "string" && n.taskId) {
    out.add(n.taskId);
  }
  if (Array.isArray(n.children)) {
    for (const child of n.children) collectTaskIds(child, out);
  }
}

/**
 * How long a fresh note_tasks link is immune from stale-link deletion. Guards
 * a race with autosave: a debounced save can serialize the editor while a
 * just-created task node still has taskId null; without the grace period that
 * snapshot would unlink (and orphan-delete) the brand-new task before the
 * follow-up save carrying its taskId lands.
 */
const RECONCILE_GRACE_MS = 60_000;

/**
 * Sync note_tasks (and orphaned tasks) for a note against its just-saved
 * serialized content. `noteId` MUST already be owner-verified by the caller
 * (saveNoteContentAction only calls this after an owner-scoped update hit).
 *
 * No transactions on Neon HTTP, so operations are ordered crash-safe:
 *   1. insert missing links   (crash after: extra links, next save re-syncs)
 *   2. delete stale links     (crash after: unlinked tasks linger, harmless)
 *   3. delete orphaned tasks  (tasks whose last link was just removed — the
 *      user deleted the block from the doc)
 *
 * Known lingering-orphan case (accepted for MVP): deleting a NOTE outright
 * cascades away its note_tasks rows (FK ON DELETE CASCADE), so tasks that were
 * only linked to that note stick around with no links. They no longer surface
 * anywhere unless they had a due date; a periodic sweep can reap them later.
 */
export async function reconcileNoteTasks(
  ownerId: string,
  noteId: string,
  content: SerializedEditorState,
): Promise<void> {
  const ids = new Set<string>();
  collectTaskIds((content as { root?: unknown }).root, ids);

  // Only ever link tasks the owner actually owns — serialized content comes
  // from the client and could reference someone else's task ids.
  let keepIds: string[] = [];
  if (ids.size > 0) {
    const owned = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.ownerId, ownerId), inArray(tasks.id, [...ids])));
    keepIds = owned.map((r) => r.id);
  }

  // 1) Insert missing links.
  if (keepIds.length > 0) {
    await db
      .insert(noteTasks)
      .values(keepIds.map((taskId) => ({ noteId, taskId })))
      .onConflictDoNothing();
  }

  // 2) Delete links no longer present in the content (grace period above).
  const staleConditions = [
    eq(noteTasks.noteId, noteId),
    lt(noteTasks.createdAt, new Date(Date.now() - RECONCILE_GRACE_MS)),
  ];
  if (keepIds.length > 0) {
    staleConditions.push(notInArray(noteTasks.taskId, keepIds));
  }
  const removed = await db
    .delete(noteTasks)
    .where(and(...staleConditions))
    .returning({ taskId: noteTasks.taskId });

  // 3) Delete tasks that now have NO remaining links anywhere (only among the
  //    ones we just unlinked, so tasks created by other flows are never
  //    swept up).
  const removedIds = [...new Set(removed.map((r) => r.taskId))];
  if (removedIds.length === 0) return;
  const stillLinked = await db
    .select({ taskId: noteTasks.taskId })
    .from(noteTasks)
    .where(inArray(noteTasks.taskId, removedIds));
  const linkedSet = new Set(stillLinked.map((r) => r.taskId));
  const orphanIds = removedIds.filter((id) => !linkedSet.has(id));
  if (orphanIds.length > 0) {
    await db
      .delete(tasks)
      .where(and(eq(tasks.ownerId, ownerId), inArray(tasks.id, orphanIds)));
  }
}

/**
 * Case-insensitive open-task lookup by exact title — used by the automations
 * runner to keep rule execution idempotent (a rule that fires twice must not
 * create the same task twice).
 */
export async function findOpenTaskByTitle(ownerId: string, title: string) {
  const [row] = await db
    .select({ id: tasks.id, title: tasks.title })
    .from(tasks)
    .leftJoin(recurringTasks, eq(recurringTasks.id, tasks.recurringTaskId))
    .where(
      and(
        eq(tasks.ownerId, ownerId),
        isNull(tasks.completedAt),
        ilike(tasks.title, escapeLikePattern(title.trim())),
        // A same-titled habit occurrence must not satisfy "task exists".
        notHabitOccurrence,
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Hard-delete a task (automation undo). Join rows cascade. */
export async function deleteTask(ownerId: string, taskId: string) {
  const [row] = await db
    .delete(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.ownerId, ownerId)))
    .returning({ id: tasks.id });
  return row ?? null;
}

/** Open tasks appearing in a given note, in note order. */
export async function listOpenTasksForNote(ownerId: string, noteId: string) {
  return db
    .select({ id: tasks.id, title: tasks.title })
    .from(noteTasks)
    .innerJoin(tasks, eq(noteTasks.taskId, tasks.id))
    .leftJoin(recurringTasks, eq(recurringTasks.id, tasks.recurringTaskId))
    .where(
      and(
        eq(noteTasks.noteId, noteId),
        eq(tasks.ownerId, ownerId),
        isNull(tasks.completedAt),
        notHabitOccurrence,
      ),
    )
    .orderBy(asc(noteTasks.sortOrder), asc(noteTasks.createdAt));
}

/**
 * Every task in a note, in note order — the read behind "show me this note's
 * tasks", where the completed ones are part of the answer. `listOpenTasksForNote`
 * stays as it is (its callers only ever want the open set).
 */
export async function listTasksForNote(
  ownerId: string,
  noteId: string,
  includeCompleted = false,
): Promise<
  {
    id: string;
    title: string;
    dueAt: Date | null;
    important: boolean;
    completedAt: Date | null;
  }[]
> {
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      dueAt: tasks.dueAt,
      important: tasks.important,
      completedAt: tasks.completedAt,
    })
    .from(noteTasks)
    .innerJoin(tasks, eq(noteTasks.taskId, tasks.id))
    .leftJoin(recurringTasks, eq(recurringTasks.id, tasks.recurringTaskId))
    .where(
      and(
        eq(noteTasks.noteId, noteId),
        eq(tasks.ownerId, ownerId),
        includeCompleted ? undefined : isNull(tasks.completedAt),
        notHabitOccurrence,
      ),
    )
    .orderBy(asc(noteTasks.sortOrder), asc(noteTasks.createdAt));
}

/**
 * Link an existing task into a note's note_tasks join (idempotent). Content
 * appends done server-side need this because reconciliation only runs on
 * editor saves.
 */
export async function linkTaskToNote(
  ownerId: string,
  noteId: string,
  taskId: string,
) {
  const note = await getNote(ownerId, noteId);
  if (!note) return;
  // Verify the task end too — never link someone else's task into a note.
  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.ownerId, ownerId)))
    .limit(1);
  if (!task) return;
  await db
    .insert(noteTasks)
    .values({ noteId, taskId })
    .onConflictDoNothing();
}

/**
 * Drop a task out of one note. The inverse of `linkTaskToNote`, and pointedly
 * NOT the inverse of reconciliation: a task left with zero links is kept, where
 * `reconcileNoteTasks` step 3 would delete it. That step infers intent from the
 * doc ("the block is gone, so the task is gone"); an explicit unlink is an edit
 * to the note, and destroying the task as a side effect would be a surprise the
 * caller never asked for. The task simply becomes a standalone task.
 *
 * Returns false when the task isn't the owner's or nothing was linked.
 */
export async function unlinkTaskFromNote(
  ownerId: string,
  noteId: string,
  taskId: string,
): Promise<boolean> {
  // note_tasks carries no owner of its own, so verify the task end the way
  // linkTaskToNote does — a guessed uuid must not unlink someone else's task.
  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.ownerId, ownerId)))
    .limit(1);
  if (!task) return false;

  const removed = await db
    .delete(noteTasks)
    .where(and(eq(noteTasks.noteId, noteId), eq(noteTasks.taskId, taskId)))
    .returning({ taskId: noteTasks.taskId });
  return removed.length > 0;
}

/**
 * The notes a task appears in. Deleting a task cascades its note_tasks rows but
 * NOT the `task` node in each note's serialized content — that checkbox would
 * outlive the row as a dangling reference. Callers therefore read this BEFORE
 * the delete, while the links still name the notes to strip.
 */
export async function listNoteIdsForTask(
  ownerId: string,
  taskId: string,
): Promise<string[]> {
  const rows = await db
    .select({ noteId: noteTasks.noteId })
    .from(noteTasks)
    // Ownership lives on the task, not the join — without this an id guess
    // would read back another owner's note ids.
    .innerJoin(tasks, eq(noteTasks.taskId, tasks.id))
    .where(and(eq(noteTasks.taskId, taskId), eq(tasks.ownerId, ownerId)));
  return rows.map((r) => r.noteId);
}
