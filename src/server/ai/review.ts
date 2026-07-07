import "server-only";

import { z } from "zod";

import { backfillTextContent, listCorpus } from "@/server/notes";
import { listTasksCompletedBetween, listTasksDue } from "@/server/tasks";
import { listThreads } from "@/server/threads";
import {
  getWeekReview,
  upsertWeekReview,
  type WeekReviewContent,
} from "@/server/week-reviews";
import { aiStructured, isAiConfigured } from "./client";

/**
 * Week in review (design 14d): a drafted retrospective of the week — what got
 * done, what's still open — built from the user's own daily notes and task
 * history, each line referencing the day it came from. Cached per (owner,
 * week) so the Sunday card renders instantly after the first build.
 */

const ReviewSchema = z.object({
  done: z.string(),
  doneDays: z.array(z.string()).max(7),
  stillOpen: z.string(),
  openDays: z.array(z.string()).max(7),
});

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const CHARS_PER_DAY = 1200;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(dayStr: string, days: number): string {
  const d = new Date(`${dayStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDay(d);
}

/**
 * Return the cached review for the week, building (and caching) it when
 * missing. `weekStart` is the local Monday; `startIso`/`endIso` are the
 * client-computed wall-clock bounds of that week, used for task timestamps.
 */
export async function getOrBuildWeekReview(
  ownerId: string,
  weekStart: string,
  startIso: string,
  endIso: string,
  opts: { force?: boolean } = {},
) {
  if (!DAY_RE.test(weekStart)) throw new Error("Invalid week start");
  const cached = await getWeekReview(ownerId, weekStart);
  if (cached && !opts.force) return cached;
  if (!isAiConfigured) return cached;

  const weekEnd = addDays(weekStart, 6);
  await backfillTextContent(ownerId);
  const corpus = await listCorpus(ownerId);
  const dailies = corpus
    .filter((n) => {
      if (!n.dailyDate) return false;
      const day = isoDay(n.dailyDate);
      return day >= weekStart && day <= weekEnd;
    })
    .sort((a, b) => a.dailyDate!.getTime() - b.dailyDate!.getTime());

  const start = new Date(startIso);
  const end = new Date(endIso);
  const done = await listTasksCompletedBetween(ownerId, start, end);
  const open = await listTasksDue(ownerId, weekEnd);

  if (dailies.length === 0 && done.length === 0 && open.length === 0) {
    return cached; // nothing to review
  }

  const noteBlocks = dailies
    .map(
      (n) =>
        `<day date="${isoDay(n.dailyDate!)}">\n${n.text.slice(0, CHARS_PER_DAY)}\n</day>`,
    )
    .join("\n");
  const doneList = done
    .map((t) => `- ${t.title} (${isoDay(t.completedAt!)})`)
    .join("\n");
  const openList = open.map((t) => `- ${t.title}`).join("\n");

  const result = await aiStructured({
    schema: ReviewSchema,
    maxTokens: 1200,
    effort: "medium",
    system: [
      "You draft a short weekly retrospective for a notes app, written in second person, built ONLY from the user's daily notes and task lists below.",
      "done: 1-3 sentences on what got finished or moved forward this week; mention the total count of closed tasks when there is one.",
      "stillOpen: 1-2 sentences on what's still open or carried — be honest about things that stalled (e.g. touched twice but never finished).",
      "It should read like something the user would write themselves: plain, specific, no filler.",
      "doneDays / openDays: the YYYY-MM-DD dates (from the provided material) that the respective text refers to, in the order referenced, so the UI can link them.",
    ].join(" "),
    prompt: `Week ${weekStart} to ${weekEnd}.\n\nDaily notes:\n${noteBlocks || "(none)"}\n\nTasks completed this week:\n${doneList || "(none)"}\n\nStill open at week's end:\n${openList || "(none)"}`,
  });
  if (!result) return cached;

  // Threads that moved this week come straight from the threads table — no
  // model needed for a count.
  let threadStats: WeekReviewContent["threads"] = [];
  try {
    const threads = await listThreads(ownerId);
    threadStats = threads
      .filter((t) => {
        if (!t.lastMentionAt) return false;
        const day = isoDay(t.lastMentionAt);
        return day >= weekStart && day <= weekEnd;
      })
      .slice(0, 4)
      .map((t) => ({ topic: t.topic, mentions: t.mentionCount }));
  } catch {
    // threads are optional garnish; never fail the review over them
  }

  const content: WeekReviewContent = {
    done: result.done,
    doneDays: result.doneDays.filter((d) => DAY_RE.test(d)),
    stillOpen: result.stillOpen,
    openDays: result.openDays.filter((d) => DAY_RE.test(d)),
    threads: threadStats,
  };
  return upsertWeekReview(ownerId, weekStart, content);
}
