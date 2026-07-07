import "server-only";

import { z } from "zod";

import {
  backfillTextContent,
  listCorpus,
  type CorpusNote,
} from "@/server/notes";
import { keywords, recencyBoost, scoreText } from "@/lib/text-rank";
import { aiStructured, isAiConfigured } from "./client";

/**
 * "Ask your notes" (design 13a): answer a natural-language question strictly
 * from the user's own notes, with every claim pinned to a verbatim quote from
 * a specific note. Retrieval is lexical (term overlap + recency) over the
 * plain-text corpus; the model only sees the top candidates.
 */

const CANDIDATES = 16;
const CHARS_PER_NOTE = 2400;

const AskSchema = z.object({
  answer: z.string(),
  sources: z
    .array(
      z.object({
        noteId: z.string(),
        quote: z.string(),
      }),
    )
    .max(4),
});

export interface AskSource {
  noteId: string;
  title: string;
  /** YYYY-MM-DD when the source is a daily note. */
  dailyDate: string | null;
  quote: string;
}

export interface AskResult {
  answer: string;
  sources: AskSource[];
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function pickCandidates(question: string, corpus: CorpusNote[]): CorpusNote[] {
  const terms = keywords(question);
  const now = new Date();
  const scored = corpus
    .map((note) => ({
      note,
      score:
        scoreText(terms, note.text, note.title) +
        recencyBoost(note.updatedAt, now),
    }))
    .filter((s) => s.score > 0.2)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, CANDIDATES).map((s) => s.note);
}

export async function askNotes(
  ownerId: string,
  question: string,
): Promise<AskResult | null> {
  if (!isAiConfigured) return null;
  await backfillTextContent(ownerId);
  const corpus = await listCorpus(ownerId);
  const candidates = pickCandidates(question, corpus);
  if (candidates.length === 0) {
    return { answer: "Nothing in your notes seems to cover that.", sources: [] };
  }

  const blocks = candidates
    .map((n) => {
      const date = n.dailyDate
        ? `daily note for ${isoDay(n.dailyDate)}`
        : `last edited ${isoDay(n.updatedAt)}`;
      const text = n.text.slice(0, CHARS_PER_NOTE);
      return `<note id="${n.id}" title="${n.title.replaceAll('"', "'")}" date="${date}">\n${text}\n</note>`;
    })
    .join("\n\n");

  const result = await aiStructured({
    schema: AskSchema,
    maxTokens: 1500,
    effort: "medium",
    system: [
      "You answer questions using ONLY the user's own notes, provided below.",
      "Never use outside knowledge; if the notes don't contain the answer, say so plainly.",
      "Write the answer in second person ('you noted…'), 1-3 sentences, concrete, mentioning dates when the notes provide them.",
      "Cite 1-4 sources: each source is the id of a note you actually drew from plus a SHORT VERBATIM quote (under 25 words) copied exactly from that note's text.",
    ].join(" "),
    prompt: `${blocks}\n\nQuestion: ${question}`,
  });
  if (!result) return null;

  const byId = new Map(candidates.map((n) => [n.id, n]));
  const sources: AskSource[] = [];
  for (const s of result.sources) {
    const note = byId.get(s.noteId);
    if (!note) continue; // hallucinated id — drop
    sources.push({
      noteId: note.id,
      title: note.title,
      dailyDate: note.dailyDate ? isoDay(note.dailyDate) : null,
      quote: s.quote,
    });
  }
  return { answer: result.answer, sources };
}
