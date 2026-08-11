"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SerializedEditorState, SerializedLexicalNode } from "lexical";

import {
  appendCardAnchor,
  cardAnchorSectionBlocks,
  pruneEmptyCardAnchor,
  replaceCardAnchorSection,
} from "@/lib/card-anchors";
import { parseHashtags } from "@/lib/hashtags";
import { parseImportantMark } from "@/lib/importance";
import { parseRecurrenceInput, type RecurrenceSpec } from "@/lib/recurrence";
import {
  AUTH_FAILURE,
  MISSING_NOTE_FAILURE,
  serverSaveFailure,
  type SaveFailure,
} from "@/lib/save-failure";
import * as bubblesRepo from "@/server/bubbles";
import * as noteLogsRepo from "@/server/note-logs";
import * as notesRepo from "@/server/notes";
import * as recurringRepo from "@/server/recurring";
import * as tagsRepo from "@/server/tags";
import * as tasksRepo from "@/server/tasks";

import { requireOwnerId } from "./owner";

/**
 * Create a note and jump into it (the redirect happens server-side).
 * `title` is optional so existing no-arg callers keep working; the typeof
 * guard also protects against a <form action> binding passing FormData.
 */
export async function createNoteAction(title?: string): Promise<void> {
  const ownerId = await requireOwnerId();
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
  const ownerId = await requireOwnerId();
  const safeTitle =
    (typeof title === "string" ? title.trim().slice(0, 300) : "") || "Untitled";
  const note = await notesRepo.createNote({ ownerId, title: safeTitle });
  if (typeof content === "object" && content !== null) {
    const saved = await saveNoteContentAction(note.id, content);
    // The row exists but its body didn't land — the composer's text is the
    // only copy, so fail loudly rather than hand back an empty note.
    if (!saved.ok) throw new Error(saved.failure.message);
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
  const ownerId = await requireOwnerId();
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
  const ownerId = await requireOwnerId();
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
  const ownerId = await requireOwnerId();
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
  const ownerId = await requireOwnerId();
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
  const ownerId = await requireOwnerId();
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
  const ownerId = await requireOwnerId();
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
  const ownerId = await requireOwnerId();
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
  const ownerId = await requireOwnerId();
  const note = await notesRepo.getNote(ownerId, id);
  if (!note || note.deletedAt) return null;
  // Dock/quick-view opens count for "Recently opened" too.
  await notesRepo.touchNoteOpened(ownerId, id).catch((err) => {
    console.error("[app] failed to stamp note open:", err);
  });
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
  const ownerId = await requireOwnerId();
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

/**
 * What an autosave reports back. A thrown error would reach the browser as a
 * redacted digest ("An error occurred in the Server Components render"), which
 * is precisely the information the editor needs and cannot invent — so the
 * known failures come back as data, and only genuine bugs throw.
 */
export type NoteSaveResult = { ok: true } | { ok: false; failure: SaveFailure };

/** Autosave: rename. Revalidates so the sidebar title stays in sync. */
export async function renameNoteAction(
  id: string,
  title: string,
): Promise<NoteSaveResult> {
  let ownerId: string;
  try {
    ownerId = await requireOwnerId();
  } catch {
    return { ok: false, failure: AUTH_FAILURE };
  }
  try {
    const note = await notesRepo.updateNoteContent(ownerId, id, {
      title: title.trim() || "Untitled",
    });
    if (!note) return { ok: false, failure: MISSING_NOTE_FAILURE };
  } catch (err) {
    console.error("[notes] rename failed:", err);
    return { ok: false, failure: serverSaveFailure(err) };
  }
  revalidatePath("/app", "layout");
  return { ok: true };
}

/**
 * Autosave: persist Lexical content. No revalidate — content isn't shown in the
 * sidebar, so we avoid re-rendering the tree on every keystroke batch.
 */
export async function saveNoteContentAction(
  id: string,
  content: SerializedEditorState,
): Promise<NoteSaveResult> {
  let ownerId: string;
  try {
    ownerId = await requireOwnerId();
  } catch {
    return { ok: false, failure: AUTH_FAILURE };
  }

  let note: Awaited<ReturnType<typeof notesRepo.updateNoteContent>>;
  try {
    note = await notesRepo.updateNoteContent(ownerId, id, { content });
  } catch (err) {
    // The write itself failed — the words are still only in the browser, so
    // this MUST come back as a failure the editor can retry, never as a
    // silent success.
    console.error("[notes] content save failed:", err);
    return { ok: false, failure: serverSaveFailure(err) };
  }

  // Reconcile note_tasks links (and orphaned tasks) against the saved doc.
  // Fast path: a doc with task nodes always contains `"type":"task"`, so a
  // content string without the "task" substring can be skipped without any DB
  // work. (Narrow known gap: a save that REMOVED the last task node AND has no
  // other occurrence of "task" in the text skips the cleanup; the stale link
  // is swept on the next save that mentions tasks.) Reconciliation errors
  // never fail the save itself — content is already persisted.
  //
  // No row came back: the note is trashed or gone (the update is scoped to
  // live notes owned by this owner). Nothing was written, so say so — a
  // "saved" here is a lie that ends with the user losing the page they kept
  // typing into.
  if (!note) return { ok: false, failure: MISSING_NOTE_FAILURE };
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
  // Logs deliberately DON'T take the substring-gate shortcut above. That gate
  // has a known gap on removal — delete the last matching node and the save
  // that removed it no longer matches, so cleanup waits for some later save.
  // For tasks and links the leftover is an invisible join row. For a log it's
  // a stale entry sitting on somebody else's note after you deleted the
  // section, which is the one outcome this feature can't have. The cost is one
  // indexed DELETE per save on notes that never log anything.
  try {
    await noteLogsRepo.reconcileNoteLogs(ownerId, id, content);
  } catch (err) {
    console.error("[note-logs] reconcile failed:", err);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Linked-note card anchors
//
// A card in note A owns a SECTION of note B, marked by a `card-anchor` block.
// These three actions are the only writers of that boundary; `src/lib/
// card-anchors.ts` holds the pure reasoning and its header explains the rules.
//
// Every one of them re-reads the target note immediately before writing.
// `neon-http` has no interactive transactions, so this is read-modify-write
// with a real (small) race window — but it is strictly narrower than the
// alternative, which is a card holding a whole-document copy of somebody
// else's note and saving all of it.
// ---------------------------------------------------------------------------

/**
 * Put a fresh anchor on the target note and hand back its id for the card to
 * remember. Returns null when the target is gone — the caller then inserts an
 * unscoped card rather than one pointing at a boundary that does not exist.
 */
export async function createCardAnchorAction(
  targetNoteId: string,
  sourceNoteId: string,
  sourceTitle: string,
): Promise<{ anchorId: string } | null> {
  const ownerId = await requireOwnerId();
  const note = await notesRepo.getNote(ownerId, targetNoteId);
  if (!note || note.deletedAt) return null;

  const anchorId = randomUUID();
  const next = appendCardAnchor(
    note.content as SerializedEditorState | null,
    { anchorId, sourceNoteId, sourceTitle },
  );
  if (!next) return null;
  await notesRepo.updateNoteContent(ownerId, targetNoteId, { content: next });
  return { anchorId };
}

/** The blocks a card should show: its own section, or null if the anchor is gone. */
export async function getCardSectionAction(
  targetNoteId: string,
  anchorId: string,
): Promise<{ blocks: SerializedLexicalNode[] } | null> {
  const ownerId = await requireOwnerId();
  const note = await notesRepo.getNote(ownerId, targetNoteId);
  if (!note || note.deletedAt) return null;
  const blocks = cardAnchorSectionBlocks(
    note.content as SerializedEditorState | null,
    anchorId,
  );
  return blocks ? { blocks } : null;
}

/**
 * Save what was typed in a card back into its section of the target note.
 *
 * A missing anchor is reported, never forced: if the section was deleted from
 * the target note while the card was open, appending the card's copy would
 * resurrect writing the user had just thrown away.
 */
export async function saveCardSectionAction(
  targetNoteId: string,
  anchorId: string,
  blocks: SerializedLexicalNode[],
): Promise<{ ok: boolean; reason?: "missing-note" | "missing-anchor" }> {
  const ownerId = await requireOwnerId();
  const note = await notesRepo.getNote(ownerId, targetNoteId);
  if (!note || note.deletedAt) return { ok: false, reason: "missing-note" };

  const merged = replaceCardAnchorSection(
    note.content as SerializedEditorState | null,
    anchorId,
    Array.isArray(blocks) ? blocks : [],
  );
  if (!merged) return { ok: false, reason: "missing-anchor" };

  // Through the normal save so the target note's tasks, links and logs are
  // reconciled — a task chip typed into a card is a task on THAT note.
  const saved = await saveNoteContentAction(targetNoteId, merged);
  // The save reports failures as data now; this caller's contract is a throw,
  // which is what the card editor's error branch already handles.
  if (!saved.ok) throw new Error(saved.failure.message);
  return { ok: true };
}

/**
 * Remove a card's anchor from the target note when nothing was written under
 * it. Called on card deletion; a section with content is left exactly where it
 * is, since the words belong to the target note now, not to the card.
 */
export async function pruneCardAnchorAction(
  targetNoteId: string,
  anchorId: string,
): Promise<void> {
  const ownerId = await requireOwnerId();
  const note = await notesRepo.getNote(ownerId, targetNoteId);
  if (!note || note.deletedAt) return;
  const next = pruneEmptyCardAnchor(
    note.content as SerializedEditorState | null,
    anchorId,
  );
  if (!next) return;
  await notesRepo.updateNoteContent(ownerId, targetNoteId, { content: next });
}

/** Logs written onto this note — the Logs panel. */
export async function listNoteLogsAction(
  noteId: string,
): Promise<NoteLogResult[]> {
  const ownerId = await requireOwnerId();
  const rows = await noteLogsRepo.listLogsForNote(ownerId, noteId);
  return rows.map((r) => ({
    id: r.id,
    heading: r.heading,
    text: r.text,
    createdAt: r.createdAt.toISOString(),
    sourceNoteId: r.sourceNoteId,
    sourceTitle: r.sourceTitle,
    sourceDailyDate: r.sourceDailyDate,
  }));
}

/** Plain-serializable log entry for the Logs panel. */
export type NoteLogResult = {
  id: string;
  heading: string;
  text: string;
  /** ISO timestamp of when the log was written. */
  createdAt: string;
  sourceNoteId: string;
  sourceTitle: string;
  sourceDailyDate: string | null;
};

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
  const ownerId = await requireOwnerId();
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
  const ownerId = await requireOwnerId();
  await tasksRepo.toggleTask(ownerId, taskId, completed === true);
}

export async function renameTaskAction(
  taskId: string,
  title: string,
): Promise<void> {
  const ownerId = await requireOwnerId();
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
  const ownerId = await requireOwnerId();
  let dueAt: Date | null = null;
  if (dateStr !== null) {
    if (typeof dateStr !== "string" || !TASK_DATE_RE.test(dateStr)) {
      throw new Error("Invalid due date");
    }
    dueAt = new Date(`${dateStr}T00:00:00.000Z`);
  }
  await tasksRepo.setTaskDue(ownerId, taskId, dueAt);
}

/**
 * Flip a task's "important" star. Same no-revalidate rule as the three above:
 * every caller writes through its own state optimistically, and the star is
 * reachable from inside the live editor.
 */
export async function setTaskImportantAction(
  taskId: string,
  important: boolean,
): Promise<void> {
  const ownerId = await requireOwnerId();
  await tasksRepo.setTaskImportant(ownerId, taskId, important === true);
}

/**
 * Put an existing task on a note, links table first.
 *
 * Called the instant a task chip is dropped into another editor, ahead of any
 * autosave. Dropping a task moves a node between two documents that save on
 * their own debounces, and if the SOURCE note saved first the task would
 * briefly have no links at all — which is precisely the state
 * `reconcileNoteTasks` reads as "the user deleted this task" before hard
 * deleting it. Writing the destination link up front means that window never
 * exists; the target note's own save then finds the link already there and
 * changes nothing.
 */
export async function linkTaskToNoteAction(
  noteId: string,
  taskId: string,
): Promise<void> {
  const ownerId = await requireOwnerId();
  await tasksRepo.linkTaskToNote(ownerId, noteId, taskId);
}

/** Plain-serializable tag chip carried by every task result below. */
export type TagResult = { id: string; name: string; color: string | null };

/**
 * Tags for a page of task rows, in one query. Every list action below runs its
 * rows through this rather than joining tags into each task query — the lists
 * are page-sized, and a second round trip beats four more joins.
 */
async function tagsFor(
  ownerId: string,
  ids: string[],
): Promise<Map<string, TagResult[]>> {
  return tagsRepo.listTagsForTasks(ownerId, ids);
}

/** Plain-serializable due/overdue task for the Today page. */
export type DueTaskResult = {
  id: string;
  title: string;
  /** ISO timestamp (midnight UTC of the due day). */
  dueAt: string;
  /** Starred by the user: overdue reads red instead of calm blue. */
  important: boolean;
  /** A note containing the task, if any (first link wins). */
  noteId: string | null;
  /** Reminder wall-clock time "HH:MM" (bell chip), if any. */
  remindAt: string | null;
  /** Board (bubble) of the containing note, for the board-dot chip. */
  boardTitle: string | null;
  boardColor: string | null;
  /** Recurrence rule behind the task (repeat chip), if any. */
  recurring: RecurrenceSpec | null;
  /** Flat labels on the task (tag chips + the rail's tag filter). */
  tags: TagResult[];
};

function toDueTaskResult(
  t: tasksRepo.OpenTaskRow,
  tags: Map<string, TagResult[]>,
): DueTaskResult {
  return {
    id: t.id,
    title: t.title,
    dueAt: t.dueAt.toISOString(),
    important: t.important,
    noteId: t.noteId,
    remindAt: t.remindAt,
    boardTitle: t.boardTitle,
    boardColor: t.boardColor,
    recurring: t.recurring,
    tags: tags.get(t.id) ?? [],
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
  const ownerId = await requireOwnerId();
  const ceiling =
    typeof todayStr === "string" && TASK_DATE_RE.test(todayStr) && todayStr < dateStr
      ? todayStr
      : dateStr;
  await recurringRepo.materializeDueOccurrences(ownerId, ceiling);
  const rows = await tasksRepo.listTasksDue(ownerId, dateStr);
  const tags = await tagsFor(ownerId, rows.map((r) => r.id));
  return rows.map((r) => toDueTaskResult(r, tags));
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
  const ownerId = await requireOwnerId();
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
  const ownerId = await requireOwnerId();
  return tasksRepo.listTaskDueDates(ownerId, startStr, endStr);
}

/** Incomplete tasks due strictly after the client's local date, soonest first. */
export async function listTasksUpcomingAction(
  dateStr: string,
): Promise<DueTaskResult[]> {
  const ownerId = await requireOwnerId();
  const rows = await tasksRepo.listTasksUpcoming(ownerId, dateStr);
  const tags = await tagsFor(ownerId, rows.map((r) => r.id));
  return rows.map((r) => toDueTaskResult(r, tags));
}

/** Plain-serializable undated open task for the "Unscheduled" section. */
export type UnscheduledTaskResult = {
  id: string;
  title: string;
  /** ISO creation timestamp (list is newest first). */
  createdAt: string;
  /** Starred by the user (no due date, so no overdue color yet). */
  important: boolean;
  /** A live note containing the task, if any (first link wins). */
  noteId: string | null;
  noteTitle: string | null;
  /** Board (bubble) of the containing note, for the board-dot chip. */
  boardTitle: string | null;
  boardColor: string | null;
  /** Flat labels on the task (tag chips + the rail's tag filter). */
  tags: TagResult[];
};

/** Open tasks with no due date, newest first — the Tasks page's Unscheduled section. */
export async function listTasksUnscheduledAction(): Promise<
  UnscheduledTaskResult[]
> {
  const ownerId = await requireOwnerId();
  const rows = await tasksRepo.listTasksUnscheduled(ownerId);
  const tags = await tagsFor(ownerId, rows.map((r) => r.id));
  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    createdAt: t.createdAt.toISOString(),
    important: t.important,
    noteId: t.noteId,
    noteTitle: t.noteTitle,
    boardTitle: t.boardTitle,
    boardColor: t.boardColor,
    tags: tags.get(t.id) ?? [],
  }));
}

/** Plain-serializable open task for the "Recently added" section. */
export type RecentTaskResult = {
  id: string;
  title: string;
  /** ISO creation timestamp (list is newest first). */
  createdAt: string;
  /** YYYY-MM-DD due day, or null for tasks captured without a date. */
  due: string | null;
  /** Starred by the user: overdue reads red instead of calm blue. */
  important: boolean;
  /** A live note containing the task, if any (first link wins). */
  noteId: string | null;
  noteTitle: string | null;
  /** Board (bubble) of the containing note, for the board-dot chip. */
  boardTitle: string | null;
  boardColor: string | null;
  /** Flat labels on the task (tag chips + the rail's tag filter). */
  tags: TagResult[];
};

/** Open tasks by capture time, newest first — the Tasks page's Recently added lens. */
export async function listTasksRecentlyAddedAction(
  limit = 25,
): Promise<RecentTaskResult[]> {
  const ownerId = await requireOwnerId();
  const rows = await tasksRepo.listTasksRecentlyAdded(
    ownerId,
    Math.min(100, Math.max(1, Math.trunc(limit))),
  );
  const tags = await tagsFor(ownerId, rows.map((r) => r.id));
  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    createdAt: t.createdAt.toISOString(),
    due: t.dueAt ? t.dueAt.toISOString().slice(0, 10) : null,
    important: t.important,
    noteId: t.noteId,
    noteTitle: t.noteTitle,
    boardTitle: t.boardTitle,
    boardColor: t.boardColor,
    tags: tags.get(t.id) ?? [],
  }));
}

