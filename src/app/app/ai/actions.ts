"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

import { docFromBlocks, heading, paragraph, quote } from "@/lib/lexical-build";
import { askNotes, type AskResult } from "@/server/ai/ask";
import {
  runAutomationsForNote,
  undoAutomationRun,
  type AutomationRunResult,
} from "@/server/ai/automations";
import { isAiConfigured } from "@/server/ai/client";
import {
  extractFromTranscript,
  type VoiceExtraction,
} from "@/server/ai/extract";
import { recallForParagraph, type RecallCard } from "@/server/ai/recall";
import { getOrBuildWeekReview } from "@/server/ai/review";
import { scanThreads, type ScanOutcome } from "@/server/ai/threads";
import {
  createAutomation,
  deleteAutomation,
  listAutomations,
  setAutomationEnabled,
} from "@/server/automations";
import {
  listTodayMeetings,
  type TodayMeetingsResult,
} from "@/server/calendar";
import { declineEvent } from "@/server/meetings";
import { appendParagraphToNote, createNote } from "@/server/notes";
import { getSettings, updateSettings } from "@/server/settings";
import { createStandaloneTask } from "@/server/tasks";
import { getThread, listThreads, setThreadStatus } from "@/server/threads";
import { insertVoiceMemo } from "@/server/voice";
import {
  getWeekReview,
  markWeekReviewInserted,
  type WeekReviewContent,
} from "@/server/week-reviews";
import { storage } from "@/lib/storage";

/**
 * Server actions for the AI feature set (ask-your-notes, recall, voice
 * capture, threads, week review, automations, meeting mode). Same contract as
 * ../actions.ts: Clerk auth via requireUserId, owner-scoped repo calls, plain
 * serializable return shapes, client-supplied local dates validated here.
 */

async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  return userId;
}

const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// status / settings
// ---------------------------------------------------------------------------

export interface AiSettingsResult {
  aiConfigured: boolean;
  calendarIcsUrl: string | null;
  recallEnabled: boolean;
}

export async function getAiSettingsAction(): Promise<AiSettingsResult> {
  const userId = await requireUserId();
  const settings = await getSettings(userId);
  return {
    aiConfigured: isAiConfigured,
    calendarIcsUrl: settings.calendarIcsUrl,
    recallEnabled: settings.recallEnabled,
  };
}

export async function setCalendarUrlAction(url: string | null): Promise<void> {
  const userId = await requireUserId();
  const trimmed = url?.trim() || null;
  if (trimmed) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error("Invalid URL");
    }
    // webcal:// is what Apple hands out; it's plain https underneath.
    if (parsed.protocol === "webcal:") {
      parsed.protocol = "https:";
    } else if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Invalid URL");
    }
    await updateSettings(userId, { calendarIcsUrl: parsed.toString() });
  } else {
    await updateSettings(userId, { calendarIcsUrl: null });
  }
}

export async function setRecallEnabledAction(enabled: boolean): Promise<void> {
  const userId = await requireUserId();
  await updateSettings(userId, { recallEnabled: enabled });
}

// ---------------------------------------------------------------------------
// 13a — ask your notes
// ---------------------------------------------------------------------------

export async function askNotesAction(
  question: string,
): Promise<AskResult | null> {
  const userId = await requireUserId();
  const trimmed = question.trim().slice(0, 500);
  if (trimmed.length < 3) return null;
  return askNotes(userId, trimmed);
}

export async function saveAnswerAsNoteAction(
  question: string,
  answer: string,
  quotes: string[],
): Promise<{ id: string }> {
  const userId = await requireUserId();
  const blocks = [
    heading(question.trim().slice(0, 200), "h2"),
    paragraph(answer.trim().slice(0, 4000)),
    ...quotes.slice(0, 4).map((q) => quote(q.slice(0, 400))),
  ];
  const note = await createNote({
    ownerId: userId,
    title: question.trim().slice(0, 120) || "Saved answer",
    content: docFromBlocks(blocks),
  });
  revalidatePath("/app", "layout");
  return { id: note.id };
}

// ---------------------------------------------------------------------------
// 13b — ambient recall
// ---------------------------------------------------------------------------

export async function recallAction(
  paragraph: string,
  excludeNoteId: string | null,
): Promise<RecallCard[]> {
  const userId = await requireUserId();
  const settings = await getSettings(userId);
  if (!settings.recallEnabled) return [];
  return recallForParagraph(userId, paragraph.slice(0, 2000), excludeNoteId);
}

// ---------------------------------------------------------------------------
// 14a — voice capture
// ---------------------------------------------------------------------------

export async function extractVoiceAction(
  transcript: string,
): Promise<VoiceExtraction | null> {
  const userId = await requireUserId();
  return extractFromTranscript(userId, transcript.slice(0, 12_000));
}

const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

