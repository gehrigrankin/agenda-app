import "server-only";

import { and, desc, eq } from "drizzle-orm";
import type { SerializedEditorState } from "lexical";

import { db } from "@/db";
import { gardenerSuggestions } from "@/db/schema";
import { lexicalToPlainText } from "@/lib/lexical-text";
import { listBubbles, setBubbleFolder } from "@/server/bubbles";
import {
  appendParagraphToNote,
  backfillTextContent,
  getNote,
  linkNotes,
  listCorpus,
  listNoteLinkPairs,
  trashNote,
  type CorpusNote,
} from "@/server/notes";
import { getSettings, setGardenerScannedAt } from "@/server/settings";

/**
 * Gardener (design 15c): a weekly heuristic sweep of the library that
 * proposes one small tidy-up at a time — merge near-duplicate notes, archive
 * a board nobody has touched, link a note that quietly answers a question
 * asked elsewhere. Deliberately NOT an AI feature (must work with no API
 * key): every heuristic is plain text comparison over the same corpus the
 * AI features already read (`listCorpus`).
 *
 * Every suggestion the sweep finds is upserted on (ownerId, dedupeKey) with
 * `.onConflictDoNothing()`, so a suggestion the user already accepted or
 * dismissed (the row still exists, just with a different status) never
 * reappears — the unique index IS the "don't nag me twice" memory.
 */

export type GardenerKind = "merge_duplicate" | "archive_board" | "link_notes";

const SWEEP_MIN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days between sweeps
const CORPUS_LIMIT = 200; // personal-scale cap for the O(n^2) comparisons below
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
const STALE_BOARD_WEEKS = 8;
const MAX_MERGE_SUGGESTIONS = 6;
const MAX_LINK_SUGGESTIONS = 3;
// Cap the text pulled into memory/paste per merge so a pathologically long
// dup note can't bloat the survivor or blow past reasonable payload sizes.
const MERGE_TEXT_CAP = 4000;

// ---------------------------------------------------------------------------
// text-similarity helpers (no AI — plain normalization + word-set overlap)
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "about", "after", "again", "because", "before", "being", "cannot", "could",
  "doesn", "during", "either", "every", "first", "going", "house", "little",
  "might", "never", "other", "people", "really", "should", "simply",
  "something", "sometimes", "their", "there", "these", "thing", "things",
  "think", "those", "though", "through", "today", "under", "until", "using",
  "where", "which", "while", "would", "writing", "yesterday", "actually",
  "already", "always", "another", "around", "arent", "didnt", "doesnt",
  "doing", "from", "have", "hasnt", "havent", "here", "into", "isnt", "just",
  "know", "like", "make", "many", "more", "most", "much", "must", "need",
  "only", "over", "some", "such", "than", "that", "them", "then", "this",
  "very", "want", "well", "were", "what", "when", "will", "with", "your",
  "youre",
]);

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

function keywordsOf(sentence: string): string[] {
  return normalizeText(sentence)
    .split(" ")
    .filter((w) => w.length >= 6 && !STOPWORDS.has(w));
}

/** Sentences ending in "?" with at least 4 words — long enough to carry a
 * real question rather than a stray "right?". */
