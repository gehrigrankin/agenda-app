"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

import * as bubblesRepo from "@/server/bubbles";
import * as inboxRepo from "@/server/inbox";

/**
 * Server actions for the capture inbox (design 16c). Same contract as the
 * rest of the app: Clerk auth via requireUserId, owner-scoped repo calls,
 * plain-serializable return shapes (dates as ISO strings).
 */

async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  return userId;
}

export interface InboxItemResult {
  id: string;
  source: "email" | "link" | "photo" | "text";
  title: string;
  excerpt: string | null;
  url: string | null;
  attachmentId: string | null;
  suggestedBubbleId: string | null;
  suggestionLabel: string | null;
  suggestionReason: string | null;
  bubbleTitle: string | null;
  bubbleColor: string | null;
  receivedAt: string;
}

export interface GetInboxResult {
  address: string;
  items: InboxItemResult[];
}

/**
 * Loads the inbox page: ensures the owner has a capture address, seeds the
 * demo items on a first-ever visit (no-op after that), then returns the live
 * "new" queue.
 */
export async function getInboxAction(): Promise<GetInboxResult> {
  const ownerId = await requireUserId();
  const address = await inboxRepo.getOrCreateCaptureAddress(ownerId);
  await inboxRepo.seedDemoItems(ownerId);
  const rows = await inboxRepo.listInbox(ownerId);
  return {
    address,
    items: rows.map((r) => ({
      id: r.id,
      source: r.source,
      title: r.title,
      excerpt: r.excerpt,
      url: r.url,
      attachmentId: r.attachmentId,
      suggestedBubbleId: r.suggestedBubbleId,
      suggestionLabel: r.suggestionLabel,
      suggestionReason: r.suggestionReason,
      bubbleTitle: r.bubbleTitle,
      bubbleColor: r.bubbleColor,
      receivedAt: r.receivedAt.toISOString(),
    })),
  };
}

/** Accept an item: files it as a real note (optionally into `bubbleId`). */
export async function fileItemAction(
  id: string,
  bubbleId: string | null,
): Promise<{ noteId: string } | null> {
  const ownerId = await requireUserId();
  const result = await inboxRepo.fileItem(ownerId, id, bubbleId);
  // Layout revalidation: a filed item may add a note to a folder bubble that
  // the Notes sidebar / bubble map are currently showing.
  revalidatePath("/app", "layout");
  return result;
}

/** Leave it: dismiss without filing. */
export async function dismissItemAction(id: string): Promise<void> {
  const ownerId = await requireUserId();
  await inboxRepo.dismissItem(ownerId, id);
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
  const ownerId = await requireUserId();
  const rows = await bubblesRepo.listFolderBubbles(ownerId);
  return rows.map((b) => ({
    id: b.id,
    title: b.title,
    emoji: b.emoji,
    color: b.color,
  }));
}
