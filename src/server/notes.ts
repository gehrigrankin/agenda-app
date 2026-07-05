import "server-only";

import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { SerializedEditorState } from "lexical";

import { db } from "@/db";
import { notes, type NewNote } from "@/db/schema";
import { lexicalToPlainText } from "@/lib/lexical-text";

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
    .orderBy(desc(notes.updatedAt));

  return rows.map(({ content, ...rest }) => ({
    ...rest,
    preview: lexicalToPlainText(content as SerializedEditorState | null, 120),
  }));
}

export type BubbleNoteSummary = Awaited<
  ReturnType<typeof listBubbleNoteSummaries>
>[number];

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

/** Soft-delete: moves a note to Trash. */
export async function trashNote(ownerId: string, id: string) {
  const [note] = await db
    .update(notes)
    .set({ deletedAt: new Date() })
    .where(and(eq(notes.id, id), eq(notes.ownerId, ownerId)))
    .returning();
  return note ?? null;
}
