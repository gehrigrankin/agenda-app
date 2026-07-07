import "server-only";

import { createHash } from "crypto";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { bubbles, captureInbox, type CaptureInboxItem } from "@/db/schema";
import { docFromBlocks, heading, paragraph } from "@/lib/lexical-build";
import { suggestDestination } from "@/server/ai/inbox";
import { getBubble } from "@/server/bubbles";
import { createNote } from "@/server/notes";
import { getSettings, setCaptureAddress } from "@/server/settings";

/**
 * Data-access layer for the capture inbox (design 16c): "forward anything" —
 * every account gets a private address, and whatever lands there (email,
 * link, texted photo) shows up here with a suggested destination already
 * worked out. Accepting files it as a real note; leaving it is fine too, the
 * inbox is a real place, not a nag.
 *
 * Real inbound ingestion (an email webhook, SMS provider) is out of scope for
 * the MVP — `seedDemoItems` is the stand-in that gives a first-time visitor a
 * populated inbox — but the model, filing, and dismiss paths are the real
 * thing.
 */

const CAPTURE_DOMAIN = "yourapp.co";

/**
 * Deterministic local-part from the owner id (e.g. "jots-a1b2c3"). Hashing
 * instead of randomness means the same owner always resolves to the same
 * slug even before it's persisted, so a rare read-write race just re-derives
 * the identical value rather than colliding.
 */
function slugFromOwnerId(ownerId: string): string {
  const hash = createHash("sha256").update(ownerId).digest("hex");
  return `jots-${hash.slice(0, 6)}`;
}

/** The owner's private forwarding address, generating + persisting it on first call. */
export async function getOrCreateCaptureAddress(
  ownerId: string,
): Promise<string> {
  const settings = await getSettings(ownerId);
  let localPart = settings.captureAddress;
  if (!localPart) {
    localPart = slugFromOwnerId(ownerId);
    await setCaptureAddress(ownerId, localPart);
  }
  return `${localPart}@${CAPTURE_DOMAIN}`;
}

export interface InboxListRow {
  id: string;
  source: CaptureInboxItem["source"];
  title: string;
  excerpt: string | null;
  url: string | null;
  attachmentId: string | null;
  suggestedBubbleId: string | null;
  suggestionLabel: string | null;
  suggestionReason: string | null;
  bubbleTitle: string | null;
  bubbleColor: string | null;
  receivedAt: Date;
}

/** New (unfiled, undismissed) items, newest arrival first. */
export async function listInbox(ownerId: string): Promise<InboxListRow[]> {
  return db
    .select({
      id: captureInbox.id,
      source: captureInbox.source,
      title: captureInbox.title,
      excerpt: captureInbox.excerpt,
      url: captureInbox.url,
      attachmentId: captureInbox.attachmentId,
      suggestedBubbleId: captureInbox.suggestedBubbleId,
      suggestionLabel: captureInbox.suggestionLabel,
      suggestionReason: captureInbox.suggestionReason,
      receivedAt: captureInbox.receivedAt,
      bubbleTitle: bubbles.title,
      bubbleColor: bubbles.color,
    })
    .from(captureInbox)
    .leftJoin(bubbles, eq(captureInbox.suggestedBubbleId, bubbles.id))
    .where(
      and(eq(captureInbox.ownerId, ownerId), eq(captureInbox.status, "new")),
    )
    .orderBy(desc(captureInbox.receivedAt));
}

/**
 * Accept an item: create a real note from it (optionally moved into a
 * folder), then mark the item filed. `bubbleId` comes from the client (the
 * "Somewhere else" picker), so a non-null target is verified to be one of the
 * caller's own bubbles first — same guard as `moveNoteToBubble`.
 */
export async function fileItem(
  ownerId: string,
  itemId: string,
  bubbleId: string | null,
): Promise<{ noteId: string } | null> {
  const [item] = await db
    .select()
    .from(captureInbox)
    .where(and(eq(captureInbox.id, itemId), eq(captureInbox.ownerId, ownerId)))
    .limit(1);
  if (!item) return null;

  if (bubbleId !== null) {
    const bubble = await getBubble(ownerId, bubbleId);
    if (!bubble) throw new Error("Bubble not found");
  }

  const blocks = [heading(item.title, "h2")];
  if (item.excerpt) blocks.push(paragraph(item.excerpt));
  if (item.url) blocks.push(paragraph(item.url));
  const note = await createNote({
    ownerId,
    title: item.title,
    bubbleId,
    content: docFromBlocks(blocks),
  });

  await db
    .update(captureInbox)
    .set({ status: "filed", filedNoteId: note.id })
    .where(
      and(eq(captureInbox.id, itemId), eq(captureInbox.ownerId, ownerId)),
    );

  return { noteId: note.id };
}

/** Leave it: mark the item dismissed without creating a note. */
export async function dismissItem(
  ownerId: string,
  itemId: string,
): Promise<void> {
  await db
    .update(captureInbox)
    .set({ status: "dismissed" })
    .where(
      and(eq(captureInbox.id, itemId), eq(captureInbox.ownerId, ownerId)),
    );
}

/**
 * Stand-in for real inbound ingestion: seeds the three mockup items (email,
 * link, photo) the first time this owner opens the inbox, so the page isn't
 * empty. Idempotent — only inserts when the owner has zero capture_inbox rows
 * (of ANY status), so it never re-seeds after items are filed/dismissed.
 */
export async function seedDemoItems(ownerId: string): Promise<void> {
  const existing = await db
    .select({ id: captureInbox.id })
    .from(captureInbox)
    .where(eq(captureInbox.ownerId, ownerId))
    .limit(1);
  if (existing.length > 0) return;

  const emailTitle = "Fwd: Beta program — legal sign-off";
  const emailExcerpt = "…approved with one change…";
  // Best-effort match against the owner's own folders; null is a fine
  // outcome (the card just waits, same as the photo item).
  const emailSuggestion = await suggestDestination(ownerId, {
    title: emailTitle,
    excerpt: emailExcerpt,
  });

  const now = Date.now();
  const MIN = 60_000;
  const HOUR = 60 * MIN;

  await db.insert(captureInbox).values([
    {
      ownerId,
      source: "email",
      title: emailTitle,
      excerpt: emailExcerpt,
      suggestedBubbleId: emailSuggestion?.bubbleId ?? null,
      suggestionLabel: emailSuggestion?.label ?? null,
      suggestionReason: emailSuggestion?.reason ?? null,
      receivedAt: new Date(now - 22 * MIN),
    },
    {
      ownerId,
      source: "link",
      title: "The Design of Everyday Things — chapter on affordances",
      url: "https://example.com/design-of-everyday-things",
      suggestionLabel: "File to Reading list",
      suggestionReason: null,
      receivedAt: new Date(now - 3 * HOUR),
    },
    {
      ownerId,
      source: "photo",
      title: "Photo — bookstore shelf",
      receivedAt: new Date(now - 6 * HOUR),
    },
  ]);
}
