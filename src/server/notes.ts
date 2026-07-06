import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  notInArray,
} from "drizzle-orm";
import type { SerializedEditorState } from "lexical";

import { db } from "@/db";
import { bubbles, noteLinks, notes, type NewNote } from "@/db/schema";
import { lexicalToPlainText } from "@/lib/lexical-text";
import { getBubble } from "@/server/bubbles";

/**
 * Data-access layer for notes. Keep all DB access in src/server/* so the UI and
 * editor never touch drizzle directly. These are the building blocks the MVP
 * Note CRUD + autosave + Trash features call into; server actions / route
 * handlers wrap them and enforce the Clerk owner scope.
 *
 * Notes with a `bubbleId` belong to a bubble in the bubble map; the main notes
 * list excludes them (they're surfaced inside their bubble instead).
 */

export async function listNotes(ownerId: string) {
  return db
    .select()
    .from(notes)
    .where(
      and(
        eq(notes.ownerId, ownerId),
        isNull(notes.deletedAt),
        isNull(notes.bubbleId),
        // Daily jots live on the Today page, not the main notes list.
        isNull(notes.dailyDate),
      ),
    )
    .orderBy(desc(notes.updatedAt));
}

/** Lightweight projection for the sidebar list (no heavy content column). */
export async function listNotesForSidebar(ownerId: string) {
  return db
    .select({
      id: notes.id,
      title: notes.title,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .where(
      and(
        eq(notes.ownerId, ownerId),
        isNull(notes.deletedAt),
        isNull(notes.bubbleId),
        // Daily jots live on the Today page, not the sidebar.
        isNull(notes.dailyDate),
      ),
    )
    .orderBy(desc(notes.updatedAt));
}

export type NoteSummary = Awaited<
  ReturnType<typeof listNotesForSidebar>
>[number];

/** All bubble-scoped note summaries for a user, to render inside bubbles. */
export async function listBubbleNoteSummaries(ownerId: string) {
  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      bubbleId: notes.bubbleId,
      content: notes.content,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .where(
      and(
        eq(notes.ownerId, ownerId),
        isNull(notes.deletedAt),
        isNotNull(notes.bubbleId),
      ),
    )
    // Oldest first: notes render on the canvas in creation order, so a new
    // note appends at the end of its bubble's shelf instead of reshuffling.
    .orderBy(asc(notes.createdAt));

  return rows.map(({ content, ...rest }) => ({
    ...rest,
    preview: lexicalToPlainText(content as SerializedEditorState | null, 120),
  }));
}

export type BubbleNoteSummary = Awaited<
  ReturnType<typeof listBubbleNoteSummaries>
>[number];

/**
 * Escape LIKE/ILIKE wildcards in user input so a query like "50%" matches the
 * literal text instead of acting as a pattern. Backslash is Postgres's default
 * escape character, so it must be escaped too.
 */
export function escapeLikePattern(query: string): string {
  return query.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Title search across ALL live notes — standalone, daily jots, and bubble
 * notes (the palette links bubble notes to their bubble). Trashed notes are
 * excluded.
 */
export async function searchNotes(ownerId: string, query: string, limit = 12) {
  return db
    .select({
      id: notes.id,
      title: notes.title,
      bubbleId: notes.bubbleId,
      dailyDate: notes.dailyDate,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .where(
      and(
        eq(notes.ownerId, ownerId),
        isNull(notes.deletedAt),
        ilike(notes.title, `%${escapeLikePattern(query)}%`),
      ),
    )
    .orderBy(desc(notes.updatedAt))
    .limit(limit);
}

export async function getNote(ownerId: string, id: string) {
  const [note] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.ownerId, ownerId)))
    .limit(1);
  return note ?? null;
}

export async function createNote(input: NewNote) {
  const [note] = await db.insert(notes).values(input).returning();
  return note;
}

export async function updateNoteContent(
  ownerId: string,
  id: string,
  data: Partial<Pick<NewNote, "title" | "content">>,
) {
  const [note] = await db
    .update(notes)
    .set({ ...data, updatedAt: new Date() })
    // Exclude trashed notes so an in-flight autosave can't write to a note
    // that was just moved to Trash.
    .where(
      and(eq(notes.id, id), eq(notes.ownerId, ownerId), isNull(notes.deletedAt)),
    )
    .returning();
  return note ?? null;
}

/**
 * Move a note into a bubble folder (`bubbleId`) or back out to the standalone
 * notes list (`null`). The bubble id comes from the client, so a non-null
 * target is verified to be one of the caller's own bubbles first. Trashed
 * notes are excluded so an in-flight move can't resurface a just-trashed note.
 */
export async function moveNoteToBubble(
  ownerId: string,
  noteId: string,
  bubbleId: string | null,
) {
  if (bubbleId !== null) {
    const bubble = await getBubble(ownerId, bubbleId);
    if (!bubble) throw new Error("Bubble not found");
  }
  const [note] = await db
    .update(notes)
    .set({ bubbleId, updatedAt: new Date() })
    .where(
      and(
        eq(notes.id, noteId),
        eq(notes.ownerId, ownerId),
        isNull(notes.deletedAt),
      ),
    )
    .returning();
  return note ?? null;
}

/** Soft-delete: moves a note to Trash. */
export async function trashNote(ownerId: string, id: string) {
  const [note] = await db
    .update(notes)
    .set({ deletedAt: new Date() })
    .where(and(eq(notes.id, id), eq(notes.ownerId, ownerId)))
    .returning();
  return note ?? null;
}

/**
 * All trashed notes (standalone AND bubble notes), newest deletions first.
 * `bubbleId` is included so the Trash UI can tell bubble notes apart.
 */
export async function listTrashedNotes(ownerId: string) {
  return db
    .select({
      id: notes.id,
      title: notes.title,
      deletedAt: notes.deletedAt,
      bubbleId: notes.bubbleId,
    })
    .from(notes)
    .where(and(eq(notes.ownerId, ownerId), isNotNull(notes.deletedAt)))
    .orderBy(desc(notes.deletedAt));
}

export type TrashedNoteSummary = Awaited<
  ReturnType<typeof listTrashedNotes>
>[number];

/**
 * Restore a trashed note (clears `deletedAt`).
 *
 * Daily notes need care: the partial unique index on (ownerId, dailyDate)
 * WHERE deleted_at IS NULL means restoring could collide with a live daily
 * note created after this one was trashed. The Neon HTTP driver has no
 * transactions, so we check-then-act: if a live daily note already exists for
 * that date, restore this one as a regular note (dailyDate: null).
 */
export async function restoreNote(ownerId: string, id: string) {
  const [trashed] = await db
    .select({ id: notes.id, dailyDate: notes.dailyDate })
    .from(notes)
    .where(
      and(
        eq(notes.id, id),
        eq(notes.ownerId, ownerId),
        isNotNull(notes.deletedAt),
      ),
    )
    .limit(1);
  if (!trashed) return null;

  let clearDailyDate = false;
  if (trashed.dailyDate) {
    const [liveDaily] = await db
      .select({ id: notes.id })
      .from(notes)
      .where(
        and(
          eq(notes.ownerId, ownerId),
          eq(notes.dailyDate, trashed.dailyDate),
          isNull(notes.deletedAt),
        ),
      )
      .limit(1);
    if (liveDaily) clearDailyDate = true;
  }

  const [note] = await db
    .update(notes)
    .set({
      deletedAt: null,
      updatedAt: new Date(),
      ...(clearDailyDate ? { dailyDate: null } : {}),
    })
    .where(
      and(
        eq(notes.id, id),
        eq(notes.ownerId, ownerId),
        isNotNull(notes.deletedAt),
      ),
    )
    .returning();
  return note ?? null;
}

// ---------------------------------------------------------------------------
// Daily jots
// ---------------------------------------------------------------------------

const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Convert a YYYY-MM-DD string to the canonical Date we store in `dailyDate`
 * (midnight UTC). All reads/writes of the column go through this so equality
 * comparisons are consistent.
 */
function dailyDateFromString(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/**
 * Human title like "Sat, Jul 5" derived purely from the date parts (rendered
 * with an explicit locale + UTC so the server's own TZ/locale never leak in).
 */
function dailyTitleFromString(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Get (or lazily create) the daily jot note for a calendar date. `dateStr` is
 * the USER'S local date as YYYY-MM-DD — the client supplies it since the
 * server can't know the user's timezone.
 *
 * The Neon HTTP driver has no transactions, so creation is check-then-insert
 * with the partial unique index on (ownerId, dailyDate) WHERE deleted_at IS
 * NULL as the backstop: if a concurrent request wins the insert race, our
 * insert fails and we re-select the winner.
 */
export async function getOrCreateDailyNote(ownerId: string, dateStr: string) {
  if (!DATE_STR_RE.test(dateStr)) {
    throw new Error(`Invalid daily date: ${dateStr}`);
  }
  const dailyDate = dailyDateFromString(dateStr);

  const selectExisting = async () => {
    const [existing] = await db
      .select()
      .from(notes)
      .where(
        and(
          eq(notes.ownerId, ownerId),
          eq(notes.dailyDate, dailyDate),
          isNull(notes.deletedAt),
        ),
      )
      .limit(1);
    return existing ?? null;
  };

  const existing = await selectExisting();
  if (existing) return existing;

  try {
    const [created] = await db
      .insert(notes)
      .values({ ownerId, title: dailyTitleFromString(dateStr), dailyDate })
      .returning();
    return created;
  } catch (err) {
    // Unique-index race: another request created today's note between our
    // select and insert. The winner is the note we want.
    const winner = await selectExisting();
    if (winner) return winner;
    throw err;
  }
}

/** Most recent daily notes (live only), newest date first. */
export async function listRecentDailyNotes(ownerId: string, limit = 7) {
  return db
    .select({
      id: notes.id,
      title: notes.title,
      dailyDate: notes.dailyDate,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .where(
      and(
        eq(notes.ownerId, ownerId),
        isNotNull(notes.dailyDate),
        isNull(notes.deletedAt),
      ),
    )
    .orderBy(desc(notes.dailyDate))
    .limit(limit);
}

export type DailyNoteSummary = Awaited<
  ReturnType<typeof listRecentDailyNotes>
>[number];

/** The live daily note for a date, or null — a SELECT-only sibling of
 * `getOrCreateDailyNote` so viewing a past day never creates rows. */
export async function getDailyNote(ownerId: string, dateStr: string) {
  if (!DATE_STR_RE.test(dateStr)) {
    throw new Error(`Invalid daily date: ${dateStr}`);
  }
  const [note] = await db
    .select()
    .from(notes)
    .where(
      and(
        eq(notes.ownerId, ownerId),
        eq(notes.dailyDate, dailyDateFromString(dateStr)),
        isNull(notes.deletedAt),
      ),
    )
    .limit(1);
  return note ?? null;
}

/** Live daily-note dates within [startStr, endStr] (inclusive), for the mini
 * calendar's clickable day dots. */
export async function listDailyNoteDatesBetween(
  ownerId: string,
  startStr: string,
  endStr: string,
) {
  if (!DATE_STR_RE.test(startStr) || !DATE_STR_RE.test(endStr)) {
    throw new Error(`Invalid date range: ${startStr}..${endStr}`);
  }
  const rows = await db
    .select({ id: notes.id, dailyDate: notes.dailyDate })
    .from(notes)
    .where(
      and(
        eq(notes.ownerId, ownerId),
        isNull(notes.deletedAt),
        isNotNull(notes.dailyDate),
        gte(notes.dailyDate, dailyDateFromString(startStr)),
        lte(notes.dailyDate, dailyDateFromString(endStr)),
      ),
    )
    .orderBy(asc(notes.dailyDate));
  return rows
    .filter((r): r is typeof r & { dailyDate: Date } => r.dailyDate !== null)
    .map((r) => ({ id: r.id, date: r.dailyDate.toISOString().slice(0, 10) }));
}

/**
 * Note-side aggregates for the "Yesterday" widget: how many live non-daily
 * notes were edited within [start, end) (the client's local-day bounds), how
 * many notes that day's daily note links out to, and the daily note's first
 * line. Task counts live in the tasks repo (composed by the action).
 */
export async function getDaySummary(
  ownerId: string,
  dateStr: string,
  start: Date,
  end: Date,
) {
  const edited = await db
    .select({ id: notes.id })
    .from(notes)
    .where(
      and(
        eq(notes.ownerId, ownerId),
        isNull(notes.deletedAt),
        isNull(notes.dailyDate),
        gte(notes.updatedAt, start),
        lt(notes.updatedAt, end),
      ),
    );

  const daily = await getDailyNote(ownerId, dateStr);
  let linksCreated = 0;
  let firstLine: string | null = null;
  if (daily) {
    const links = await db
      .select({ targetNoteId: noteLinks.targetNoteId })
      .from(noteLinks)
      .where(eq(noteLinks.sourceNoteId, daily.id));
    linksCreated = links.length;
    firstLine =
      lexicalToPlainText(daily.content as SerializedEditorState | null, 60) ||
      null;
  }

  return { notesEdited: edited.length, linksCreated, firstLine };
}

/** First `limit` live notes inside a bubble, with plain-text previews — the
 * pinned-board widget's cards. */
export async function listNotesForBubble(
  ownerId: string,
  bubbleId: string,
  limit = 2,
) {
  const rows = await db
    .select({ id: notes.id, title: notes.title, content: notes.content })
    .from(notes)
    .where(
      and(
        eq(notes.ownerId, ownerId),
        eq(notes.bubbleId, bubbleId),
        isNull(notes.deletedAt),
      ),
    )
    .orderBy(asc(notes.createdAt))
    .limit(limit);
  return rows.map(({ content, ...rest }) => ({
    ...rest,
    preview: lexicalToPlainText(content as SerializedEditorState | null, 80),
  }));
}

/** Bubble metadata (title/color) for a set of bubble ids, as a lookup map. */
async function bubbleMetaByIds(bubbleIds: string[]) {
  const meta = new Map<string, { title: string; color: string | null }>();
  if (bubbleIds.length === 0) return meta;
  const rows = await db
    .select({ id: bubbles.id, title: bubbles.title, color: bubbles.color })
    .from(bubbles)
    .where(inArray(bubbles.id, bubbleIds));
  for (const b of rows) meta.set(b.id, { title: b.title, color: b.color });
  return meta;
}

/**
 * Full previews (content included) for a set of the owner's live notes, plus
 * the hosting bubble's title/color — feeds linked-note cards and the quick
 * view breadcrumb. Ids come from client-serialized content, so everything is
 * owner-scoped and unknown ids simply drop out.
 */
export async function getNotePreviews(ownerId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      content: notes.content,
      bubbleId: notes.bubbleId,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .where(
      and(
        eq(notes.ownerId, ownerId),
        inArray(notes.id, ids),
        isNull(notes.deletedAt),
      ),
    );

  const meta = await bubbleMetaByIds([
    ...new Set(rows.flatMap((r) => (r.bubbleId ? [r.bubbleId] : []))),
  ]);
  return rows.map((r) => ({
    ...r,
    bubbleTitle: r.bubbleId ? (meta.get(r.bubbleId)?.title ?? null) : null,
    bubbleColor: r.bubbleId ? (meta.get(r.bubbleId)?.color ?? null) : null,
  }));
}

/**
 * The "Linked today" widget's two lists: live notes the daily note links out
 * to, and live non-daily notes edited within [start, end) that are NOT linked
 * yet. `dailyNoteId` is owner-verified here since it comes from the client.
 */
export async function getLinkedToday(
  ownerId: string,
  dailyNoteId: string,
  start: Date,
  end: Date,
) {
  const [daily] = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.id, dailyNoteId), eq(notes.ownerId, ownerId)))
    .limit(1);
  if (!daily) throw new Error("Daily note not found");

  const linkedRows = await db
    .select({
      id: notes.id,
      title: notes.title,
      bubbleId: notes.bubbleId,
      updatedAt: notes.updatedAt,
    })
    .from(noteLinks)
    .innerJoin(notes, eq(noteLinks.targetNoteId, notes.id))
    .where(
      and(eq(noteLinks.sourceNoteId, dailyNoteId), isNull(notes.deletedAt)),
    )
    .orderBy(desc(notes.updatedAt));

  const linkedIds = linkedRows.map((r) => r.id);
  const editedRows = await db
    .select({
      id: notes.id,
      title: notes.title,
      bubbleId: notes.bubbleId,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .where(
      and(
        eq(notes.ownerId, ownerId),
        isNull(notes.deletedAt),
        isNull(notes.dailyDate),
        gte(notes.updatedAt, start),
        lt(notes.updatedAt, end),
        ...(linkedIds.length > 0 ? [notInArray(notes.id, linkedIds)] : []),
      ),
    )
    .orderBy(desc(notes.updatedAt))
    .limit(6);

  const meta = await bubbleMetaByIds([
    ...new Set(
      [...linkedRows, ...editedRows].flatMap((r) =>
        r.bubbleId ? [r.bubbleId] : [],
      ),
    ),
  ]);
  const decorate = (r: (typeof linkedRows)[number]) => ({
    id: r.id,
    title: r.title,
    updatedAt: r.updatedAt,
    bubbleColor: r.bubbleId ? (meta.get(r.bubbleId)?.color ?? null) : null,
  });
  return {
    linked: linkedRows.map(decorate),
    editedElsewhere: editedRows.map(decorate),
  };
}

/** Standalone notes (the /app/notes list) with one-line previews. */
export async function listNotesWithPreview(ownerId: string, limit = 60) {
  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      content: notes.content,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .where(
      and(
        eq(notes.ownerId, ownerId),
        isNull(notes.deletedAt),
        isNull(notes.bubbleId),
        isNull(notes.dailyDate),
      ),
    )
    .orderBy(desc(notes.updatedAt))
    .limit(limit);
  return rows.map(({ content, ...rest }) => ({
    ...rest,
    preview: lexicalToPlainText(content as SerializedEditorState | null, 90),
  }));
}

// ---------------------------------------------------------------------------
// Note-links (backlinks)
// ---------------------------------------------------------------------------

/** Recursively collect target noteIds of link nodes (inline "note-link" chips
 * and block "linked-note-card"s) in serialized Lexical JSON. */
function collectNoteLinkIds(node: unknown, out: Set<string>): void {
  if (node === null || typeof node !== "object") return;
  const n = node as { type?: unknown; noteId?: unknown; children?: unknown };
  if (
    (n.type === "note-link" || n.type === "linked-note-card") &&
    typeof n.noteId === "string" &&
    n.noteId
  ) {
    out.add(n.noteId);
  }
  if (Array.isArray(n.children)) {
    for (const child of n.children) collectNoteLinkIds(child, out);
  }
}

/**
 * Sync `note_links` rows (sourceNoteId = this note) against its just-saved
 * serialized content. `noteId` MUST already be owner-verified by the caller
 * (saveNoteContentAction only calls this after an owner-scoped update hit).
 *
 * No transactions on Neon HTTP, so ordered crash-safe like the task
 * reconciliation: insert missing first (crash after: extra rows, next save
 * re-syncs), then delete stale. Self-links are dropped (a note linking to
 * itself is noise), and targets are filtered to the owner's own notes since
 * serialized content comes from the client.
 */
export async function reconcileNoteLinks(
  ownerId: string,
  noteId: string,
  content: SerializedEditorState,
): Promise<void> {
  const ids = new Set<string>();
  collectNoteLinkIds((content as { root?: unknown }).root, ids);
  ids.delete(noteId);

  let keepIds: string[] = [];
  if (ids.size > 0) {
    const owned = await db
      .select({ id: notes.id })
      .from(notes)
      .where(and(eq(notes.ownerId, ownerId), inArray(notes.id, [...ids])));
    keepIds = owned.map((r) => r.id);
  }

  // 1) Insert missing links.
  if (keepIds.length > 0) {
    await db
      .insert(noteLinks)
      .values(keepIds.map((targetNoteId) => ({ sourceNoteId: noteId, targetNoteId })))
      .onConflictDoNothing();
  }

  // 2) Delete links no longer present in the content.
  const staleConditions = [eq(noteLinks.sourceNoteId, noteId)];
  if (keepIds.length > 0) {
    staleConditions.push(notInArray(noteLinks.targetNoteId, keepIds));
  }
  await db.delete(noteLinks).where(and(...staleConditions));
}

/**
 * Live notes that link TO `noteId` ("Linked from" footer). Trashed sources are
 * hidden but their rows stay put, so restoring the source resurfaces the
 * backlink without a re-save.
 */
export async function listBacklinks(ownerId: string, noteId: string) {
  return db
    .select({ id: notes.id, title: notes.title })
    .from(noteLinks)
    .innerJoin(notes, eq(noteLinks.sourceNoteId, notes.id))
    .where(
      and(
        eq(noteLinks.targetNoteId, noteId),
        eq(notes.ownerId, ownerId),
        isNull(notes.deletedAt),
      ),
    )
    .orderBy(asc(notes.title));
}

export type BacklinkSummary = Awaited<
  ReturnType<typeof listBacklinks>
>[number];

/** Hard-delete. Only removes notes that are already in the Trash. */
export async function purgeNote(ownerId: string, id: string) {
  const [note] = await db
    .delete(notes)
    .where(
      and(
        eq(notes.id, id),
        eq(notes.ownerId, ownerId),
        isNotNull(notes.deletedAt),
      ),
    )
    .returning({ id: notes.id });
  return note ?? null;
}
