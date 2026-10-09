"use server";

import { revalidatePath } from "next/cache";

import type { SortMode } from "@/lib/explorer-tree";
import * as bubblesRepo from "@/server/bubbles";
import * as explorerRepo from "@/server/explorer";

import { requireOwnerId } from "../owner";

/**
 * Server actions for the Notes Explorer: folder color + icon, per-folder sort,
 * manual reordering, and body search for the filter. Moves, renames, creates
 * and deletes reuse the existing note/bubble actions.
 */

export async function setFolderStyleAction(
  id: string,
  style: { icon?: string | null; color?: string | null },
): Promise<void> {
  const ownerId = await requireOwnerId();
  await bubblesRepo.updateBubbleStyle(ownerId, id, {
    ...("icon" in style ? { icon: style.icon } : {}),
    ...("color" in style ? { color: style.color } : {}),
  });
  revalidatePath("/app", "layout");
}

export async function setFolderSortModeAction(
  id: string,
  mode: SortMode | null,
): Promise<void> {
  const ownerId = await requireOwnerId();
  await explorerRepo.setFolderSortMode(ownerId, id, mode);
  revalidatePath("/app/notes", "layout");
}

export async function reorderNotesAction(ids: string[]): Promise<void> {
  const ownerId = await requireOwnerId();
  await explorerRepo.reorderNotes(ownerId, ids);
  revalidatePath("/app/notes", "layout");
}

export async function reorderFoldersAction(ids: string[]): Promise<void> {
  const ownerId = await requireOwnerId();
  await explorerRepo.reorderFolders(ownerId, ids);
  revalidatePath("/app", "layout");
}

export async function searchNoteBodiesAction(
  query: string,
): Promise<{ id: string; snippet: string }[]> {
  const ownerId = await requireOwnerId();
  if (typeof query !== "string") return [];
  try {
    return await explorerRepo.searchNoteBodies(ownerId, query.slice(0, 200));
  } catch (err) {
    console.error("[notes] body search failed:", err);
    return [];
  }
}