/**
 * Create a note-less task due on the client's local date (task dock input).
 * Any `#tags` typed into the title are parsed out, found-or-created, and
 * linked — so "call the dentist #health" captures the label in one keystroke
 * run. A lone `!` does the same for the important star. The returned
 * `title`/`tags`/`important` are what the caller should render; they differ
 * from what was typed whenever a marker was parsed off.
 */
export async function createStandaloneTaskAction(
  title: string,
  dateStr: string | null,
): Promise<{
  id: string;
  title: string;
  tags: TagResult[];
  important: boolean;
}> {
  const ownerId = await requireOwnerId();
  let dueAt: Date | null = null;
  if (dateStr !== null) {
    if (typeof dateStr !== "string" || !TASK_DATE_RE.test(dateStr)) {
      throw new Error("Invalid due date");
    }
    dueAt = new Date(`${dateStr}T00:00:00.000Z`);
  }
  const raw = typeof title === "string" ? title : "";
  const marked = parseImportantMark(raw);
  const parsed = parseHashtags(marked.title);
  // "#health" or a bare "!" is a marker with no task — keep the raw text as
  // the title rather than creating an "Untitled task" the user can't recognize.
  const task = await tasksRepo.createStandaloneTask(
    ownerId,
    parsed.title || raw,
    dueAt,
    marked.important,
  );

  let tags: TagResult[] = [];
  if (parsed.tags.length > 0) {
    // Tagging failing must not lose the task the user just typed.
    try {
      const resolved = await tagsRepo.resolveTagsByName(ownerId, parsed.tags);
      tags = await tagsRepo.addTaskTags(
        ownerId,
        task.id,
        resolved.map((t) => t.id),
      );
    } catch (err) {
      console.error("[tasks] tagging on create failed:", err);
    }
  }
  return { id: task.id, title: task.title, tags, important: task.important };
}

