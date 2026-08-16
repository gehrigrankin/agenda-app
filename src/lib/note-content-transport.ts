import type { SerializedEditorState, SerializedLexicalNode } from "lexical";

import type {
  CardSectionSaveResult,
  NoteContentSaveResult,
} from "@/server/note-content";

async function putContent<T>(noteId: string, body: unknown): Promise<T> {
  const response = await fetch(
    `/api/notes/${encodeURIComponent(noteId)}/content`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    },
  );

  const result = (await response.json().catch(() => null)) as T | null;
  if (result && typeof result === "object") return result;
  throw new Error(`Unexpected response was received (${response.status})`);
}

export function saveNoteContentRequest(
  noteId: string,
  content: SerializedEditorState,
  expectedRevision: number,
): Promise<NoteContentSaveResult> {
  return putContent(noteId, { content, expectedRevision });
}

export function saveCardSectionRequest(
  noteId: string,
  anchorId: string,
  blocks: SerializedLexicalNode[],
): Promise<CardSectionSaveResult> {
  return putContent(noteId, { cardSection: { anchorId, blocks } });
}
