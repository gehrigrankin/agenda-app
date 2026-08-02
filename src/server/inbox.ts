import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  attachments,
  bubbles,
  captureInbox,
  type CaptureInboxItem,
} from "@/db/schema";
import {
  docFromBlocks,
  heading,
  imageNode,
  paragraph,
} from "@/lib/lexical-build";
import { storage } from "@/lib/storage";
import { suggestDestination } from "@/server/ai/inbox";
import { getBubble } from "@/server/bubbles";
import { createNote } from "@/server/notes";

/**
 * Data-access layer for the capture inbox. The real ingestion path is the PWA
 * share target (/app/share → `addSharedItem`): install the app, then share
 * links/photos/text from any other app and they land here, each with a
 * suggested destination worked out. Accepting files it as a real note; leaving
 * it is fine too — the inbox is a real place, not a nag.
 *
 * NOTE on email capture: the private forwarding address was a demo facade and
 * has been removed from this module and the UI (CONTEXT.md "Product coherence
 * decisions"). The `user_settings.capture_address` column is intentionally
 * kept — real inbound email may return later.
 */

export interface InboxListRow {
  id: string;
  source: CaptureInboxItem["source"];
  title: string;
  excerpt: string | null;
  url: string | null;
  attachmentId: string | null;
  /** Serving URL for the attachment (e.g. /api/uploads/<blobId>), when any. */
  attachmentUrl: string | null;
  suggestedBubbleId: string | null;
  suggestionLabel: string | null;
  suggestionReason: string | null;
  bubbleTitle: string | null;
  bubbleColor: string | null;
  /** True for rows seeded by `seedDemoItems` — the UI marks these "sample". */
  isSample: boolean;
  receivedAt: Date;
}

/** New (unfiled, undismissed) items, newest arrival first. */
export async function listInbox(ownerId: string): Promise<InboxListRow[]> {
  const rows = await db
    .select({
      id: captureInbox.id,
      source: captureInbox.source,
      title: captureInbox.title,
      excerpt: captureInbox.excerpt,
      url: captureInbox.url,
      attachmentId: captureInbox.attachmentId,
      attachmentUrl: attachments.url,
      suggestedBubbleId: captureInbox.suggestedBubbleId,
      suggestionLabel: captureInbox.suggestionLabel,
      suggestionReason: captureInbox.suggestionReason,
      receivedAt: captureInbox.receivedAt,
      bubbleTitle: bubbles.title,
      bubbleColor: bubbles.color,
    })
    .from(captureInbox)
    .leftJoin(bubbles, eq(captureInbox.suggestedBubbleId, bubbles.id))
    .leftJoin(attachments, eq(captureInbox.attachmentId, attachments.id))
    .where(
      and(eq(captureInbox.ownerId, ownerId), eq(captureInbox.status, "new")),
    )
    .orderBy(desc(captureInbox.receivedAt));

  return rows.map((r) => ({ ...r, isSample: isDemoRow(r) }));
}

// ---------------------------------------------------------------------------
// Share-target ingestion
// ---------------------------------------------------------------------------

export interface SharedItemInput {
  title: string | null;
  text: string | null;
  url: string | null;
  /** First shared image, already read into memory by the route. */
  image: { fileName: string; contentType: string; body: Buffer } | null;
}

/**
 * Stores one item POSTed by the OS share sheet (see src/app/app/share/
 * route.ts). Mapping is deliberately forgiving because platforms disagree on
 * which field carries what (Android often puts the URL in `text`):
 *
 * - an image → source "photo"; bytes go through the active StorageAdapter and
 *   an `attachments` row, linked via `attachmentId` (same path as editor
 *   uploads, served by /api/uploads/[id] for the db driver);
 * - else a URL (explicit, or `text` that is a lone URL) → source "link";
 * - else → source "text".
 *
 * A destination suggestion is computed best-effort with the same call the
 * demo seed uses (one cheap low-effort request per shared item, with a
 * zero-AI keyword fallback); failure just leaves the item unsuggested.
 */