// ---------------------------------------------------------------------------
// Tags — flat labels on tasks (ROADMAP item 4). Notes are not tagged yet.
// ---------------------------------------------------------------------------

/** A tag plus how many of the owner's OPEN tasks carry it. */
export type TagWithCountResult = TagResult & { taskCount: number };

/** Every tag the owner has, alphabetical — the picker's and rail's source. */
export async function listTagsAction(): Promise<TagWithCountResult[]> {
  const ownerId = await requireOwnerId();
  return tagsRepo.listTags(ownerId);
}

/** Find-or-create by name — the picker's "create #foo" row. */
export async function createTagAction(name: string): Promise<TagResult | null> {
  const ownerId = await requireOwnerId();
  const [tag] = await tagsRepo.resolveTagsByName(
    ownerId,
    typeof name === "string" ? [name] : [],
  );
  return tag ?? null;
}

/** Replace a task's tags wholesale — what the row picker saves. */
export async function setTaskTagsAction(
  taskId: string,
  tagIds: string[],
): Promise<TagResult[]> {
  const ownerId = await requireOwnerId();
  return tagsRepo.setTaskTags(
    ownerId,
    taskId,
    Array.isArray(tagIds) ? tagIds.filter((t) => typeof t === "string") : [],
  );
}

/** Rename a tag everywhere it's used. Null when it isn't the owner's. */
export async function renameTagAction(
  tagId: string,
  name: string,
): Promise<TagResult | null> {
  const ownerId = await requireOwnerId();
  return tagsRepo.renameTag(ownerId, tagId, name);
}