export interface VoiceMemoSaveResult {
  memoId: string;
  url: string;
}

/** FormData fields: audio (Blob), noteId?, transcript?, durationSec? */
export async function saveVoiceMemoAction(
  formData: FormData,
): Promise<VoiceMemoSaveResult | null> {
  const userId = await requireUserId();
  const audio = formData.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return null;
  if (audio.size > MAX_AUDIO_BYTES) throw new Error("Recording too large");
  const noteId = (formData.get("noteId") as string | null) || null;
  const transcript = ((formData.get("transcript") as string | null) ?? "").slice(
    0,
    12_000,
  );
  const durationRaw = Number(formData.get("durationSec"));
  const durationSec =
    Number.isFinite(durationRaw) && durationRaw > 0
      ? Math.round(durationRaw)
      : null;

  const ext = audio.type.includes("mp4") ? "m4a" : "webm";
  const stored = await storage.put({
    ownerId: userId,
    fileName: `voice-memo-${Date.now()}.${ext}`,
    contentType: audio.type || "audio/webm",
    body: Buffer.from(await audio.arrayBuffer()),
  });
  const memo = await insertVoiceMemo(userId, {
    noteId,
    url: stored.url,
    storageKey: stored.key,
    durationSec,
    transcript,
  });
  return { memoId: memo.id, url: stored.url };
}

export interface KeepExtractionInput {
  tasks: { title: string; remindToday: boolean }[];
  links: { noteId: string; idea: string }[];
  todayStr: string;
}

/** Commit the kept extraction items: create tasks, append link ideas. */
export async function keepVoiceExtractionAction(
  input: KeepExtractionInput,
): Promise<{ taskIds: string[] }> {
  const userId = await requireUserId();
  if (!DATE_STR_RE.test(input.todayStr)) throw new Error("Invalid date");
  const taskIds: string[] = [];
  for (const t of input.tasks.slice(0, 8)) {
    const title = t.title.trim().slice(0, 200);
    if (!title) continue;
    const dueAt = t.remindToday
      ? new Date(`${input.todayStr}T00:00:00.000Z`)
      : null;
    const task = await createStandaloneTask(userId, title, dueAt);
    taskIds.push(task.id);
  }
  for (const l of input.links.slice(0, 4)) {
    const idea = l.idea.trim().slice(0, 500);
    if (!idea) continue;
    await appendParagraphToNote(userId, l.noteId, idea);
  }
  return { taskIds };
}

// ---------------------------------------------------------------------------
// 14b — threads
// ---------------------------------------------------------------------------

export interface ThreadListItem {
  id: string;
  topic: string;
  status: "active" | "promoted" | "dismissed";
  promotedNoteId: string | null;
  mentionCount: number;
  firstMentionAt: string | null;
  lastMentionAt: string | null;
}

export async function listThreadsAction(): Promise<ThreadListItem[]> {
  const userId = await requireUserId();
  const rows = await listThreads(userId);
  return rows.map((t) => ({
    id: t.id,
    topic: t.topic,
    status: t.status,
    promotedNoteId: t.promotedNoteId,
    mentionCount: t.mentionCount,
    firstMentionAt: t.firstMentionAt?.toISOString() ?? null,
    lastMentionAt: t.lastMentionAt?.toISOString() ?? null,
  }));
}

export async function scanThreadsAction(force = false): Promise<ScanOutcome> {
  const userId = await requireUserId();
  return scanThreads(userId, { force });
}

export interface ThreadMentionItem {
  id: string;
  noteId: string;
  noteTitle: string;
  noteDailyDate: string | null;
  snippet: string;
  mentionDate: string;
  quiet: boolean;
}

export interface ThreadDetailResult {
  id: string;
  topic: string;
  status: "active" | "promoted" | "dismissed";
  promotedNoteId: string | null;
  mentions: ThreadMentionItem[];
}

export async function getThreadAction(
  threadId: string,
): Promise<ThreadDetailResult | null> {
  const userId = await requireUserId();
  const thread = await getThread(userId, threadId);
  if (!thread) return null;
  return {
    id: thread.id,
    topic: thread.topic,
    status: thread.status,
    promotedNoteId: thread.promotedNoteId,
    mentions: thread.mentions.map((m) => ({
      id: m.id,
      noteId: m.noteId,
      noteTitle: m.noteTitle,
      noteDailyDate: m.noteDailyDate
        ? m.noteDailyDate.toISOString().slice(0, 10)
        : null,
      snippet: m.snippet,
      mentionDate: m.mentionDate.toISOString(),
      quiet: m.quiet,
    })),
  };
}

