import "server-only";

import { and, desc, eq } from "drizzle-orm";
import type { SerializedEditorState } from "lexical";

import { db } from "@/db";
import { gardenerSuggestions } from "@/db/schema";
import { lexicalToPlainText } from "@/lib/lexical-text";
import {
  appendParagraphToNote,
  backfillTextContent,
  getNote,
  listCorpus,
  trashNote,
  type CorpusNote,
} from "@/server/notes";
import { getSettings, setGardenerScannedAt } from "@/server/settings";

/**
 * Gardener: "find what I forgot". The page leads with the live lost & found
 * report (see server/lost-found.ts); this module keeps one minor tidy — a
 * weekly heuristic sweep proposing near-duplicate merges. Deliberately NOT
 * an AI feature (must work with no API key): the heuristic is plain text
 * comparison over the same corpus the AI features already read
 * (`listCorpus`).
 *
 * Retired kinds: `archive_board` (un-foldering hid notes; Gardener
 * resurfaces, never hides) and `link_notes` (recall + threads cover
 * relatedness — recall now skips already-linked notes). Old rows of those
 * kinds may still exist; the server stays tolerant of them (accepting one
 * resolves it as dismissed) but never creates new ones.
 *
 * Every suggestion the sweep finds is upserted on (ownerId, dedupeKey) with
 * `.onConflictDoNothing()`, so a suggestion the user already accepted or
 * dismissed (the row still exists, just with a different status) never
 * reappears — the unique index IS the "don't nag me twice" memory. Dismissal
 * is reversible: `reopenSuggestion` flips a dismissed row back to open.
 */

/** Kinds the sweep still produces. The DB enum retains the retired values
 * (`archive_board`, `link_notes`) so old rows keep loading. */
export type GardenerKind = "merge_duplicate";

const SWEEP_MIN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days between sweeps
const CORPUS_LIMIT = 200; // personal-scale cap for the O(n^2) comparisons below
const MAX_MERGE_SUGGESTIONS = 6;
const MAX_DISMISSED_LISTED = 20;
// Cap the text pulled into memory/paste per merge so a pathologically long
// dup note can't bloat the survivor or blow past reasonable payload sizes.
const MERGE_TEXT_CAP = 4000;

