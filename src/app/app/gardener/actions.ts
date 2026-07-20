"use server";

import { auth } from "@clerk/nextjs/server";

import {
  acceptSuggestion,
  dismissSuggestion,
  listSuggestions,
  sweep,
  type GardenerKind,
} from "@/server/gardener";
import { buildLostFoundReport } from "@/server/lost-found";
import { getNoteTitles } from "@/server/notes";

/**
 * Server actions for the Gardener page (design 15c). Same contract as the
 * app's other feature actions: Clerk auth via a local `requireUserId`,
 * owner-scoped repo calls, plain-serializable return shapes.
 */

async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  return userId;
}

type SuggestionBase = {
  id: string;
  title: string;
  detail: string | null;
  createdAt: string;
};

export type GardenerSuggestionItem =
  | (SuggestionBase & {
      kind: "merge_duplicate";
      payload: { noteIds: [string, string] };
      // Enriched with current titles so the "Show side by side" reveal can
      // link straight to both notes without a second round trip.
      notes: { id: string; title: string }[];
    })
  | (SuggestionBase & {
      kind: "archive_board";
      payload: { bubbleId: string };
    })
  | (SuggestionBase & {
      kind: "link_notes";
      payload: { sourceNoteId: string; targetNoteId: string };
    });

export async function listSuggestionsAction(): Promise<GardenerSuggestionItem[]> {
  const ownerId = await requireUserId();
  const rows = await listSuggestions(ownerId);

  // One batched lookup for every merge suggestion's note titles, rather than
  // a query per card.
  const mergeNoteIds = rows
    .filter((r) => r.kind === "merge_duplicate")
    .flatMap((r) => (r.payload as { noteIds: [string, string] }).noteIds);
  const titleRows =
    mergeNoteIds.length > 0
      ? await getNoteTitles(ownerId, [...new Set(mergeNoteIds)])
      : [];
  const titleById = new Map(titleRows.map((t) => [t.id, t.title]));

  return rows.map((r): GardenerSuggestionItem => {
    const base: SuggestionBase = {
      id: r.id,
      title: r.title,
      detail: r.detail,
      createdAt: r.createdAt.toISOString(),
    };
    if (r.kind === "merge_duplicate") {
      const payload = r.payload as { noteIds: [string, string] };
      return {
        ...base,
        kind: "merge_duplicate",
        payload,
        notes: payload.noteIds
          .filter((id) => titleById.has(id))
          .map((id) => ({ id, title: titleById.get(id) as string })),
      };
    }
    if (r.kind === "archive_board") {
      return {
        ...base,
        kind: "archive_board",
        payload: r.payload as { bubbleId: string },
      };
    }
    return {
      ...base,
      kind: "link_notes",
      payload: r.payload as { sourceNoteId: string; targetNoteId: string },
    };
  });
}

export interface SweepResult {
  scanned: boolean;
  created: number;
}

export async function sweepAction(force = false): Promise<SweepResult> {
  const ownerId = await requireUserId();
  return sweep(ownerId, { force });
}

/** Performs the suggestion's real action and marks it accepted. Returns
 * false if it was already resolved (or never existed) — the client treats
 * that as "nothing left to do" rather than an error. */
export async function acceptSuggestionAction(id: string): Promise<boolean> {
  const ownerId = await requireUserId();
  const row = await acceptSuggestion(ownerId, id);
  return row !== null;
}

export async function dismissSuggestionAction(id: string): Promise<boolean> {
  const ownerId = await requireUserId();
  const row = await dismissSuggestion(ownerId, id);
  return row !== null;
}

// --- Lost & found -----------------------------------------------------------

export interface LostFoundItems {
  strandedTasks: {
    id: string;
    title: string;
    createdAt: string;
    noteId: string | null;
    noteTitle: string | null;
  }[];
  abandonedDrafts: {
    id: string;
    title: string;
    updatedAt: string;
    chars: number;
  }[];
  agingTrash: { id: string; title: string; deletedAt: string }[];
}

/** The live "what fell through the cracks?" report (server/lost-found). */
export async function getLostFoundAction(): Promise<LostFoundItems> {
  const ownerId = await requireUserId();
  const report = await buildLostFoundReport(ownerId);
  return {
    strandedTasks: report.strandedTasks.map((t) => ({
      id: t.id,
      title: t.title,
      createdAt: t.createdAt.toISOString(),
      noteId: t.noteId,
      noteTitle: t.noteTitle,
    })),
    abandonedDrafts: report.abandonedDrafts.map((n) => ({
      id: n.id,
      title: n.title,
      updatedAt: n.updatedAt.toISOString(),
      chars: n.chars,
    })),
    agingTrash: report.agingTrash.map((n) => ({
      id: n.id,
      title: n.title,
      deletedAt: n.deletedAt.toISOString(),
    })),
  };
}

// Re-exported so the client only needs one import path for the kind union.
export type { GardenerKind };
