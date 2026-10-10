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
  source: "email" | "link" | "photo" | "text" | "voice";
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
  /** "new" = in the queue (or snoozed); "filed" = filed today. */
  status: "new" | "filed" | "dismissed";
  /** ISO instant the item is snoozed until; null when not snoozed. */
  snoozedUntil: string | null;
  filedAt: string | null;
  filedNoteId: string | null;
}

export interface GetInboxResult {
  items: InboxItemResult[];
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Loads the inbox page: seeds the sample items on a first-ever visit (no-op
 * after that), then returns every new item (snoozed ones included — the client
 * splits them by time) plus what was filed since `dayStartIso`, the client's
 * local midnight as an ISO instant (defaults to 24h ago).
 */
export async function getInboxAction(
  dayStartIso?: string,
): Promise<GetInboxResult> {
  const ownerId = await requireOwnerId();
  await inboxRepo.seedDemoItems(ownerId);
  const dayStart =
    typeof dayStartIso === "string" &&
    ISO_RE.test(dayStartIso) &&
    !Number.isNaN(new Date(dayStartIso).getTime())
      ? new Date(dayStartIso)
      : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await inboxRepo.listInboxForPage(ownerId, dayStart);
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
      status: r.status,
      snoozedUntil: r.snoozedUntil?.toISOString() ?? null,
      filedAt: r.filedAt?.toISOString() ?? null,
      filedNoteId: r.filedNoteId,
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

/**
 * "Make task" outcome: the client has created the task from the item's title
 * (createStandaloneTaskAction); this marks the item filed without a note.
 */
export async function markItemFiledAction(id: string): Promise<void> {
  const ownerId = await requireOwnerId();
  if (typeof id !== "string" || !UUID_RE.test(id))
    throw new Error("Invalid id");
  await inboxRepo.markItemFiled(ownerId, id);
}

/**
 * Snooze an item out of the queue until `untilIso` (a future ISO instant, at
 * most a year out), or pass null to unsnooze it.
 */
export async function snoozeItemAction(
  id: string,
  untilIso: string | null,
): Promise<void> {
  const ownerId = await requireOwnerId();
  if (typeof id !== "string" || !UUID_RE.test(id))
    throw new Error("Invalid id");
  let until: Date | null = null;
  if (untilIso !== null) {
    if (typeof untilIso !== "string" || !ISO_RE.test(untilIso)) {
      throw new Error("Invalid snooze time");
    }
    until = new Date(untilIso);
    const now = Date.now();
    if (
      Number.isNaN(until.getTime()) ||
      until.getTime() <= now ||
      until.getTime() > now + 366 * 24 * 60 * 60 * 1000
    ) {
      throw new Error("Invalid snooze time");
    }
  }
  await inboxRepo.snoozeItem(ownerId, id, until);
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
export async function listFolderBubblesAction(): Promise<FolderBubbleOption[]> {
  const ownerId = await requireOwnerId();
  const rows = await bubblesRepo.listFolderBubbles(ownerId);
  return rows.map((b) => ({
    id: b.id,
    title: b.title,
    emoji: b.emoji,
    color: b.color,
  }));
}