/** Delete a tag; it drops off every task carrying it. */
export async function deleteTagAction(tagId: string): Promise<void> {
  const ownerId = await requireOwnerId();
  await tagsRepo.deleteTag(ownerId, tagId);
}

/** Plain-serializable completed task for the dock's Done section. */
export type DoneTaskResult = { id: string; title: string };

/** Tasks completed within the client's local day [startIso, endIso). */
export async function listTasksDoneAction(
  startIso: string,
  endIso: string,
): Promise<DoneTaskResult[]> {
  const ownerId = await requireOwnerId();
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
  const ownerId = await requireOwnerId();
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
  const ownerId = await requireOwnerId();
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
  const ownerId = await requireOwnerId();
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
  const ownerId = await requireOwnerId();
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
  const ownerId = await requireOwnerId();
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
  const ownerId = await requireOwnerId();
  await recurringRepo.setRecurringPaused(ownerId, id, paused === true);
}

export async function deleteRecurringTaskAction(id: string): Promise<void> {
  const ownerId = await requireOwnerId();
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
  const ownerId = await requireOwnerId();
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
  const ownerId = await requireOwnerId();
  await notesRepo.moveNoteToBubble(ownerId, noteId, bubbleId);
  revalidatePath("/app", "layout");
}

/**
 * Soft-delete (move to Trash). No redirect here — callers decide where to go
 * (the full-page note view navigates to /app/notes; dock windows and quick
 * view just close themselves).
 */