/** Promote a thread to a real note built from its mention timeline. */
export async function promoteThreadAction(
  threadId: string,
): Promise<{ noteId: string } | null> {
  const userId = await requireUserId();
  const thread = await getThread(userId, threadId);
  if (!thread) return null;
  const blocks = [
    heading(thread.topic, "h1"),
    ...thread.mentions.flatMap((m) => {
      const day = m.mentionDate.toISOString().slice(0, 10);
      return [paragraph(`${day} — ${m.noteTitle}`), quote(m.snippet)];
    }),
  ];
  const note = await createNote({
    ownerId: userId,
    title: thread.topic,
    content: docFromBlocks(blocks),
  });
  await setThreadStatus(userId, threadId, "promoted", note.id);
  revalidatePath("/app", "layout");
  return { noteId: note.id };
}

export async function dismissThreadAction(threadId: string): Promise<void> {
  const userId = await requireUserId();
  await setThreadStatus(userId, threadId, "dismissed");
}

// ---------------------------------------------------------------------------
// 14d — week in review
// ---------------------------------------------------------------------------

export interface WeekReviewResult {
  weekStart: string;
  content: WeekReviewContent;
  inserted: boolean;
}

export async function getWeekReviewAction(
  weekStart: string,
  startIso: string,
  endIso: string,
  force = false,
): Promise<WeekReviewResult | null> {
  const userId = await requireUserId();
  if (!DATE_STR_RE.test(weekStart)) throw new Error("Invalid week start");
  const row = force
    ? await getOrBuildWeekReview(userId, weekStart, startIso, endIso, {
        force: true,
      })
    : ((await getWeekReview(userId, weekStart)) ??
      (await getOrBuildWeekReview(userId, weekStart, startIso, endIso)));
  if (!row) return null;
  return {
    weekStart: row.weekStart,
    content: row.content as WeekReviewContent,
    inserted: row.insertedNoteId !== null,
  };
}

export async function markWeekReviewInsertedAction(
  weekStart: string,
  noteId: string,
): Promise<void> {
  const userId = await requireUserId();
  if (!DATE_STR_RE.test(weekStart)) throw new Error("Invalid week start");
  await markWeekReviewInserted(userId, weekStart, noteId);
}

// ---------------------------------------------------------------------------
// 14e — automations
// ---------------------------------------------------------------------------

export interface AutomationItem {
  id: string;
  rule: string;
  enabled: boolean;
  lastRun: {
    id: string;
    summary: string;
    createdAt: string;
    undoneAt: string | null;
    canUndo: boolean;
  } | null;
}

export async function listAutomationsAction(): Promise<AutomationItem[]> {
  const userId = await requireUserId();
  const rows = await listAutomations(userId);
  return rows.map((a) => ({
    id: a.id,
    rule: a.rule,
    enabled: a.enabled,
    lastRun: a.lastRun
      ? {
          id: a.lastRun.id,
          summary: a.lastRun.summary,
          createdAt: a.lastRun.createdAt.toISOString(),
          undoneAt: a.lastRun.undoneAt?.toISOString() ?? null,
          canUndo: a.lastRun.canUndo,
        }
      : null,
  }));
}

export async function createAutomationAction(rule: string): Promise<void> {
  const userId = await requireUserId();
  const trimmed = rule.trim().slice(0, 500);
  if (trimmed.length < 8) throw new Error("Rule too short");
  await createAutomation(userId, trimmed);
}

export async function setAutomationEnabledAction(
  id: string,
  enabled: boolean,
): Promise<void> {
  const userId = await requireUserId();
  await setAutomationEnabled(userId, id, enabled);
}

export async function deleteAutomationAction(id: string): Promise<void> {
  const userId = await requireUserId();
  await deleteAutomation(userId, id);
}

/**
 * Evaluate the user's rules against a note. The client calls this after a
 * quiet period of editing; the runner throttles per note on top of that. No
 * revalidate — results surface through the Automations page and task widgets'
 * own refresh events.
 */
export async function runAutomationsForNoteAction(
  noteId: string,
  todayStr: string,
): Promise<AutomationRunResult[]> {
  const userId = await requireUserId();
  if (!DATE_STR_RE.test(todayStr)) throw new Error("Invalid date");
  return runAutomationsForNote(userId, noteId, todayStr);
}

export async function undoAutomationRunAction(
  runId: string,
): Promise<boolean> {
  const userId = await requireUserId();
  return undoAutomationRun(userId, runId);
}

// ---------------------------------------------------------------------------
// 14c — meeting mode
// ---------------------------------------------------------------------------

export async function getTodayMeetingsAction(
  dayStartIso: string,
  dayEndIso: string,
  todayNoteId: string | null,
): Promise<TodayMeetingsResult> {
  const userId = await requireUserId();
  return listTodayMeetings(userId, dayStartIso, dayEndIso, todayNoteId);
}

export async function declineMeetingAction(eventUid: string): Promise<void> {
  const userId = await requireUserId();
  if (!eventUid || eventUid.length > 512) throw new Error("Invalid event");
  await declineEvent(userId, eventUid);
}