export async function addSharedItem(
  ownerId: string,
  input: SharedItemInput,
): Promise<void> {
  const text = input.text?.trim() || null;
  const explicitUrl = input.url?.trim() || null;
  // Android commonly shares a bare URL in `text` with no `url` param.
  const url =
    explicitUrl ?? (text && /^https?:\/\/\S+$/i.test(text) ? text : null);
  const excerpt = text && text !== url ? clip(text, 500) : null;

  let attachmentId: string | null = null;
  if (input.image) {
    const stored = await storage.put({
      ownerId,
      fileName: input.image.fileName,
      contentType: input.image.contentType,
      body: input.image.body,
    });
    const [attachment] = await db
      .insert(attachments)
      .values({
        ownerId,
        kind: "image",
        storageKey: stored.key,
        url: stored.url,
        mimeType: input.image.contentType,
        fileName: input.image.fileName,
        sizeBytes: input.image.body.byteLength,
      })
      .returning({ id: attachments.id });
    attachmentId = attachment.id;
  }

  const source: CaptureInboxItem["source"] = attachmentId
    ? "photo"
    : url
      ? "link"
      : "text";

  const title =
    input.title?.trim() ||
    (excerpt ? clip(excerpt.split("\n")[0], 120) : null) ||
    (attachmentId ? `Photo — ${input.image!.fileName}` : null) ||
    url ||
    "Shared item";

  // Best-effort; a suggestion failure must never lose the captured item.
  let suggestion = null;
  try {
    suggestion = await suggestDestination(ownerId, { title, excerpt });
  } catch (err) {
    console.error("[inbox] suggestion failed:", err);
  }

  await db.insert(captureInbox).values({
    ownerId,
    source,
    title,
    excerpt,
    url,
    attachmentId,
    suggestedBubbleId: suggestion?.bubbleId ?? null,
    suggestionLabel: suggestion?.label ?? null,
    suggestionReason: suggestion?.reason ?? null,
  });
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// ---------------------------------------------------------------------------
// Filing / dismissing
// ---------------------------------------------------------------------------

/**
 * Accept an item: create a real note from it (optionally moved into a
 * folder), then mark the item filed. `bubbleId` comes from the client (the
 * "Somewhere else" picker), so a non-null target is verified to be one of the
 * caller's own bubbles first — same guard as `moveNoteToBubble`. An attachment
 * item embeds its image in the note (the same serialized ImageNode shape the
 * editor produces).
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
  if (item.attachmentId) {
    const [attachment] = await db
      .select({ url: attachments.url })
      .from(attachments)
      .where(
        and(
          eq(attachments.id, item.attachmentId),
          eq(attachments.ownerId, ownerId),
        ),
      )
      .limit(1);
    if (attachment) blocks.push(imageNode(attachment.url, item.title));
  }
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

// ---------------------------------------------------------------------------
// Demo seed (kept for empty accounts, now honestly labeled)
// ---------------------------------------------------------------------------

/**
 * The fixed rows `seedDemoItems` inserts. There is deliberately no schema
 * column for "demo" — sample rows are recognized by their exact (source,
 * title) pair, which is stable because the seed only ever runs against an
 * account with zero capture_inbox rows and these constants are the single
 * source of both the insert and the check.
 */
const DEMO_ROWS: { source: CaptureInboxItem["source"]; title: string }[] = [
  { source: "email", title: "Fwd: Beta program — legal sign-off" },
  {
    source: "link",
    title: "The Design of Everyday Things — chapter on affordances",
  },
  { source: "photo", title: "Photo — bookstore shelf" },
];

function isDemoRow(row: {
  source: CaptureInboxItem["source"];
  title: string;
  attachmentId: string | null;
}): boolean {
  // Real shares always have their own titles; demo photo rows additionally
  // never carry a real attachment.
  return (
    row.attachmentId === null &&
    DEMO_ROWS.some((d) => d.source === row.source && d.title === row.title)
  );
}

/**
 * Stand-in content for a first-time visitor: seeds three sample items (the UI
 * chips them "sample") so the page demonstrates the flow before the user has
 * shared anything. Idempotent — only inserts when the owner has zero
 * capture_inbox rows (of ANY status), so it never re-seeds after items are
 * filed/dismissed.
 */
export async function seedDemoItems(ownerId: string): Promise<void> {
  const existing = await db
    .select({ id: captureInbox.id })
    .from(captureInbox)
    .where(eq(captureInbox.ownerId, ownerId))
    .limit(1);
  if (existing.length > 0) return;

  const emailExcerpt = "…approved with one change…";
  // Best-effort match against the owner's own folders; null is a fine
  // outcome (the card just waits, same as the photo item).
  const emailSuggestion = await suggestDestination(ownerId, {
    title: DEMO_ROWS[0].title,
    excerpt: emailExcerpt,
  });

  const now = Date.now();
  const MIN = 60_000;
  const HOUR = 60 * MIN;

  await db.insert(captureInbox).values([
    {
      ownerId,
      source: DEMO_ROWS[0].source,
      title: DEMO_ROWS[0].title,
      excerpt: emailExcerpt,
      suggestedBubbleId: emailSuggestion?.bubbleId ?? null,
      suggestionLabel: emailSuggestion?.label ?? null,
      suggestionReason: emailSuggestion?.reason ?? null,
      receivedAt: new Date(now - 22 * MIN),
    },
    {
      ownerId,
      source: DEMO_ROWS[1].source,
      title: DEMO_ROWS[1].title,
      url: "https://example.com/design-of-everyday-things",
      suggestionLabel: "File to Reading list",
      suggestionReason: null,
      receivedAt: new Date(now - 3 * HOUR),
    },
    {
      ownerId,
      source: DEMO_ROWS[2].source,
      title: DEMO_ROWS[2].title,
      receivedAt: new Date(now - 6 * HOUR),
    },
  ]);
}

/**
 * Dismisses every still-new sample row for this owner (the inbox's "Clear
 * samples" affordance). Matching mirrors `isDemoRow`.
 */
export async function dismissSamples(ownerId: string): Promise<void> {
  const rows = await db
    .select({
      id: captureInbox.id,
      source: captureInbox.source,
      title: captureInbox.title,
      attachmentId: captureInbox.attachmentId,
    })
    .from(captureInbox)
    .where(
      and(eq(captureInbox.ownerId, ownerId), eq(captureInbox.status, "new")),
    );
  for (const row of rows) {
    if (isDemoRow(row)) {
      await db
        .update(captureInbox)
        .set({ status: "dismissed" })
        .where(eq(captureInbox.id, row.id));
    }
  }
}
