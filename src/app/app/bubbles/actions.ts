"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

import * as bubblesRepo from "@/server/bubbles";

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
