import "server-only";

import type { SerializedEditorState, SerializedLexicalNode } from "lexical";

import { replaceCardAnchorSection } from "../lib/card-anchors";
import { appendBlocksToSerializedState } from "../lib/live-note-append";
import {
  CONTENT_CONFLICT_FAILURE,
  MISSING_NOTE_FAILURE,
  serverSaveFailure,
  type SaveFailure,
} from "../lib/save-failure";
import * as noteLogsRepo from "./note-logs";
import * as notesRepo from "./notes";
import * as tasksRepo from "./tasks";

export type NoteContentSaveResult =
  | { ok: true; revision: number }
  | { ok: false; failure: SaveFailure };

export type CardSectionSaveResult =
  | { ok: true; revision: number }
  | {
      ok: false;
      failure: SaveFailure;
      reason?: "missing-note" | "missing-anchor";
    };

const MISSING_CARD_SECTION_FAILURE: SaveFailure = {
  kind: "missing",
  message:
    "This card section was removed from the target note, so nothing typed here is being saved.",
  needsReload: false,
  retryable: false,
};

/**
 * Persist a complete note document, then reconcile every table derived from
 * that document. Both the Route Handler used by autosave and the few
 * server-only writers use this function so changing transport cannot skip
 * task, note-link, or note-log maintenance.
 */
export async function saveNoteContent(
  ownerId: string,
  id: string,
  content: SerializedEditorState,
  expectedRevision?: number,
): Promise<NoteContentSaveResult> {
  let note: Awaited<ReturnType<typeof notesRepo.updateNoteContent>>;
  try {
    note = await notesRepo.updateNoteContent(
      ownerId,
      id,
      { content },
      expectedRevision,
    );
  } catch (err) {
    console.error("[notes] content save failed:", err);
    return { ok: false, failure: serverSaveFailure(err) };
  }

  if (!note) {
    if (expectedRevision !== undefined) {
      const current = await notesRepo.getNote(ownerId, id);
      if (current && !current.deletedAt) {
        return { ok: false, failure: CONTENT_CONFLICT_FAILURE };
      }
    }
    return { ok: false, failure: MISSING_NOTE_FAILURE };
  }

  try {
    await tasksRepo.reconcileNoteTasks(ownerId, id, content);
  } catch (err) {
    console.error("[tasks] reconcile failed:", err);
  }

  try {
    await notesRepo.reconcileNoteLinks(ownerId, id, content);
  } catch (err) {
    console.error("[note-links] reconcile failed:", err);
  }

  // Unlike tasks and links, logs reconcile unconditionally so removing the
  // final log heading removes the stale row immediately.
  try {
    await noteLogsRepo.reconcileNoteLogs(ownerId, id, content);
  } catch (err) {
    console.error("[note-logs] reconcile failed:", err);
  }

  return { ok: true, revision: note.contentRevision };
}

const CONTENT_WRITE_ATTEMPTS = 3;

/** Append moved top-level blocks and run the same derived-row reconciliation
 * as a normal editor save. */
export async function appendBlocksToNoteContent(
  ownerId: string,
  targetNoteId: string,
  blocks: unknown[],
): Promise<NoteContentSaveResult> {
  for (let attempt = 0; attempt < CONTENT_WRITE_ATTEMPTS; attempt += 1) {
    const note = await notesRepo.getNote(ownerId, targetNoteId);
    if (!note || note.deletedAt) {
      return { ok: false, failure: MISSING_NOTE_FAILURE };
    }
    const content = appendBlocksToSerializedState(
      note.content as SerializedEditorState | null,
      blocks,
    );
    const saved = await saveNoteContent(
      ownerId,
      targetNoteId,
      content,
      note.contentRevision,
    );
    if (saved.ok || saved.failure.kind !== "conflict") return saved;
  }
  return { ok: false, failure: CONTENT_CONFLICT_FAILURE };
}

/** Read, splice, and persist a card-owned section of another note. */
export async function saveCardSection(
  ownerId: string,
  targetNoteId: string,
  anchorId: string,
  blocks: SerializedLexicalNode[],
): Promise<CardSectionSaveResult> {
  for (let attempt = 0; attempt < CONTENT_WRITE_ATTEMPTS; attempt += 1) {
    const note = await notesRepo.getNote(ownerId, targetNoteId);
    if (!note || note.deletedAt) {
      return {
        ok: false,
        failure: MISSING_NOTE_FAILURE,
        reason: "missing-note",
      };
    }

    const merged = replaceCardAnchorSection(
      note.content as SerializedEditorState | null,
      anchorId,
      blocks,
    );
    if (!merged) {
      return {
        ok: false,
        failure: MISSING_CARD_SECTION_FAILURE,
        reason: "missing-anchor",
      };
    }

    const saved = await saveNoteContent(
      ownerId,
      targetNoteId,
      merged,
      note.contentRevision,
    );
    if (saved.ok || saved.failure.kind !== "conflict") return saved;
  }
  return { ok: false, failure: CONTENT_CONFLICT_FAILURE };
}
