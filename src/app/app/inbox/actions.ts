"use server";

import { revalidatePath } from "next/cache";

import * as bubblesRepo from "@/server/bubbles";
import * as inboxRepo from "@/server/inbox";

import { requireOwnerId } from "../owner";

/**
 * Server actions for the capture inbox. Same contract as the rest of the app:
 * Clerk auth via requireOwnerId, owner-scoped repo calls, plain-serializable
 * return shapes (dates as ISO strings). Ingestion itself happens in the PWA
 * share-target route (/app/share), not here.
 */

export interface InboxItemResult {
  id: string;
  source: "email" | "link" | "photo" | "text";
  title: string;
  excerpt: string | null;
  url: string | null;
  attachmentId: string | null;
  attachmentUrl: string | null;
  suggestedBubbleId: string | null;
  suggestionLabel: string | null;
  suggestionReason: string | null;
  bubbleTitle: string | null;
  bubbleColor: string | null;
  isSample: boolean;
  receivedAt: string;
}

export interface GetInboxResult {
  items: InboxItemResult[];
}

/**
 * Loads the inbox page: seeds the sample items on a first-ever visit (no-op
 * after that), then returns the live "new" queue.
 */
export async function getInboxAction(): Promise<GetInboxResult> {
  const ownerId = await requireOwnerId();
  await inboxRepo.seedDemoItems(ownerId);
  const rows = await inboxRepo.listInbox(ownerId);
  return {
    items: rows.map((r) => ({
      id: r.id,
      source: r.source,
      title: r.title,
      excerpt: r.excerpt,
      url: r.url,
      attachmentId: r.attachmentId,
      attachmentUrl: r.attachmentUrl,
      suggestedBubbleId: r.suggestedBubbleId,
      suggestionLabel: r.suggestionLabel,
      suggestionReason: r.suggestionReason,
      bubbleTitle: r.bubbleTitle,
      bubbleColor: r.bubbleColor,
      isSample: r.isSample,
      receivedAt: r.receivedAt.toISOString(),
    })),
  };
}

/** Accept an item: files it as a real note (optionally into `bubbleId`). */
export async function fileItemAction(
  id: string,
  bubbleId: string | null,
): Promise<{ noteId: string } | null> {
  const ownerId = await requireOwnerId();
  const result = await inboxRepo.fileItem(ownerId, id, bubbleId);
  // Layout revalidation: a filed item may add a note to a folder bubble that
  // the Notes sidebar / bubble map are currently showing.
  revalidatePath("/app", "layout");
  return result;
}

/** Leave it: dismiss without filing. */
export async function dismissItemAction(id: string): Promise<void> {
  const ownerId = await requireOwnerId();
  await inboxRepo.dismissItem(ownerId, id);
}

/** Dismisses every remaining sample row ("Clear samples"). */
export async function dismissSamplesAction(): Promise<void> {
  const ownerId = await requireOwnerId();
  await inboxRepo.dismissSamples(ownerId);
}

export interface FolderBubbleOption {
  id: string;
  title: string;
  emoji: string | null;
  color: string | null;
}

/** Folder bubbles for the "Somewhere else" picker. */
export async function listFolderBubblesAction(): Promise<
  FolderBubbleOption[]
> {
  const ownerId = await requireOwnerId();
  const rows = await bubblesRepo.listFolderBubbles(ownerId);
  return rows.map((b) => ({
    id: b.id,
    title: b.title,
    emoji: b.emoji,
    color: b.color,
  }));
}