export async function trashNoteAction(id: string): Promise<void> {
  const ownerId = await requireOwnerId();
  await notesRepo.trashNote(ownerId, id);
  revalidatePath("/app", "layout");
}

/**
 * Duplicate a live note: new row, "<title> (copy)" title, same bubble/content,
 * but never a `dailyDate` (unique per day) and with the source's note_tasks
 * links replicated so shared tasks still appear in both notes.
 */
export async function duplicateNoteAction(id: string): Promise<{ id: string }> {
  const ownerId = await requireOwnerId();
  const note = await notesRepo.duplicateNote(ownerId, id);
  if (!note) throw new Error("Note not found");
  revalidatePath("/app", "layout");
  return { id: note.id };
}

/** Restore a note from the Trash (a daily-date collision restores it as a regular note). */
export async function restoreNoteAction(id: string): Promise<void> {
  const ownerId = await requireOwnerId();
  await notesRepo.restoreNote(ownerId, id);
  revalidatePath("/app", "layout");
  revalidatePath("/app/trash");
}

/**
 * Permanently delete every trashed note (the Trash page's "Empty trash"
 * action, behind an inline confirm in the UI). Returns the count removed so
 * the confirm copy can read back "Deleted N notes" if the caller wants it.
 */
export async function emptyTrashAction(): Promise<{ count: number }> {
  const ownerId = await requireOwnerId();
  const count = await notesRepo.purgeAllTrashedNotes(ownerId);
  revalidatePath("/app", "layout");
  revalidatePath("/app/trash");
  return { count };
}
