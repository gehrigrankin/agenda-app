import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { notes, type NewNote } from "@/db/schema";

/**
 * Data-access layer for notes. Keep all DB access in src/server/* so the UI and
 * editor never touch drizzle directly. These are the building blocks the MVP
 * Note CRUD + autosave + Trash features call into; server actions / route
 * handlers wrap them and enforce the Clerk owner scope.
 */

export async function listNotes(ownerId: string) {
  return db
    .select()
    .from(notes)
    .where(and(eq(notes.ownerId, ownerId), isNull(notes.deletedAt)))
    .orderBy(desc(notes.updatedAt));
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
    .where(and(eq(notes.id, id), eq(notes.ownerId, ownerId)))
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
