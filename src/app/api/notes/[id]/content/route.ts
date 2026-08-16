import { NextResponse } from "next/server";
import type { SerializedEditorState, SerializedLexicalNode } from "lexical";

import { requireOwnerId } from "@/app/app/owner";
import { AUTH_FAILURE, serverSaveFailure } from "@/lib/save-failure";
import {
  saveCardSection,
  saveNoteContent,
} from "@/server/note-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FullDocumentBody = {
  content: SerializedEditorState;
  expectedRevision: number;
};
type CardSectionBody = {
  cardSection: { anchorId: string; blocks: SerializedLexicalNode[] };
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Large editor payloads deliberately use a Route Handler instead of a Server
 * Action. Server Actions default to a 1 MB body limit; this stable HTTP
 * endpoint also keeps autosave alive across deployment action-id skew.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let ownerId: string;
  try {
    ownerId = await requireOwnerId();
  } catch {
    return NextResponse.json(
      { ok: false, failure: AUTH_FAILURE },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | FullDocumentBody
    | CardSectionBody
    | null;
  if (!isObject(body)) {
    return NextResponse.json(
      { ok: false, failure: serverSaveFailure("Invalid JSON body") },
      { status: 400 },
    );
  }

  const { id } = await params;
  try {
    if (
      "cardSection" in body &&
      isObject(body.cardSection) &&
      typeof body.cardSection.anchorId === "string" &&
      Array.isArray(body.cardSection.blocks)
    ) {
      const result = await saveCardSection(
        ownerId,
        id,
        body.cardSection.anchorId,
        body.cardSection.blocks as SerializedLexicalNode[],
      );
      const status = result.ok
        ? 200
        : result.reason === "missing-note"
          ? 404
          : result.reason === "missing-anchor"
            ? 409
            : result.failure.kind === "conflict"
              ? 409
            : 500;
      return NextResponse.json(result, { status });
    }

    if (
      "content" in body &&
      isObject(body.content) &&
      "expectedRevision" in body &&
      typeof body.expectedRevision === "number" &&
      Number.isInteger(body.expectedRevision) &&
      body.expectedRevision >= 0
    ) {
      const result = await saveNoteContent(
        ownerId,
        id,
        body.content as SerializedEditorState,
        body.expectedRevision,
      );
      return NextResponse.json(result, {
        status: result.ok
          ? 200
          : result.failure.kind === "missing"
            ? 404
            : result.failure.kind === "conflict"
              ? 409
            : 500,
      });
    }
  } catch (err) {
    console.error("[api/notes/content] save failed:", err);
    return NextResponse.json(
      { ok: false, failure: serverSaveFailure(err) },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { ok: false, failure: serverSaveFailure("Invalid save payload") },
    { status: 400 },
  );
}