function extractQuestions(text: string): string[] {
  const matches = text.match(/[^.?!]*\?/g) ?? [];
  return matches.map((q) => q.trim()).filter((q) => q.split(/\s+/).length >= 4);
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "Sunday's note" for a daily jot, else the note's own title in quotes —
 * used to name the note a question was asked in. */
function dayLabel(note: CorpusNote): string {
  if (note.dailyDate) {
    const weekday = note.dailyDate.toLocaleDateString("en-US", {
      weekday: "long",
      timeZone: "UTC",
    });
    return `${weekday}'s note`;
  }
  return `"${note.title || "Untitled"}"`;
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
// heuristic 2 — stale boards
// ---------------------------------------------------------------------------

async function sweepStaleBoards(ownerId: string): Promise<number> {
  const all = await listBubbles(ownerId);
  const now = Date.now();
  let created = 0;
  for (const b of all) {
    if (!b.isFolder) continue; // only boards pinned to the sidebar count
    const ageWeeks = Math.floor((now - b.updatedAt.getTime()) / MS_PER_WEEK);
    if (ageWeeks < STALE_BOARD_WEEKS) continue;
    const inserted = await insertSuggestion(ownerId, {
      kind: "archive_board",
      title: `The "${b.title}" board hasn't been touched in ${ageWeeks} weeks`,
      detail: `No edits since ${formatDate(b.updatedAt)}.`,
      payload: { bubbleId: b.id },
      dedupeKey: `archive_board:${b.id}`,
    });
    if (inserted) created += 1;
  }
  return created;
}

// ---------------------------------------------------------------------------
// heuristic 3 — link suggestions (best-effort, optional per the design)
// ---------------------------------------------------------------------------

/**
 * A note "answers" a question asked in another note when it shares at least
 * two rare (6+ letter, non-stopword) keywords with that question sentence,
 * and the two notes aren't already linked in either direction. Deliberately
 * conservative — the design calls for skipping this kind entirely rather
 * than inventing weak links, so a single shared common word doesn't count.
 */
async function sweepLinkSuggestions(
  ownerId: string,
  corpus: CorpusNote[],
): Promise<number> {
  const linked = await listNoteLinkPairs(ownerId);
  let created = 0;

  for (const asker of corpus) {
    if (created >= MAX_LINK_SUGGESTIONS) break;
    const questions = extractQuestions(asker.text.slice(0, 4000));
    if (questions.length === 0) continue;

    for (const question of questions) {
      const qWords = new Set(keywordsOf(question));
      if (qWords.size < 2) continue;

      let best: { note: CorpusNote; shared: string[] } | null = null;
      for (const other of corpus) {
        if (other.id === asker.id) continue;
        if (linked.has(`${asker.id}:${other.id}`)) continue;
        const otherWords = wordSet(normalizeText(other.text.slice(0, 4000)));
        const shared = [...qWords].filter((w) => otherWords.has(w));
        if (shared.length >= 2 && (!best || shared.length > best.shared.length)) {
          best = { note: other, shared };
        }
      }
      if (!best) continue;

      const [x, y] = [asker.id, best.note.id].sort();
      const inserted = await insertSuggestion(ownerId, {
        kind: "link_notes",
        title: `"${best.note.title || "Untitled"}" answers a question you asked in ${dayLabel(asker)}`,
        detail: `Both mention ${best.shared
          .slice(0, 2)
          .map((w) => `"${w}"`)
          .join(" and ")}.`,
        payload: { sourceNoteId: best.note.id, targetNoteId: asker.id },
        dedupeKey: `link_notes:${x}:${y}`,
      });
      if (inserted) created += 1;
      break; // one link suggestion per question-asking note, then move on
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

  let created = 0;
  created += await sweepDuplicates(ownerId, corpus);
  created += await sweepStaleBoards(ownerId);
  created += await sweepLinkSuggestions(ownerId, corpus);

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
): Promise<void> {
  const [noteA, noteB] = await Promise.all([
    getNote(ownerId, noteIds[0]),
    getNote(ownerId, noteIds[1]),
  ]);
  if (!noteA || !noteB) return; // one side already gone — nothing left to merge

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
}

/**
 * Perform the suggestion's real action (merge / archive / link), then mark
 * it accepted. Returns null if the suggestion doesn't exist, isn't the
 * caller's, or was already resolved.
 */
export async function acceptSuggestion(ownerId: string, id: string) {
  const suggestion = await getOpenSuggestion(ownerId, id);
  if (!suggestion) return null;

  if (suggestion.kind === "merge_duplicate") {
    const payload = suggestion.payload as { noteIds: [string, string] };
    await mergeDuplicateNotes(ownerId, payload.noteIds);
  } else if (suggestion.kind === "archive_board") {
    const payload = suggestion.payload as { bubbleId: string };
    await setBubbleFolder(ownerId, payload.bubbleId, false);
  } else if (suggestion.kind === "link_notes") {
    const payload = suggestion.payload as {
      sourceNoteId: string;
      targetNoteId: string;
    };
    await linkNotes(ownerId, payload.sourceNoteId, payload.targetNoteId);
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
