import "server-only";

import {
  backfillTextContent,
  listCorpus,
  type CorpusNote,
} from "@/server/notes";
import {
  bestSnippet,
  daysBetween,
  keywords,
  recencyBoost,
  scoreText,
} from "@/lib/text-rank";

/**
 * Ambient recall (design 13b): as the user writes, quietly surface the past —
 * a note that already touches the topic of the paragraph being typed.
 *
 * Deliberately NOT an AI call: it fires on every typing pause, so it must be
 * fast, free, and private. Pure lexical ranking over the corpus; the model is
 * never consulted. "appears only while you pause · never inserts anything
 * itself".
 */

export interface RecallCard {
  noteId: string;
  title: string;
  /**
   * "decision" = an older note whose matching sentence reads like something
   * settled ("you decided this once"); "related" otherwise.
   */
  kind: "decision" | "related";
  /** YYYY-MM-DD of the daily note, or null for regular notes. */
  dateLabel: string | null;
  snippet: string;
}

const DECISION_RE =
  /\b(decided|decision|agreed|settled|chose|going with|must be|should be|won'?t|leaning toward)\b/i;

const MIN_SCORE = 2.5;
const MAX_CARDS = 2;

export async function recallForParagraph(
  ownerId: string,
  paragraph: string,
  excludeNoteId: string | null,
): Promise<RecallCard[]> {
  const trimmed = paragraph.trim();
  if (trimmed.length < 20) return [];
  const terms = keywords(trimmed);
  if (terms.length < 2) return [];

  await backfillTextContent(ownerId, 50);
  const corpus = await listCorpus(ownerId);
  const now = new Date();

  const scored = corpus
    .filter((n) => n.id !== excludeNoteId && n.text.length > 0)
    .map((note) => ({
      note,
      score:
        scoreText(terms, note.text, note.title) +
        recencyBoost(note.updatedAt, now) * 0.5,
    }))
    .filter((s) => s.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CARDS);

  return scored.map(({ note }) => toCard(note, terms, now));
}

function toCard(note: CorpusNote, terms: string[], now: Date): RecallCard {
  const snippet = bestSnippet(terms, note.text);
  const ageDays = daysBetween(note.updatedAt, now);
  const kind =
    DECISION_RE.test(snippet) && ageDays > 5 ? "decision" : "related";
  return {
    noteId: note.id,
    title: note.title,
    kind,
    dateLabel: note.dailyDate
      ? note.dailyDate.toISOString().slice(0, 10)
      : null,
    snippet,
  };
}
