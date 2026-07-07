import "server-only";

import { z } from "zod";

import {
  getRun,
  lastRunAtForNote,
  listEnabledAutomations,
  markRunUndone,
  recordRun,
} from "@/server/automations";
import {
  appendParagraphToNote,
  appendTaskNodeToNote,
  getNote,
  listCorpus,
  removeParagraphFromNote,
  removeTaskNodeFromNote,
} from "@/server/notes";
import {
  createStandaloneTask,
  deleteTask,
  findOpenTaskByTitle,
  linkTaskToNote,
} from "@/server/tasks";
import { aiStructured, isAiConfigured } from "./client";

/**
 * Automations runner (design 14e): plain-language rules, run on what the user
 * writes. One model call evaluates ALL enabled rules against the saved note;
 * every action taken is an ordinary edit recorded with undo data. Execution is
 * idempotent (duplicate tasks / already-appended text are skipped) because
 * autosave means the same note text will be evaluated more than once.
 */

const RunSchema = z.object({
  actions: z
    .array(
      z.object({
        automationId: z.string(),
        kind: z.enum(["create_task", "append_task", "append_note", "none"]),
        /** create_task / append_task: the task title. */
        taskTitle: z.string().nullable(),
        /** create_task: true when the rule implies a due date of today. */
        dueToday: z.boolean().nullable(),
        /** append_task / append_note: id of the target note (from the list). */
        targetNoteId: z.string().nullable(),
        /** append_note: the exact line to append. */
        appendText: z.string().nullable(),
        /** Short past-tense description, e.g. 'added "The Design of Everyday Things"'. */
        summary: z.string().nullable(),
      }),
    )
    .max(10),
});

export type UndoData =
  | { kind: "create_task"; taskId: string }
  | { kind: "append_task"; noteId: string; taskId: string }
  | { kind: "append_note"; noteId: string; appendedText: string };

export interface AutomationRunResult {
  runId: string;
  automationId: string;
  summary: string;
  canUndo: boolean;
}

const NOTE_THROTTLE_MS = 60_000;
const CANDIDATE_TITLES = 80;

