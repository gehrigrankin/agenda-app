"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SerializedEditorState } from "lexical";

import * as bubblesRepo from "@/server/bubbles";
import * as notesRepo from "@/server/notes";
import * as tasksRepo from "@/server/tasks";

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
  // Revalidate so the Recent-dailies strip picks up a freshly created note.
  revalidatePath("/app", "layout");
  return {
    id: note.id,
    title: note.title,
    content: (note.content as SerializedEditorState | null) ?? null,
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
  if (note && JSON.stringify(content).includes('"task"')) {
    try {
      await tasksRepo.reconcileNoteTasks(ownerId, id, content);
    } catch (err) {
      console.error("[tasks] reconcile failed:", err);
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
};

/** Incomplete tasks due on or before the client's local date (YYYY-MM-DD). */
export async function listTasksDueAction(
  dateStr: string,
): Promise<DueTaskResult[]> {
  const ownerId = await requireUserId();
  const rows = await tasksRepo.listTasksDue(ownerId, dateStr);
  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    dueAt: t.dueAt.toISOString(),
    noteId: t.noteId,
  }));
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

/** Soft-delete (move to Trash) and return to the app home. */
export async function trashNoteAction(id: string): Promise<void> {
  const ownerId = await requireUserId();
  await notesRepo.trashNote(ownerId, id);
  revalidatePath("/app", "layout");
  redirect("/app");
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
