import "server-only";

import { z } from "zod";

import { listCorpus } from "@/server/notes";
import { aiStructured, isAiConfigured } from "./client";

/**
 * Voice capture extraction (design 14a): given a raw speech transcript,
 * produce a cleaned-up transcript plus the tasks, reminders, and note-link
 * ideas buried in it. Nothing returned here is committed — the UI shows the
 * extraction next to the transcript and the user keeps or discards each item.
 */

const ExtractSchema = z.object({
  cleaned: z.string(),
  tasks: z
    .array(
      z.object({
        title: z.string(),
        /** True when the memo asked for a same-day reminder ("remind me…"). */
        remindToday: z.boolean(),
      }),
    )
    .max(8),
  links: z
    .array(
      z.object({
        noteId: z.string(),
        idea: z.string(),
      }),
    )
    .max(4),
});

export interface VoiceExtraction {
  cleaned: string;
  tasks: { title: string; remindToday: boolean }[];
  links: { noteId: string; title: string; idea: string }[];
}

const CANDIDATE_TITLES = 80;

export async function extractFromTranscript(
  ownerId: string,
  transcript: string,
): Promise<VoiceExtraction | null> {
  if (!isAiConfigured) return null;
  const trimmed = transcript.trim();
  if (trimmed.length === 0) return null;

  const corpus = await listCorpus(ownerId, CANDIDATE_TITLES);
  const titleList = corpus
    .filter((n) => !n.dailyDate)
    .map((n) => `${n.id} — ${n.title}`)
    .join("\n");

  const result = await aiStructured({
    schema: ExtractSchema,
    maxTokens: 1500,
    effort: "low",
    system: [
      "You process voice-memo transcripts for a notes app.",
      "cleaned: the transcript lightly cleaned up — fix speech-to-text artifacts, drop filler words ('um', 'okay so'), keep the speaker's voice and ALL their content. Do not summarize.",
      "tasks: concrete to-dos the speaker asked for, as short imperative titles. remindToday only when they explicitly asked to be reminded (today).",
      "links: when the memo contains an idea or thought about a topic that matches one of the user's existing notes (list provided), pair that note's id with a one-line statement of the idea. Only use ids from the list; return no links when nothing clearly matches.",
    ].join(" "),
    prompt: `Existing notes (id — title):\n${titleList || "(none)"}\n\nTranscript:\n${trimmed}`,
  });
  if (!result) return null;

  const titleById = new Map(corpus.map((n) => [n.id, n.title]));
  return {
    cleaned: result.cleaned,
    tasks: result.tasks,
    links: result.links.flatMap((l) => {
      const title = titleById.get(l.noteId);
      return title ? [{ noteId: l.noteId, title, idea: l.idea }] : [];
    }),
  };
}
