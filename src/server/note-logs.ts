import "server-only";

import { and, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { SerializedEditorState, SerializedLexicalNode } from "lexical";

import { db } from "@/db";
import { noteLogs, notes } from "@/db/schema";
import { collectLogSections, logSectionText } from "@/lib/note-logs";

/**
 * Data-access layer for call logs. A `[[+Target` heading in one note logs the
 * blocks beneath it onto another note; the rows here are that relationship.
 *
 * Reconciled from note JSON on save, the same shape as `note_tasks` and
 * `note_links` — the document is the source of truth and this table is a
 * derived index of it. The difference is that a log carries CONTENT, so the
 * row is rewritten on every save rather than merely existing or not.
 *
 * The target note is never edited. That's the whole point of storing logs
 * separately: two notes can't fight over a region of a third.
 */

/** A log as its target note's panel needs it. */
export interface NoteLogEntry {
  id: string;
  heading: string;
  text: string;
  content: SerializedLexicalNode[];
  createdAt: Date;
  updatedAt: Date;
  sourceNoteId: string;
  sourceTitle: string;
  /** YYYY-MM-DD when the source is a daily jot — lets the panel say so. */
  sourceDailyDate: string | null;
}

/**
 * Rewrite this note's logs to match its content.
 *
 * Ordering matters and there is no transaction (Neon HTTP): upsert first, then
 * delete what's no longer in the document. The reverse would briefly drop a
 * log that's merely being edited, and a crash in the gap would lose it.
 *
 * `createdAt` is deliberately NOT touched on update — it's when the log was
 * written, which is what the panel shows, and rewriting it would make every
 * edit jump the entry to the top of someone else's note.
 */
export async function reconcileNoteLogs(
  ownerId: string,
  sourceNoteId: string,
  content: SerializedEditorState,
): Promise<void> {
  const sections = collectLogSections(content);

  // Only log to notes the owner owns and hasn't trashed, and never to the
  // note itself — a note logging onto itself would render its own body back
  // to it.
  const targetIds = [
    ...new Set(
      sections.map((s) => s.noteId).filter((id) => id !== sourceNoteId),
    ),
  ];
  const liveTargets =
    targetIds.length === 0
      ? []
      : await db
          .select({ id: notes.id })
          .from(notes)
          .where(
            and(
              eq(notes.ownerId, ownerId),
              inArray(notes.id, targetIds),
              isNull(notes.deletedAt),
            ),
          );
  const liveTargetIds = new Set(liveTargets.map((t) => t.id));

  const rows = sections
    .filter((s) => liveTargetIds.has(s.noteId))
    .map((s) => ({
      id: s.logId,
      ownerId,
      sourceNoteId,
      targetNoteId: s.noteId,
      heading: s.heading.slice(0, 500),
      content: s.blocks,
      text: logSectionText(s.blocks),
    }));

  if (rows.length > 0) {
    await db
      .insert(noteLogs)
      .values(rows)
      .onConflictDoUpdate({
        target: noteLogs.id,
        set: {
          targetNoteId: sql`excluded.target_note_id`,
          heading: sql`excluded.heading`,
          content: sql`excluded.content`,
          text: sql`excluded.text`,
          updatedAt: new Date(),
        },
        // An id copy-pasted out of one document into another must not let the
        // paster overwrite the original log. Same-owner, same-source only.
        setWhere: and(
          eq(noteLogs.ownerId, ownerId),
          eq(noteLogs.sourceNoteId, sourceNoteId),
        ),
      });
  }

  // Anything this note used to log and no longer does.
  const keep = rows.map((r) => r.id);
  const mine = and(
    eq(noteLogs.ownerId, ownerId),
    eq(noteLogs.sourceNoteId, sourceNoteId),
  );
  await db
    .delete(noteLogs)
    .where(keep.length > 0 ? and(mine, notInArray(noteLogs.id, keep)) : mine);
}

/** Logs written onto `noteId`, newest first — the Logs panel's query. */
export async function listLogsForNote(
  ownerId: string,
  noteId: string,
): Promise<NoteLogEntry[]> {
  const rows = await db
    .select({
      id: noteLogs.id,
      heading: noteLogs.heading,
      text: noteLogs.text,
      content: noteLogs.content,
      createdAt: noteLogs.createdAt,
      updatedAt: noteLogs.updatedAt,
      sourceNoteId: noteLogs.sourceNoteId,
      sourceTitle: notes.title,
      sourceDailyDate: notes.dailyDate,
    })
    .from(noteLogs)
    .innerJoin(notes, eq(notes.id, noteLogs.sourceNoteId))
    .where(
      and(
        eq(noteLogs.ownerId, ownerId),
        eq(noteLogs.targetNoteId, noteId),
        // A log whose source is in the Trash stops showing — the note it came
        // from is, as far as the user is concerned, gone.
        isNull(notes.deletedAt),
      ),
    )
    .orderBy(desc(noteLogs.createdAt));

  return rows.map((r) => ({
    id: r.id,
    heading: r.heading,
    text: r.text,
    content: (r.content ?? []) as SerializedLexicalNode[],
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    sourceNoteId: r.sourceNoteId,
    sourceTitle: r.sourceTitle,
    // `notes.dailyDate` is a Postgres `date`, which the driver hands back as
    // a Date. Only the calendar day matters and it's already the user's local
    // day, so slice the ISO rather than re-deriving it through a timezone.
    sourceDailyDate:
      r.sourceDailyDate === null
        ? null
        : typeof r.sourceDailyDate === "string"
          ? r.sourceDailyDate
          : new Date(r.sourceDailyDate).toISOString().slice(0, 10),
  }));
}
