import "server-only";

import { z } from "zod";

import { backfillTextContent, listCorpus } from "@/server/notes";
import { upsertPersonWithData } from "@/server/people";
import { getSettings, setPeopleScannedAt } from "@/server/settings";
import { aiStructured, isAiConfigured } from "./client";

/**
 * People detection (design 15a): every person the user mentions gets a page
 * the app maintains for them — when you last talked, what you owe them, what
 * they owe you, every mention in context — without the user ever creating or
 * filing anything. The scan runs on demand (opening the People page) and
 * throttles itself; results are persisted so the page is instant afterwards
 * and rescans are idempotent.
 */

const SCAN_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h between full scans

const PeopleSchema = z.object({
  people: z
    .array(
      z.object({
        /** Canonical name as the user writes it ("Sam", "Priya"). */
        name: z.string(),
        mentions: z
          .array(
            z.object({
              noteId: z.string(),
              quote: z.string(),
            }),
          )
          .max(12),
        commitments: z
          .array(
            z.object({
              direction: z.enum(["you_owe", "they_owe"]),
              text: z.string(),
              /** Short provenance phrase, e.g. "from Tue's 1:1". */
              contextLabel: z.string(),
              /** The note the commitment was found in. */
              noteId: z.string(),
            }),
          )
          .max(8),
      }),
    )
    .max(25),
});

const SCAN_NOTES = 60;
const CHARS_PER_NOTE = 1500;

export interface PeopleScanOutcome {
  scanned: boolean;
  people: number;
}

export async function scanPeople(
  ownerId: string,
  opts: { force?: boolean } = {},
): Promise<PeopleScanOutcome> {
  if (!isAiConfigured) return { scanned: false, people: 0 };

  const settings = await getSettings(ownerId);
  if (!opts.force && settings.peopleScannedAt) {
    const age = Date.now() - settings.peopleScannedAt.getTime();
    if (age < SCAN_MIN_INTERVAL_MS) return { scanned: false, people: 0 };
  }

  await backfillTextContent(ownerId);
  const corpus = (await listCorpus(ownerId, SCAN_NOTES)).filter(
    (n) => n.text.trim().length > 0,
  );
  if (corpus.length === 0) {
    await setPeopleScannedAt(ownerId, new Date());
    return { scanned: true, people: 0 };
  }

  const dateOf = (n: (typeof corpus)[number]) => n.dailyDate ?? n.updatedAt;
  const blocks = corpus
    .map(
      (n) =>
        `<note id="${n.id}" title="${n.title.replaceAll('"', "'")}" date="${dateOf(n).toISOString().slice(0, 10)}">\n${n.text.slice(0, CHARS_PER_NOTE)}\n</note>`,
    )
    .join("\n\n");

  const result = await aiStructured({
    schema: PeopleSchema,
    maxTokens: 4000,
    effort: "medium",
    system: [
      "You track the specific named people (colleagues, friends, family — never companies, teams, or generic roles) the user mentions across their notes, so the app can maintain an auto page per person. The user never tags or files any of this themselves.",
      "name: the person's canonical name exactly as the user writes it, max 3 words.",
      "mentions: for every note where the person appears, one entry with the note's id and a SHORT VERBATIM quote (under 30 words) copied exactly from that note.",
      "commitments: only ones the notes actually state. direction 'you_owe' means the user owes the person something; 'they_owe' means the person owes the user something. text is a short phrase ('send the deck'). contextLabel is a short provenance phrase like \"from Tue's 1:1\". noteId is the note the commitment was found in. Skip anything you're not confident about — an empty list is fine.",
      "Return at most 25 people. Return an empty list rather than inventing weak matches.",
    ].join(" "),
    prompt: blocks,
  });

  const byId = new Map(corpus.map((n) => [n.id, n]));
  let count = 0;
  if (result) {
    for (const p of result.people) {
      const name = p.name.trim();
      if (!name) continue;

      const mentions = p.mentions.flatMap((m) => {
        const note = byId.get(m.noteId);
        if (!note) return []; // hallucinated id — drop
        return [
          {
            noteId: note.id,
            snippet: m.quote.slice(0, 300),
            mentionDate: dateOf(note),
          },
        ];
      });
      if (mentions.length === 0) continue; // no verifiable mentions — skip

      const commitments = p.commitments.flatMap((c) => {
        const text = c.text.trim();
        if (!text) return [];
        const note = byId.get(c.noteId);
        return [
          {
            direction: c.direction,
            text,
            contextLabel: c.contextLabel.trim() || null,
            sourceNoteId: note?.id ?? null,
          },
        ];
      });

      await upsertPersonWithData(ownerId, { name, mentions, commitments });
      count += 1;
    }
  }
  await setPeopleScannedAt(ownerId, new Date());
  return { scanned: true, people: count };
}