// ---------------------------------------------------------------------------
// text-similarity helpers (no AI — plain normalization + word-set overlap)
// ---------------------------------------------------------------------------

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordSet(s: string): Set<string> {
  return new Set(s.split(" ").filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ---------------------------------------------------------------------------
// suggestion insert (idempotent)
// ---------------------------------------------------------------------------

async function insertSuggestion(
  ownerId: string,
  s: {
    kind: GardenerKind;
    title: string;
    detail: string | null;
    payload: unknown;
    dedupeKey: string;
  },
): Promise<boolean> {
  const rows = await db
    .insert(gardenerSuggestions)
    .values({
      ownerId,
      kind: s.kind,
      title: s.title,
      detail: s.detail,
      payload: s.payload,
      dedupeKey: s.dedupeKey,
    })
    .onConflictDoNothing({
      target: [gardenerSuggestions.ownerId, gardenerSuggestions.dedupeKey],
    })
    .returning({ id: gardenerSuggestions.id });
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// heuristic 1 — near-duplicate notes
// ---------------------------------------------------------------------------

/** Why a pair looks like a duplicate: near-identical titles, or near-
 * identical opening ~120 chars of text. Either is enough evidence on its own. */
function duplicateReason(a: CorpusNote, b: CorpusNote): "title" | "text" | null {
  const na = normalizeText(a.title);
  const nb = normalizeText(b.title);
  if (na && nb && na !== "untitled" && nb !== "untitled") {
    if (na === nb) return "title";
    if (na.length >= 6 && nb.length >= 6 && jaccard(wordSet(na), wordSet(nb)) >= 0.8) {
      return "title";
    }
  }
  const pa = normalizeText(a.text.slice(0, 120));
  const pb = normalizeText(b.text.slice(0, 120));
  // Require enough characters that a match is actually signal, not two short
  // stubs that happen to share a couple of common words.
  if (pa.length >= 40 && pb.length >= 40) {
    if (pa === pb) return "text";
    if (jaccard(wordSet(pa), wordSet(pb)) >= 0.8) return "text";
  }
  return null;
}

async function sweepDuplicates(
  ownerId: string,
  corpus: CorpusNote[],
): Promise<number> {
  let created = 0;
  for (let i = 0; i < corpus.length && created < MAX_MERGE_SUGGESTIONS; i++) {
    for (let j = i + 1; j < corpus.length && created < MAX_MERGE_SUGGESTIONS; j++) {
      const a = corpus[i];
      const b = corpus[j];
      const reason = duplicateReason(a, b);
      if (!reason) continue;
      const [x, y] = [a.id, b.id].sort();
      const inserted = await insertSuggestion(ownerId, {
        kind: "merge_duplicate",
        title: `"${a.title || "Untitled"}" and "${b.title || "Untitled"}" look like the same note`,
        detail:
          reason === "title"
            ? "Titles are nearly identical."
            : "Their opening lines match almost word-for-word.",
        payload: { noteIds: [a.id, b.id] },
        dedupeKey: `merge_duplicate:${x}:${y}`,
      });
      if (inserted) created += 1;
    }
  }
  return created;
}

// ---------------------------------------------------------------------------
// sweep — self-throttled entry point
// ---------------------------------------------------------------------------

export interface SweepOutcome {
  scanned: boolean;
  created: number;
}

/**
 * Run the weekly sweep. Self-throttles against `settings.gardenerScannedAt`
 * (7 days) unless `force` is set — mirrors `scanThreads`'s throttle pattern.
 * Idempotent: rerunning finds the same evidence and no-ops via
 * onConflictDoNothing on already-open (or already-resolved) suggestions.
 */
export async function sweep(
  ownerId: string,
  opts: { force?: boolean } = {},
): Promise<SweepOutcome> {
  const settings = await getSettings(ownerId);
  if (!opts.force && settings.gardenerScannedAt) {
    const age = Date.now() - settings.gardenerScannedAt.getTime();
    if (age < SWEEP_MIN_INTERVAL_MS) return { scanned: false, created: 0 };
  }

  await backfillTextContent(ownerId);
  const corpus = (await listCorpus(ownerId, CORPUS_LIMIT)).filter(
    (n) => n.text.trim().length > 0,
  );

  // merge_duplicate is the only kind swept. archive_board is retired
  // (un-foldering a board hid its notes from every Notes surface — its
  // replacement is the read-only "revisit stale folder" resurfacing in
  // lost-found.ts) and link_notes is retired (recall + threads cover
  // relatedness; a one-off migration dismissed leftover open rows).
  const created = await sweepDuplicates(ownerId, corpus);

  await setGardenerScannedAt(ownerId, new Date());
  return { scanned: true, created };
}

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

/** Open suggestions, newest first — the page's whole data source. */
export async function listSuggestions(ownerId: string) {
  return db
    .select({
      id: gardenerSuggestions.id,
      kind: gardenerSuggestions.kind,
      title: gardenerSuggestions.title,
      detail: gardenerSuggestions.detail,
      payload: gardenerSuggestions.payload,
      createdAt: gardenerSuggestions.createdAt,
    })
    .from(gardenerSuggestions)
    .where(
      and(
        eq(gardenerSuggestions.ownerId, ownerId),
        eq(gardenerSuggestions.status, "open"),
      ),
    )
    .orderBy(desc(gardenerSuggestions.createdAt));
}

/**
 * Recently dismissed merge suggestions, newest dismissal first — feeds the
 * page's collapsed "Dismissed" disclosure so any dismissal can be undone.
 * Retired kinds are excluded: reopening one would put an unrenderable (and
 * unperformable) card back on the page.
 */
export async function listDismissedSuggestions(ownerId: string) {
  return db
    .select({
      id: gardenerSuggestions.id,
      kind: gardenerSuggestions.kind,
      title: gardenerSuggestions.title,
      resolvedAt: gardenerSuggestions.resolvedAt,
    })
    .from(gardenerSuggestions)
    .where(
      and(
        eq(gardenerSuggestions.ownerId, ownerId),
        eq(gardenerSuggestions.status, "dismissed"),
        eq(gardenerSuggestions.kind, "merge_duplicate"),
      ),
    )
    .orderBy(desc(gardenerSuggestions.resolvedAt))
    .limit(MAX_DISMISSED_LISTED);
}

async function getOpenSuggestion(ownerId: string, id: string) {
  const [row] = await db
    .select()
    .from(gardenerSuggestions)
    .where(
      and(
        eq(gardenerSuggestions.id, id),
        eq(gardenerSuggestions.ownerId, ownerId),
        eq(gardenerSuggestions.status, "open"),
      ),
    )
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// actions — perform the real thing, then mark resolved
// ---------------------------------------------------------------------------

/**
 * Fold the older note's text into the newer (survivor), then trash the
 * older. A plain-text paragraph append rather than a structural content
 * merge — simple, safe, and reversible from Trash if the user disagrees.
 */
async function mergeDuplicateNotes(
  ownerId: string,
  noteIds: [string, string],
): Promise<boolean> {
  const [noteA, noteB] = await Promise.all([
    getNote(ownerId, noteIds[0]),
    getNote(ownerId, noteIds[1]),
  ]);
  if (!noteA || !noteB) return false; // one side already gone — nothing left to merge

  const [survivor, dup] =
    noteA.updatedAt >= noteB.updatedAt ? [noteA, noteB] : [noteB, noteA];
  const dupText = (
    dup.textContent ??
    lexicalToPlainText(dup.content as SerializedEditorState | null, MERGE_TEXT_CAP)
  ).trim();
  if (dupText) {
    await appendParagraphToNote(
      ownerId,
      survivor.id,
      `— merged from "${dup.title || "Untitled"}" —`,
    );
    await appendParagraphToNote(ownerId, survivor.id, dupText.slice(0, MERGE_TEXT_CAP));
  }
  // Trash last: if the process dies after the append but before this, the
  // dup note simply survives as an untrashed duplicate — safe to re-accept
  // by hand, never data loss.
  await trashNote(ownerId, dup.id);
  return true;
}

/**
 * Perform the suggestion's real action (merge), then mark it accepted.
 * Returns null if the suggestion doesn't exist, isn't the caller's, or was
 * already resolved — or if its target vanished since the sweep (in which
 * case the row is resolved as dismissed so it neither reappears nor reads
 * as a success the app never performed).
 */
export async function acceptSuggestion(ownerId: string, id: string) {
  const suggestion = await getOpenSuggestion(ownerId, id);
  if (!suggestion) return null;

  let performed = false;
  if (suggestion.kind === "merge_duplicate") {
    const payload = suggestion.payload as { noteIds: [string, string] };
    performed = await mergeDuplicateNotes(ownerId, payload.noteIds);
  }
  // Any other kind is retired (archive_board, link_notes) or unknown:
  // accepting a leftover open row performs nothing — it resolves as
  // dismissed via the shared not-performed path below, so it neither
  // reappears nor reads as a success the app never performed.

  if (!performed) {
    await db
      .update(gardenerSuggestions)
      .set({ status: "dismissed", resolvedAt: new Date() })
      .where(
        and(
          eq(gardenerSuggestions.id, id),
          eq(gardenerSuggestions.ownerId, ownerId),
        ),
      );
    return null;
  }

  const [row] = await db
    .update(gardenerSuggestions)
    .set({ status: "accepted", resolvedAt: new Date() })
    .where(
      and(
        eq(gardenerSuggestions.id, id),
        eq(gardenerSuggestions.ownerId, ownerId),
      ),
    )
    .returning();
  return row ?? null;
}

/** Dismiss without performing the action. The row stays (status changes),
 * so the unique dedupeKey index keeps it from being re-proposed. */
export async function dismissSuggestion(ownerId: string, id: string) {
  const [row] = await db
    .update(gardenerSuggestions)
    .set({ status: "dismissed", resolvedAt: new Date() })
    .where(
      and(
        eq(gardenerSuggestions.id, id),
        eq(gardenerSuggestions.ownerId, ownerId),
        eq(gardenerSuggestions.status, "open"),
      ),
    )
    .returning();
  return row ?? null;
}

/** Undo a dismissal: flip the row back to open (clearing resolvedAt) so it
 * reappears among the open suggestions. Every dismissal is reversible. */
export async function reopenSuggestion(ownerId: string, id: string) {
  const [row] = await db
    .update(gardenerSuggestions)
    .set({ status: "open", resolvedAt: null })
    .where(
      and(
        eq(gardenerSuggestions.id, id),
        eq(gardenerSuggestions.ownerId, ownerId),
        eq(gardenerSuggestions.status, "dismissed"),
      ),
    )
    .returning();
  return row ?? null;
}
