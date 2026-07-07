import "server-only";

import { z } from "zod";

import { backfillTextContent, listCorpus } from "@/server/notes";
import { getSettings, setThreadsScannedAt } from "@/server/settings";
import { upsertThreadWithMentions } from "@/server/threads";
import { aiStructured, isAiConfigured } from "./client";

/**
 * Thread detection (design 14b): notice when a topic keeps appearing across
 * notes and assemble a chronological thread — every mention, in context,
 * without the user tagging anything. The scan runs on demand (opening the
 * Threads page) and throttles itself; results are persisted so the page is
 * instant afterwards and rescans are idempotent.
 */

const SCAN_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h between full scans

const ThreadsSchema = z.object({
  threads: z
    .array(
      z.object({
        topic: z.string(),
        mentions: z
          .array(
            z.object({
              noteId: z.string(),
              quote: z.string(),
              /** True for low-signal passing mentions (collapse in the UI). */
              quiet: z.boolean(),
            }),
          )
          .max(12),
      }),
    )
    .max(6),
});

const SCAN_NOTES = 60;
const CHARS_PER_NOTE = 1500;

export interface ScanOutcome {
  scanned: boolean;
  threads: number;
}

export async function scanThreads(
  ownerId: string,
  opts: { force?: boolean } = {},
): Promise<ScanOutcome> {
  if (!isAiConfigured) return { scanned: false, threads: 0 };

  const settings = await getSettings(ownerId);
  if (!opts.force && settings.threadsScannedAt) {
    const age = Date.now() - settings.threadsScannedAt.getTime();
    if (age < SCAN_MIN_INTERVAL_MS) return { scanned: false, threads: 0 };
  }

  await backfillTextContent(ownerId);
  const corpus = (await listCorpus(ownerId, SCAN_NOTES)).filter(
    (n) => n.text.trim().length > 0,
  );
  if (corpus.length < 3) {
    await setThreadsScannedAt(ownerId, new Date());
    return { scanned: true, threads: 0 };
  }

  const dateOf = (n: (typeof corpus)[number]) => n.dailyDate ?? n.updatedAt;
  const blocks = corpus
    .map(
      (n) =>
        `<note id="${n.id}" title="${n.title.replaceAll('"', "'")}" date="${dateOf(n).toISOString().slice(0, 10)}">\n${n.text.slice(0, CHARS_PER_NOTE)}\n</note>`,
    )
    .join("\n\n");

  const result = await aiStructured({
    schema: ThreadsSchema,
    maxTokens: 4000,
    effort: "medium",
    system: [
      "You find recurring topics ('threads') across a user's notes.",
      "A thread is a specific project, decision, or idea the user keeps returning to across MULTIPLE notes over time — at least 3 mentions in at least 2 different notes. One-off subjects are not threads.",
      "topic: a short noun-phrase name in the user's own vocabulary (e.g. 'Onboarding rework'), max 4 words.",
      "mentions: for every note where the topic appears, one entry with the note's id and a SHORT VERBATIM quote (under 30 words) copied exactly from that note where the topic is discussed. quiet=true for passing, low-signal mentions.",
      "Return at most 6 threads, strongest first. Return an empty list rather than inventing weak threads.",
    ].join(" "),
    prompt: blocks,
  });

  const byId = new Map(corpus.map((n) => [n.id, n]));
  let count = 0;
  if (result) {
    for (const t of result.threads) {
      const mentions = t.mentions.flatMap((m) => {
        const note = byId.get(m.noteId);
        if (!note) return []; // hallucinated id — drop
        return [
          {
            noteId: note.id,
            snippet: m.quote.slice(0, 300),
            mentionDate: dateOf(note),
            quiet: m.quiet,
          },
        ];
      });
      if (mentions.length < 2) continue;
      await upsertThreadWithMentions(ownerId, t.topic.slice(0, 80), mentions);
      count += 1;
    }
  }
  await setThreadsScannedAt(ownerId, new Date());
  return { scanned: true, threads: count };
}
