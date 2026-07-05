"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SerializedEditorState } from "lexical";

import * as notesRepo from "@/server/notes";

async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  return userId;
}

/** Create a blank note and jump into it. */
export async function createNoteAction(): Promise<void> {
  const ownerId = await requireUserId();
  const note = await notesRepo.createNote({ ownerId, title: "Untitled" });
  revalidatePath("/app", "layout");
  redirect(`/app/notes/${note.id}`);
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
  await notesRepo.updateNoteContent(ownerId, id, { content });
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
