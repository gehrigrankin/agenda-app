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

/** Returns the new bubble's id so the client can swap its optimistic node. */
export async function createBubbleAction(
  parentId: string,
  title: string,
): Promise<string> {
  const ownerId = await requireUserId();
  const bubble = await bubblesRepo.createBubble(ownerId, parentId, title);
  revalidatePath("/app/bubbles");
  return bubble.id;
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
  // bubbleId comes from the client — reject bubbles the caller doesn't own.
  const bubble = await bubblesRepo.getBubble(ownerId, bubbleId);
  if (!bubble) throw new Error("Bubble not found");
  const note = await notesRepo.createNote({
    ownerId,
    bubbleId,
    title: title.trim() || "Untitled",
  });
  // Layout revalidation covers the bubbles page and the Notes sidebar folders.
  revalidatePath("/app", "layout");
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
  if (!note || note.deletedAt || !note.bubbleId) return null;
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
  // Layout revalidation covers the bubbles page and the Notes sidebar folders.
  revalidatePath("/app", "layout");
}
