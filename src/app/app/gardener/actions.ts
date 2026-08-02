"use server";

import { revalidatePath } from "next/cache";

import {
  acceptSuggestion,
  dismissSuggestion,
  listDismissedSuggestions,
  listSuggestions,
  reopenSuggestion,
  sweep,
  type GardenerKind,
} from "@/server/gardener";
import { buildLostFoundReport } from "@/server/lost-found";
import { getNoteTitles } from "@/server/notes";

import { requireUserId } from "../require-user-id";

/**
 * Server actions for the Gardener page (design 15c). Same contract as the
 * app's other feature actions: Clerk auth via a local `requireUserId`,
 * owner-scoped repo calls, plain-serializable return shapes.
 */

type SuggestionBase = {
  id: string;
  title: string;
  detail: string | null;
  createdAt: string;
};

// Only merge_duplicate cards render anymore; the retired kinds
// (archive_board, link_notes) are filtered out server-side so old open rows
// in the DB never reach the client.
export type GardenerSuggestionItem = SuggestionBase & {
  kind: "merge_duplicate";
  payload: { noteIds: [string, string] };
  // Enriched with current titles so the "Show side by side" reveal can
  // link straight to both notes without a second round trip.
  notes: { id: string; title: string }[];
};

export async function listSuggestionsAction(): Promise<GardenerSuggestionItem[]> {
  const ownerId = await requireUserId();
  const rows = (await listSuggestions(ownerId)).filter(
    (r) => r.kind === "merge_duplicate",
  );

  // One batched lookup for every merge suggestion's note titles, rather than
  // a query per card.
  const mergeNoteIds = rows.flatMap(
    (r) => (r.payload as { noteIds: [string, string] }).noteIds,
  );
  const titleRows =
    mergeNoteIds.length > 0
      ? await getNoteTitles(ownerId, [...new Set(mergeNoteIds)])
      : [];
  const titleById = new Map(titleRows.map((t) => [t.id, t.title]));

  return rows.map((r): GardenerSuggestionItem => {
    const payload = r.payload as { noteIds: [string, string] };
    return {
      id: r.id,
      title: r.title,
      detail: r.detail,
      createdAt: r.createdAt.toISOString(),
      kind: "merge_duplicate",
      payload,
      notes: payload.noteIds
        .filter((id) => titleById.has(id))
        .map((id) => ({ id, title: titleById.get(id) as string })),
    };
  });
}

export interface DismissedSuggestionItem {
  id: string;
  title: string;
  resolvedAt: string | null;
}

/** Recently dismissed suggestions for the "Dismissed" disclosure. */
export async function listDismissedSuggestionsAction(): Promise<
  DismissedSuggestionItem[]
> {
  const ownerId = await requireUserId();
  const rows = await listDismissedSuggestions(ownerId);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
  }));
}

/** Undo a dismissal — the suggestion goes back to the open list. */
export async function reopenSuggestionAction(id: string): Promise<boolean> {
  const ownerId = await requireUserId();
  const row = await reopenSuggestion(ownerId, id);
  return row !== null;
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
  // Accepting can trash a note (merge) — the sidebar/notes list rendered by
  // the layouts must not go stale, same as trashNoteAction.
  if (row !== null) revalidatePath("/app", "layout");
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
  staleFolders: {
    id: string;
    title: string;
    noteCount: number;
    lastTouched: string;
  }[];
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
    staleFolders: report.staleFolders.map((f) => ({
      id: f.id,
      title: f.title,
      noteCount: f.noteCount,
      lastTouched: f.lastTouched.toISOString(),
    })),
  };
}

// Re-exported so the client only needs one import path for the kind union.
export type { GardenerKind };
