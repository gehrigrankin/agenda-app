"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import type { SerializedEditorState } from "lexical";

import * as bubblesRepo from "@/server/bubbles";
import * as notesRepo from "@/server/notes";

async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  return userId;
}

export async function createBubbleAction(
  parentId: string,
  title: string,
): Promise<void> {
  const ownerId = await requireUserId();
  await bubblesRepo.createBubble(ownerId, parentId, title);
  revalidatePath("/app/bubbles");
}

export async function renameBubbleAction(
  id: string,
  title: string,
): Promise<void> {
  const ownerId = await requireUserId();
  await bubblesRepo.renameBubble(ownerId, id, title);
  revalidatePath("/app/bubbles");
}

export async function updateBubbleStyleAction(
  id: string,
  style: { emoji?: string | null; color?: string | null },
): Promise<void> {
  const ownerId = await requireUserId();
  await bubblesRepo.updateBubbleStyle(ownerId, id, style);
  revalidatePath("/app/bubbles");
}

/** Notes autosave — no revalidate (notes aren't shown elsewhere). */
export async function updateBubbleNotesAction(
  id: string,
  notes: string,
): Promise<void> {
  const ownerId = await requireUserId();
  await bubblesRepo.updateBubbleNotes(ownerId, id, notes);
}

export async function deleteBubbleAction(id: string): Promise<void> {
  const ownerId = await requireUserId();
  await bubblesRepo.deleteBubble(ownerId, id);
  revalidatePath("/app/bubbles");
}

export async function setBubbleFolderAction(
  id: string,
  isFolder: boolean,
): Promise<void> {
  const ownerId = await requireUserId();
  await bubblesRepo.setBubbleFolder(ownerId, id, isFolder);
  // Revalidate the layout too so the Notes sidebar folders update.
  revalidatePath("/app", "layout");
}

// --- Notes inside a bubble (real notes rows, reuse the Lexical editor) ------

/** Create a blank note inside a bubble and return its id so the editor opens. */
export async function createBubbleNoteAction(
  bubbleId: string,
  title: string,
): Promise<string> {
  const ownerId = await requireUserId();
  const note = await notesRepo.createNote({
    ownerId,
    bubbleId,
    title: title.trim() || "Untitled",
  });
  revalidatePath("/app/bubbles");
  return note.id;
}

/** Fetch a bubble note's editable payload for the editor overlay. */
export async function getBubbleNoteAction(noteId: string): Promise<{
  id: string;
  title: string;
  content: SerializedEditorState | null;
} | null> {
  const ownerId = await requireUserId();
  const note = await notesRepo.getNote(ownerId, noteId);
  if (!note || note.deletedAt) return null;
  return {
    id: note.id,
    title: note.title,
    content: (note.content as SerializedEditorState | null) ?? null,
  };
}

/** Soft-delete a bubble note (no redirect — stay in the bubble view). */
export async function trashBubbleNoteAction(noteId: string): Promise<void> {
  const ownerId = await requireUserId();
  await notesRepo.trashNote(ownerId, noteId);
  revalidatePath("/app/bubbles");
}
