import "server-only";

import type { SerializedEditorState, SerializedLexicalNode } from "lexical";

import { replaceCardAnchorSection } from "../lib/card-anchors";
import {
  MISSING_NOTE_FAILURE,
  serverSaveFailure,
  type SaveFailure,
} from "../lib/save-failure";
import * as noteLogsRepo from "./note-logs";
import * as notesRepo from "./notes";
import * as tasksRepo from "./tasks";

export type NoteContentSaveResult =
  | { ok: true }
  | { ok: false; failure: SaveFailure };

export type CardSectionSaveResult =
  | { ok: true }
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
): Promise<NoteContentSaveResult> {
  let note: Awaited<ReturnType<typeof notesRepo.updateNoteContent>>;
  try {
    note = await notesRepo.updateNoteContent(ownerId, id, { content });
  } catch (err) {
    console.error("[notes] content save failed:", err);
    return { ok: false, failure: serverSaveFailure(err) };
  }

  if (!note) return { ok: false, failure: MISSING_NOTE_FAILURE };

  const contentStr = JSON.stringify(content);
  if (contentStr.includes('"task"')) {
    try {
      await tasksRepo.reconcileNoteTasks(ownerId, id, content);
    } catch (err) {
      console.error("[tasks] reconcile failed:", err);
    }
  }

  if (
    contentStr.includes('"note-link"') ||
    contentStr.includes('"linked-note-card"')
  ) {
    try {
      await notesRepo.reconcileNoteLinks(ownerId, id, content);
    } catch (err) {
      console.error("[note-links] reconcile failed:", err);
    }
  }

  // Unlike tasks and links, logs reconcile unconditionally so removing the
  // final log heading removes the stale row immediately.
  try {
    await noteLogsRepo.reconcileNoteLogs(ownerId, id, content);
  } catch (err) {
    console.error("[note-logs] reconcile failed:", err);
  }

  return { ok: true };
}

/** Read, splice, and persist a card-owned section of another note. */
export async function saveCardSection(
  ownerId: string,
  targetNoteId: string,
  anchorId: string,
  blocks: SerializedLexicalNode[],
): Promise<CardSectionSaveResult> {
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

  const saved = await saveNoteContent(ownerId, targetNoteId, merged);
  if (!saved.ok) {
    return saved;
  }
  return { ok: true };
}