export async function runAutomationsForNote(
  ownerId: string,
  noteId: string,
  todayStr: string,
): Promise<AutomationRunResult[]> {
  if (!isAiConfigured) return [];
  const rules = await listEnabledAutomations(ownerId);
  if (rules.length === 0) return [];

  // Server-side backstop on top of the client's idle gate: at most one
  // recorded run per note per minute.
  const lastRun = await lastRunAtForNote(ownerId, noteId);
  if (lastRun && Date.now() - lastRun.getTime() < NOTE_THROTTLE_MS) return [];

  const note = await getNote(ownerId, noteId);
  if (!note || note.deletedAt) return [];
  const text = note.textContent ?? "";
  if (text.trim().length === 0) return [];

  const corpus = await listCorpus(ownerId, CANDIDATE_TITLES);
  const titleList = corpus
    .filter((n) => n.id !== noteId && !n.dailyDate)
    .map((n) => `${n.id} — ${n.title}`)
    .join("\n");
  const ruleList = rules.map((r) => `${r.id} — ${r.rule}`).join("\n");

  const result = await aiStructured({
    schema: RunSchema,
    maxTokens: 1200,
    effort: "low",
    system: [
      "You execute a user's plain-language automation rules against a note they just wrote.",
      "For each rule, decide whether the note's CURRENT text triggers it. Most saves trigger nothing — when in doubt, return kind=none for that rule.",
      "create_task: use when the rule says to create/flag a standalone to-do; taskTitle is short and imperative; dueToday only when the rule implies today.",
      "append_task: use when the rule adds an ITEM to a list-like note (reading list, shopping list, watch list…) — the item becomes a checkbox task in that note. taskTitle is the item (e.g. the book title); targetNoteId MUST come from the provided list. Prefer this over append_note for list additions.",
      "append_note: use only when the rule adds a plain line of prose to another note; appendText is the exact single line.",
      "summary: short past-tense, quoting the captured content, naming the target note when there is one.",
      "Never invent actions a rule doesn't describe. One action per rule at most.",
    ].join(" "),
    prompt: `Rules (id — rule):\n${ruleList}\n\nOther notes (id — title):\n${titleList || "(none)"}\n\nNote "${note.title}" (${todayStr}):\n${text.slice(0, 6000)}`,
  });
  if (!result) return [];

  const ruleIds = new Set(rules.map((r) => r.id));
  const results: AutomationRunResult[] = [];
  for (const action of result.actions) {
    if (!ruleIds.has(action.automationId)) continue;
    if (action.kind === "none") continue;

    if (action.kind === "create_task" && action.taskTitle) {
      const title = action.taskTitle.trim();
      if (!title) continue;
      // Idempotence: the same text will be re-evaluated on later autosaves.
      if (await findOpenTaskByTitle(ownerId, title)) continue;
      const dueAt = action.dueToday
        ? new Date(`${todayStr}T00:00:00.000Z`)
        : null;
      const task = await createStandaloneTask(ownerId, title, dueAt);
      const summary = action.summary ?? `created task "${title}"`;
      const run = await recordRun(ownerId, action.automationId, noteId, summary, {
        kind: "create_task",
        taskId: task.id,
      } satisfies UndoData);
      results.push({
        runId: run.id,
        automationId: action.automationId,
        summary,
        canUndo: true,
      });
    }

    if (
      action.kind === "append_task" &&
      action.targetNoteId &&
      action.taskTitle
    ) {
      const target = await getNote(ownerId, action.targetNoteId);
      if (!target || target.deletedAt) continue;
      const title = action.taskTitle.trim();
      if (!title) continue;
      // Idempotence: skip when the target already lists the item.
      if ((target.textContent ?? "").includes(title)) continue;
      const task = await createStandaloneTask(ownerId, title, null);
      await appendTaskNodeToNote(ownerId, target.id, task.id, title);
      await linkTaskToNote(ownerId, target.id, task.id);
      const summary = action.summary ?? `added "${title}" to ${target.title}`;
      const run = await recordRun(ownerId, action.automationId, noteId, summary, {
        kind: "append_task",
        noteId: target.id,
        taskId: task.id,
      } satisfies UndoData);
      results.push({
        runId: run.id,
        automationId: action.automationId,
        summary,
        canUndo: true,
      });
    }

    if (
      action.kind === "append_note" &&
      action.targetNoteId &&
      action.appendText
    ) {
      const target = await getNote(ownerId, action.targetNoteId);
      if (!target || target.deletedAt) continue;
      const line = action.appendText.trim();
      if (!line) continue;
      // Idempotence: skip when the target already contains the line.
      if ((target.textContent ?? "").includes(line)) continue;
      await appendParagraphToNote(ownerId, target.id, line);
      const summary = action.summary ?? `added "${line}" to ${target.title}`;
      const run = await recordRun(ownerId, action.automationId, noteId, summary, {
        kind: "append_note",
        noteId: target.id,
        appendedText: line,
      } satisfies UndoData);
      results.push({
        runId: run.id,
        automationId: action.automationId,
        summary,
        canUndo: true,
      });
    }
  }
  return results;
}

/** Revert a recorded automation action. Safe to call once; repeat calls no-op. */
export async function undoAutomationRun(ownerId: string, runId: string) {
  const run = await getRun(ownerId, runId);
  if (!run || run.undoneAt || !run.undoData) return false;
  const undo = run.undoData as UndoData;
  if (undo.kind === "create_task") {
    await deleteTask(ownerId, undo.taskId);
  } else if (undo.kind === "append_task") {
    await removeTaskNodeFromNote(ownerId, undo.noteId, undo.taskId);
    await deleteTask(ownerId, undo.taskId); // join rows cascade
  } else if (undo.kind === "append_note") {
    await removeParagraphFromNote(ownerId, undo.noteId, undo.appendedText);
  } else {
    return false;
  }
  await markRunUndone(ownerId, runId);
  return true;
}
