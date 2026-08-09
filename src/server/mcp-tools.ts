import "server-only";

import type { SerializedEditorState } from "lexical";

import { localDateString, localDayBounds } from "@/lib/dates";
import {
  blocksToMarkdown,
  docToMarkdown,
  markdownToBlocks,
  markdownToDoc,
} from "@/lib/markdown-lexical";
import { parseHashtags } from "@/lib/hashtags";
import { describeSchedule, type RecurrenceSpec } from "@/lib/recurrence";
import * as automationsRepo from "@/server/automations";
import * as blocksRepo from "@/server/blocks";
import * as bubblesRepo from "@/server/bubbles";
import * as calendarRepo from "@/server/calendar";
import * as eventsRepo from "@/server/events";
import * as habitsRepo from "@/server/habits";
import * as inboxRepo from "@/server/inbox";
import * as meetingsRepo from "@/server/meetings";
import * as noteLogsRepo from "@/server/note-logs";
import * as notesRepo from "@/server/notes";
import * as peopleRepo from "@/server/people";
import * as recurringRepo from "@/server/recurring";
import * as settingsRepo from "@/server/settings";
import * as tagsRepo from "@/server/tags";
import * as tasksRepo from "@/server/tasks";
import * as threadsRepo from "@/server/threads";
import * as weekReviewsRepo from "@/server/week-reviews";

/**
 * The tool surface the MCP server exposes — notes, tasks, tags, folders,
 * daily jots, call logs, people, threads, habits, recurrence rules, the
 * calendar, timeline blocks, automations, week reviews, settings, and the
 * capture inbox.
 *
 * Every handler takes `ownerId` explicitly and calls the same `src/server/*`
 * repo functions the UI's server actions call. That layering is the reason
 * this file is short: the data layer was already owner-scoped, so the API is
 * a description of it rather than a reimplementation. Nothing here touches
 * Drizzle directly, and nothing here is reachable without
 * `authenticateApiRequest` having pinned an owner first.
 *
 * Assistants speak markdown; notes are stored as serialized Lexical state.
 * `src/lib/markdown-lexical.ts` is the boundary, and it is deliberately lossy
 * — see its header for exactly what survives a round trip.
 *
 * Schemas are hand-written JSON Schema rather than generated from Zod: MCP
 * ships them verbatim to the client, and the description text is what the
 * assistant actually reads to decide whether a tool applies. They're prose
 * for a reader, not just validation.
 *
 * NO MODEL SPEND: not one handler here may reach an `src/server/ai/*` entry
 * point. An MCP client is already a model — paying for a second one behind its
 * back is exactly the "unasked model call" the repo forbids. The one repo
 * function in this surface's reach that calls a model is
 * `inbox.addSharedItem` (via `suggestDestination`); it is deliberately not
 * exposed, and the inbox section below says so at its point of absence.
 */

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (ownerId: string, args: Record<string, unknown>) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Argument coercion. MCP clients are language models: they send "3" for a
// number and omit optional fields inconsistently. Coerce leniently, but reject
// anything that would silently act on the wrong thing (a missing id, a
// malformed date) — a confidently-wrong write is worse than an error the
// assistant can read and retry.
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function str(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function requireStr(args: Record<string, unknown>, key: string): string {
  const v = str(args, key);
  if (v === undefined) throw new Error(`Missing required argument: ${key}`);
  return v;
}

function num(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return undefined;
}

function bool(args: Record<string, unknown>, key: string): boolean | undefined {
  const v = args[key];
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}

function strList(args: Record<string, unknown>, key: string): string[] {
  const v = args[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.length > 0);
}

/** A YYYY-MM-DD argument, validated. Dates drive due-date and daily-jot writes. */
function dateStr(args: Record<string, unknown>, key: string): string | undefined {
  const v = str(args, key);
  if (v === undefined) return undefined;
  if (!DATE_RE.test(v)) {
    throw new Error(`${key} must be YYYY-MM-DD, got: ${v}`);
  }
  return v;
}

/** Midnight UTC of a local calendar day — the convention `setTaskDue` uses. */
function dueDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

function clampLimit(n: number | undefined, fallback: number, max: number) {
  if (n === undefined) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(n)));
}

/** ISO strings, not Date objects — this crosses a JSON boundary. */
function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

/**
 * Put a task on a note — BOTH halves, and in this order.
 *
 * A task is on a note when two things are true: a `task` node carrying its id
 * sits in the note's serialized content, and a `note_tasks` row joins them.
 * Writing only the join row looks like it works and then quietly undoes
 * itself: `reconcileNoteTasks` derives the entire link set from note content
 * on the next editor save, deletes any link older than its 60-second grace
 * window that has no matching node — and then hard-deletes any task that was
 * left with no links at all. An assistant that attached a task this way would
 * be destroying the user's task a minute later.
 *
 * Content first, then the link, matching the pairing the automations runner
 * uses (`src/server/ai/automations.ts`). If the content write fails there is
 * no link to strand; if the link write fails the checkbox is visible and the
 * next editor save reconciles it into existence.
 */
async function attachTaskToNote(
  ownerId: string,
  noteId: string,
  taskId: string,
  title: string,
): Promise<void> {
  const note = await notesRepo.appendTaskNodeToNote(
    ownerId,
    noteId,
    taskId,
    title,
  );
  // Never report success for a note that isn't there — the assistant would
  // tell the user their task is on a list it never reached.
  if (!note) throw new Error("Note not found");
  await tasksRepo.linkTaskToNote(ownerId, noteId, taskId);
}

/**
 * A calendar day as YYYY-MM-DD. `notes.dailyDate` is a Postgres `date`, which
 * the driver hands back as a Date — returning that verbatim gives an assistant
 * a full UTC timestamp for something that is a day, and invites it to reason
 * about a timezone that was never part of the value.
 */
function dayOnly(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/** A wall-clock "HH:MM" argument, validated (reminder times on rules). */
function timeStr(args: Record<string, unknown>, key: string): string | undefined {
  const v = str(args, key);
  if (v === undefined) return undefined;
  if (!TIME_RE.test(v)) {
    throw new Error(`${key} must be 24-hour HH:MM, got: ${v}`);
  }
  return v;
}

/**
 * Minutes from local midnight — the position convention timeline blocks and
 * quick-add events share. 0 is a legal value, so this can't lean on `num`'s
 * undefined-means-absent alone at the call site; callers check for undefined.
 */
function minuteOfDay(
  args: Record<string, unknown>,
  key: string,
): number | undefined {
  const v = num(args, key);
  if (v === undefined) return undefined;
  const n = Math.trunc(v);
  if (n < 0 || n > 1440) {
    throw new Error(`${key} must be minutes from midnight, 0–1440, got: ${v}`);
  }
  return n;
}

/**
 * A recurrence schedule assembled from `freq` plus whichever companion field
 * that frequency needs. The app's own inputs also accept a typed phrase
 * ("review inbox every friday 4pm") through `parseRecurrenceInput`, but that
 * parser returns a flat null when it doesn't recognize the phrasing — the
 * caller can't tell whether the title or the schedule was the problem, and a
 * silently unparsed "every 2nd Tuesday" becomes no rule at all. The explicit
 * spec is the contract exposed here: every failure below names the field.
 */
function recurrenceSpec(args: Record<string, unknown>): RecurrenceSpec {
  const freq = str(args, "freq");
  if (
    freq !== "daily" &&
    freq !== "weekly" &&
    freq !== "interval" &&
    freq !== "monthly"
  ) {
    throw new Error("freq must be one of: daily, weekly, interval, monthly");
  }
  const spec: RecurrenceSpec = {
    freq,
    weekday: null,
    intervalDays: null,
    monthDay: null,
    remindAt: timeStr(args, "remindAt") ?? null,
  };
  if (freq === "weekly") {
    const weekday = num(args, "weekday");
    if (weekday === undefined || weekday < 0 || weekday > 6) {
      throw new Error(
        "freq 'weekly' needs weekday: 0 (Sunday) through 6 (Saturday)",
      );
    }
    spec.weekday = Math.trunc(weekday);
  }
  if (freq === "interval") {
    const days = num(args, "intervalDays");
    if (days === undefined || days < 1) {
      throw new Error("freq 'interval' needs intervalDays, 1 or more");
    }
    spec.intervalDays = Math.trunc(days);
  }
  if (freq === "monthly") {
    const day = num(args, "monthDay");
    if (day === undefined || day < 1 || day > 31) {
      throw new Error("freq 'monthly' needs monthDay, 1 through 31");
    }
    spec.monthDay = Math.trunc(day);
  }
  return spec;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const OBJ = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const S = (description: string) => ({ type: "string", description });
const N = (description: string) => ({ type: "number", description });
const B = (description: string) => ({ type: "boolean", description });

/** Shared by recurring_create and recurring_update — one schedule vocabulary. */
const RECURRENCE_PROPS = {
  freq: {
    type: "string",
    enum: ["daily", "weekly", "interval", "monthly"],
    description:
      "How often it repeats. 'weekly' also needs weekday, 'interval' needs intervalDays, 'monthly' needs monthDay.",
  },
  weekday: N("0 (Sunday) through 6 (Saturday). Required when freq is 'weekly'."),
  intervalDays: N("Repeat every N days. Required when freq is 'interval'."),
  monthDay: N(
    "Day of the month, 1–31, clamped to shorter months. Required when freq is 'monthly'.",
  ),
  remindAt: S("Optional reminder time as 24-hour HH:MM, e.g. '16:00'."),
};

export const MCP_TOOLS: McpTool[] = [
  // ---- Notes -------------------------------------------------------------
  {
    name: "notes_search",
    description:
      "Search notes by title and return matches, most recently updated first. Use this to find a note's id before reading or editing it. Does not search note bodies — use notes_list_recent to browse instead.",
    inputSchema: OBJ(
      { query: S("Text to match against note titles."), limit: N("Max results (default 12, max 50).") },
      ["query"],
    ),
    handler: async (ownerId, args) => {
      const rows = await notesRepo.searchNotes(
        ownerId,
        requireStr(args, "query"),
        clampLimit(num(args, "limit"), 12, 50),
      );
      return rows.map((n) => ({
        id: n.id,
        title: n.title,
        dailyDate: dayOnly(n.dailyDate),
        folderId: n.bubbleId,
        updatedAt: iso(n.updatedAt),
      }));
    },
  },
  {
    name: "notes_get",
    description:
      "Read a note's full content as markdown, by id. Formatting beyond headings, lists, quotes and plain paragraphs is flattened — see notes_append if you only need to add to it.",
    inputSchema: OBJ({ id: S("The note's id.") }, ["id"]),
    handler: async (ownerId, args) => {
      const note = await notesRepo.getNote(ownerId, requireStr(args, "id"));
      if (!note || note.deletedAt) throw new Error("Note not found");
      return {
        id: note.id,
        title: note.title,
        markdown: docToMarkdown(note.content as SerializedEditorState | null),
        dailyDate: dayOnly(note.dailyDate),
        folderId: note.bubbleId,
        updatedAt: iso(note.updatedAt),
      };
    },
  },
  {
    name: "notes_create",
    description:
      "Create a new note with a title and optional markdown body. Returns the new note's id. To add to an existing note, use notes_append instead.",
    inputSchema: OBJ(
      {
        title: S("The note's title."),
        markdown: S("Optional body, as markdown."),
        folderId: S("Optional folder (bubble) id to file it under."),
      },
      ["title"],
    ),
    handler: async (ownerId, args) => {
      const markdown = str(args, "markdown");
      const note = await notesRepo.createNote({
        ownerId,
        title: requireStr(args, "title").slice(0, 300),
        content: markdown ? markdownToDoc(markdown) : undefined,
        bubbleId: str(args, "folderId") ?? null,
      });
      return { id: note.id, title: note.title };
    },
  },
  {
    name: "notes_append",
    description:
      "Append markdown to the end of an existing note, leaving what's already there untouched. This is the safe way to add to a note — notes_replace overwrites the whole body.",
    inputSchema: OBJ(
      { id: S("The note's id."), markdown: S("Markdown to append.") },
      ["id", "markdown"],
    ),
    handler: async (ownerId, args) => {
      const id = requireStr(args, "id");
      const note = await notesRepo.getNote(ownerId, id);
      if (!note || note.deletedAt) throw new Error("Note not found");
      const content = (note.content ?? markdownToDoc("")) as SerializedEditorState;
      const root = content.root as unknown as { children: unknown[] };
      if (!Array.isArray(root.children)) root.children = [];
      root.children.push(...markdownToBlocks(requireStr(args, "markdown")));
      await notesRepo.updateNoteContent(ownerId, id, { content });
      return { id, appended: true };
    },
  },
  {
    name: "notes_replace",
    description:
      "Replace a note's entire body with new markdown, and optionally its title. Destructive — the previous body is not recoverable. Prefer notes_append unless you are deliberately rewriting the note.",
    inputSchema: OBJ(
      {
        id: S("The note's id."),
        markdown: S("The new body, as markdown."),
        title: S("Optional new title."),
      },
      ["id", "markdown"],
    ),
    handler: async (ownerId, args) => {
      const id = requireStr(args, "id");
      const title = str(args, "title");
      const updated = await notesRepo.updateNoteContent(ownerId, id, {
        content: markdownToDoc(requireStr(args, "markdown")),
        ...(title ? { title: title.slice(0, 300) } : {}),
      });
      if (!updated) throw new Error("Note not found");
      return { id, replaced: true };
    },
  },
  {
    name: "notes_list_recent",
    description:
      "List the most recently updated notes with a short preview of each. Use this to see what the user has been working on.",
    inputSchema: OBJ({ limit: N("Max results (default 20, max 60).") }),
    handler: async (ownerId, args) => {
      const rows = await notesRepo.listNotesWithPreview(
        ownerId,
        clampLimit(num(args, "limit"), 20, 60),
      );
      return rows.map((n) => ({
        id: n.id,
        title: n.title,
        preview: n.preview,
        updatedAt: iso(n.updatedAt),
      }));
    },
  },
  {
    name: "notes_trash",
    description:
      "Move a note to the trash. Reversible from the app's Trash view; nothing is permanently deleted.",
    inputSchema: OBJ({ id: S("The note's id.") }, ["id"]),
    handler: async (ownerId, args) => {
      const note = await notesRepo.trashNote(ownerId, requireStr(args, "id"));
      if (!note) throw new Error("Note not found");
      return { id: note.id, trashed: true };
    },
  },
  {
    name: "notes_backlinks",
    description: "List the notes that link to a given note.",
    inputSchema: OBJ({ id: S("The note's id.") }, ["id"]),
    handler: async (ownerId, args) =>
      notesRepo.listBacklinks(ownerId, requireStr(args, "id")),
  },
  {
    name: "notes_update",
    description:
      "Rename a note, or move it into a folder. Only the fields you pass change. Pass folderId to file it under a folder from folders_list, or an empty string to pull it back out to the top level. This does not touch the note's body — use notes_append or notes_replace for that.",
    inputSchema: OBJ(
      {
        id: S("The note's id."),
        title: S("New title. Omit to leave it unchanged."),
        folderId: S(
          "Move the note into this folder. Empty string moves it out to the top level. Omit to leave it where it is.",
        ),
      },
      ["id"],
    ),
    handler: async (ownerId, args) => {
      const id = requireStr(args, "id");
      const title = str(args, "title");
      // "" is a real instruction here (un-file the note), so the raw arg is
      // what distinguishes "move to top level" from "don't move it".
      const rawFolder = args.folderId;
      const movesFolder = typeof rawFolder === "string";

      let note = title === undefined
        ? await notesRepo.getNote(ownerId, id)
        : await notesRepo.updateNoteContent(ownerId, id, { title });
      if (!note) throw new Error("Note not found");

      if (movesFolder) {
        // Throws "Bubble not found" on a bad id rather than silently leaving
        // the note where it was.
        note =
          (await notesRepo.moveNoteToBubble(
            ownerId,
            id,
            rawFolder === "" ? null : rawFolder,
          )) ?? note;
      }
      return { id: note.id, title: note.title, folderId: note.bubbleId };
    },
  },

  // ---- Daily jots --------------------------------------------------------
  {
    name: "daily_get",
    description:
      "Read the daily jot for a date (defaults to today), creating it if it doesn't exist yet. Daily jots are the user's running log for a day.",
    inputSchema: OBJ({ date: S("YYYY-MM-DD. Defaults to today.") }),
    handler: async (ownerId, args) => {
      const day = dateStr(args, "date") ?? localDateString();
      const note = await notesRepo.getOrCreateDailyNote(ownerId, day);
      return {
        id: note.id,
        date: day,
        title: note.title,
        markdown: docToMarkdown(note.content as SerializedEditorState | null),
      };
    },
  },
  {
    name: "daily_append",
    description:
      "Append markdown to a day's daily jot (defaults to today), creating the jot if needed. The natural way to log something without disturbing what's already written.",
    inputSchema: OBJ(
      { markdown: S("Markdown to append."), date: S("YYYY-MM-DD. Defaults to today.") },
      ["markdown"],
    ),
    handler: async (ownerId, args) => {
      const day = dateStr(args, "date") ?? localDateString();
      const note = await notesRepo.getOrCreateDailyNote(ownerId, day);
      const content = (note.content ?? markdownToDoc("")) as SerializedEditorState;
      const root = content.root as unknown as { children: unknown[] };
      if (!Array.isArray(root.children)) root.children = [];
      root.children.push(...markdownToBlocks(requireStr(args, "markdown")));
      await notesRepo.updateNoteContent(ownerId, note.id, { content });
      return { id: note.id, date: day, appended: true };
    },
  },

  // ---- Tasks -------------------------------------------------------------
  {
    name: "tasks_list",
    description:
      "List the user's open tasks. `scope` picks which: 'due' (due today or overdue), 'upcoming' (due later), 'unscheduled' (captured with no date), or 'recent' (newest first, regardless of date). Pass `noteId` instead to read the tasks on one specific note — that's the list a note's checkboxes represent, in the order they appear in it.",
    inputSchema: OBJ({
      scope: {
        type: "string",
        enum: ["due", "upcoming", "unscheduled", "recent"],
        description: "Which set of open tasks to return. Defaults to 'due'.",
      },
      noteId: S(
        "Return the tasks on this note instead of a date-based scope. Overrides `scope`.",
      ),
      includeCompleted: B(
        "With `noteId`, also return already-completed tasks. Defaults to false.",
      ),
      date: S("YYYY-MM-DD reference day for 'due' and 'upcoming'. Defaults to today."),
      limit: N("Max results for 'recent' (default 25, max 100)."),
    }),
    handler: async (ownerId, args) => {
      // A note's task list is a different question from "what's due", so it
      // short-circuits the scopes rather than becoming another one: the
      // ordering is the note's own, and completed rows are legitimately part
      // of it (a shopping list you've ticked off is still the list).
      const noteId = str(args, "noteId");
      if (noteId) {
        const rows = await tasksRepo.listTasksForNote(
          ownerId,
          noteId,
          bool(args, "includeCompleted") ?? false,
        );
        return rows.map((t) => ({
          id: t.id,
          title: t.title,
          due: t.dueAt ? t.dueAt.toISOString().slice(0, 10) : null,
          completed: t.completedAt !== null,
        }));
      }
      const scope = str(args, "scope") ?? "due";
      const day = dateStr(args, "date") ?? localDateString();
      const shape = (t: {
        id: string;
        title: string;
        dueAt?: Date | null;
        remindAt?: string | null;
      }) => ({
        id: t.id,
        title: t.title,
        due: t.dueAt ? t.dueAt.toISOString().slice(0, 10) : null,
        remindAt: t.remindAt ?? null,
      });
      if (scope === "upcoming") {
        return (await tasksRepo.listTasksUpcoming(ownerId, day)).map(shape);
      }
      if (scope === "unscheduled") {
        return (await tasksRepo.listTasksUnscheduled(ownerId)).map((t) => ({
          id: t.id,
          title: t.title,
          due: null,
          noteId: t.noteId,
        }));
      }
      if (scope === "recent") {
        const rows = await tasksRepo.listTasksRecentlyAdded(
          ownerId,
          clampLimit(num(args, "limit"), 25, 100),
        );
        return rows.map((t) => ({
          id: t.id,
          title: t.title,
          due: t.dueAt ? t.dueAt.toISOString().slice(0, 10) : null,
          createdAt: iso(t.createdAt),
          noteId: t.noteId,
        }));
      }
      return (await tasksRepo.listTasksDue(ownerId, day)).map(shape);
    },
  },
  {
    name: "tasks_create",
    description:
      "Create a task. `#tags` typed into the title are parsed out and applied, the same as in the app's quick-add — so 'call the dentist #health' files itself under #health. Pass `noteId` to put the task ON a note: it appears as a checkbox in that note's body, which is how a note like a shopping list holds its items. Without `noteId` the task is standalone and lives only on the task lists.",
    inputSchema: OBJ(
      {
        title: S("The task's title. May contain #tags."),
        due: S("YYYY-MM-DD due date. Omit for an unscheduled task."),
        noteId: S(
          "Put the task on this note, as a checkbox appended to its content.",
        ),
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Extra tag names to apply, in addition to any #tags in the title.",
        },
      },
      ["title"],
    ),
    handler: async (ownerId, args) => {
      const raw = requireStr(args, "title");
      const parsed = parseHashtags(raw);
      const due = dateStr(args, "due");
      const noteId = str(args, "noteId");
      const task = await tasksRepo.createStandaloneTask(
        ownerId,
        parsed.title || raw,
        due ? dueDate(due) : null,
      );
      if (noteId) await attachTaskToNote(ownerId, noteId, task.id, task.title);
      const names = [...parsed.tags, ...strList(args, "tags")];
      let tags: { id: string; name: string }[] = [];
      if (names.length > 0) {
        // Tagging must not lose a task that was already created.
        try {
          const resolved = await tagsRepo.resolveTagsByName(ownerId, names);
          tags = await tagsRepo.addTaskTags(
            ownerId,
            task.id,
            resolved.map((t) => t.id),
          );
        } catch (err) {
          console.error("[mcp] tagging on create failed:", err);
        }
      }
      return {
        id: task.id,
        title: task.title,
        due: due ?? null,
        noteId: noteId ?? null,
        tags,
      };
    },
  },
  {
    name: "tasks_set_note",
    description:
      "Put an existing task on a note, or take it off one. A task can sit on several notes at once and shares one completion state across all of them, so this attaches to (or detaches from) the one note you name rather than moving the task — pass attached=false to remove it from that note. Detaching does not delete the task; it becomes a standalone task again.",
    inputSchema: OBJ(
      {
        id: S("The task's id."),
        noteId: S("The note to attach it to, or detach it from."),
        attached: B("False detaches. Defaults to true."),
      },
      ["id", "noteId"],
    ),
    handler: async (ownerId, args) => {
      const taskId = requireStr(args, "id");
      const noteId = requireStr(args, "noteId");
      if (bool(args, "attached") === false) {
        const removedNode = await notesRepo.removeTaskNodeFromNote(
          ownerId,
          noteId,
          taskId,
        );
        const unlinked = await tasksRepo.unlinkTaskFromNote(
          ownerId,
          noteId,
          taskId,
        );
        if (!unlinked && !removedNode) {
          throw new Error("That task is not on that note");
        }
        return { id: taskId, noteId, attached: false };
      }
      const task = await tasksRepo.getTask(ownerId, taskId);
      if (!task) throw new Error("Task not found");
      await attachTaskToNote(ownerId, noteId, task.id, task.title);
      return { id: task.id, noteId, attached: true };
    },
  },
  {
    name: "tasks_complete",
    description: "Mark a task complete, or reopen it with completed=false.",
    inputSchema: OBJ(
      { id: S("The task's id."), completed: B("Defaults to true.") },
      ["id"],
    ),
    handler: async (ownerId, args) => {
      const task = await tasksRepo.toggleTask(
        ownerId,
        requireStr(args, "id"),
        bool(args, "completed") ?? true,
      );
      if (!task) throw new Error("Task not found");
      return { id: task.id, completed: task.completedAt !== null };
    },
  },
  {
    name: "tasks_set_due",
    description:
      "Set or clear a task's due date. Pass due as YYYY-MM-DD, or omit it to unschedule the task.",
    inputSchema: OBJ(
      { id: S("The task's id."), due: S("YYYY-MM-DD, or omit to clear.") },
      ["id"],
    ),
    handler: async (ownerId, args) => {
      const due = dateStr(args, "due");
      const task = await tasksRepo.setTaskDue(
        ownerId,
        requireStr(args, "id"),
        due ? dueDate(due) : null,
      );
      if (!task) throw new Error("Task not found");
      return { id: task.id, due: due ?? null };
    },
  },
  {
    name: "tasks_set_tags",
    description:
      "Replace a task's tags with the given names, creating any that don't exist. Pass an empty list to remove all of them.",
    inputSchema: OBJ(
      {
        id: S("The task's id."),
        tags: { type: "array", items: { type: "string" }, description: "Tag names." },
      },
      ["id", "tags"],
    ),
    handler: async (ownerId, args) => {
      const resolved = await tagsRepo.resolveTagsByName(
        ownerId,
        strList(args, "tags"),
      );
      return tagsRepo.setTaskTags(
        ownerId,
        requireStr(args, "id"),
        resolved.map((t) => t.id),
      );
    },
  },
  {
    name: "tasks_update",
    description:
      "Rename a task or change its description. Only the fields you pass are touched, so sending just a description leaves the title alone.",
    inputSchema: OBJ(
      {
        id: S("The task's id."),
        title: S("New title. Omit to leave it unchanged."),
        description: S(
          "New description — longer detail the title doesn't carry. Pass an empty string to clear it.",
        ),
      },
      ["id"],
    ),
    handler: async (ownerId, args) => {
      // `description: ""` is a clear, not an absence, so this reads the raw
      // arg rather than `str()` (which treats empty as missing).
      const rawDescription = args.description;
      const task = await tasksRepo.updateTask(ownerId, requireStr(args, "id"), {
        title: str(args, "title"),
        description:
          typeof rawDescription === "string" ? rawDescription : undefined,
      });
      if (!task) throw new Error("Task not found");
      return {
        id: task.id,
        title: task.title,
        description: task.description ?? null,
      };
    },
  },
  {
    name: "tasks_delete",
    description:
      "Delete a task permanently, removing it from every note it appears on. There is no task trash and this cannot be undone — prefer tasks_complete for something the user has simply finished, and use this only when they want the task gone (a mistake, a duplicate).",
    inputSchema: OBJ({ id: S("The task's id.") }, ["id"]),
    handler: async (ownerId, args) => {
      const taskId = requireStr(args, "id");
      // Content nodes are not cascaded by the FK — the checkbox would stay in
      // the note body pointing at a task that no longer exists. Clear those
      // first, while the links that name the notes still exist.
      const noteIds = await tasksRepo.listNoteIdsForTask(ownerId, taskId);
      for (const noteId of noteIds) {
        try {
          await notesRepo.removeTaskNodeFromNote(ownerId, noteId, taskId);
        } catch (err) {
          console.error("[mcp] failed to strip task node from note:", err);
        }
      }
      const row = await tasksRepo.deleteTask(ownerId, taskId);
      if (!row) throw new Error("Task not found");
      return { id: row.id, deleted: true, removedFromNotes: noteIds.length };
    },
  },

  // ---- Tags, folders, logs ----------------------------------------------
  {
    name: "tags_list",
    description:
      "List every tag, with how many open tasks carry each. Use this before tagging to reuse an existing tag rather than creating a near-duplicate.",
    inputSchema: OBJ({}),
    handler: async (ownerId) => tagsRepo.listTags(ownerId),
  },
  {
    name: "tags_create",
    description:
      "Create a tag, optionally with a colour. Tagging a task with tasks_set_tags already creates any tag it needs, so reach for this only when the user wants the tag to exist on its own — usually to give it a colour. Naming one that already exists returns it rather than failing.",
    inputSchema: OBJ(
      {
        name: S("The tag's name, without the leading '#'."),
        color: S("A CSS colour, e.g. '#8bb4a0'. Omit to leave it unset."),
      },
      ["name"],
    ),
    handler: async (ownerId, args) =>
      tagsRepo.createTag(ownerId, requireStr(args, "name"), str(args, "color")),
  },
  {
    name: "folders_create",
    description:
      "Create a folder that notes can be filed under. Pass parentId to nest it inside an existing folder (from folders_list); omit it for a top-level folder.",
    inputSchema: OBJ(
      {
        title: S("The folder's name."),
        parentId: S("Nest inside this folder. Omit for a top-level folder."),
      },
      ["title"],
    ),
    handler: async (ownerId, args) => {
      const folder = await bubblesRepo.createFolder(
        ownerId,
        requireStr(args, "title"),
        str(args, "parentId") ?? null,
      );
      return { id: folder.id, title: folder.title, parentId: folder.parentId };
    },
  },
  {
    name: "folders_list",
    description:
      "List the folders (bubbles) notes can be filed under, with their ids and parents.",
    inputSchema: OBJ({}),
    handler: async (ownerId) => {
      const rows = await bubblesRepo.listFolderTreeBubbles(ownerId);
      return rows.map((b) => ({
        id: b.id,
        title: b.title,
        parentId: b.parentId,
        color: b.color,
      }));
    },
  },
  {
    name: "notes_logs",
    description:
      "List the call logs written onto a note from other notes — each with its text, when it was written, and which note it came from.",
    inputSchema: OBJ({ id: S("The note's id.") }, ["id"]),
    handler: async (ownerId, args) => {
      const rows = await noteLogsRepo.listLogsForNote(
        ownerId,
        requireStr(args, "id"),
      );
      return rows.map((r) => ({
        id: r.id,
        heading: r.heading,
        markdown: blocksToMarkdown(r.content),
        createdAt: iso(r.createdAt),
        sourceNoteId: r.sourceNoteId,
        sourceTitle: r.sourceTitle,
      }));
    },
  },

  // ---- People ------------------------------------------------------------
  // Contacts are hand-added and their timelines come from whole-word name
  // matching over the user's own notes — no model anywhere in this section.
  {
    name: "people_list",
    description:
      "List the contacts the user keeps a page for, most recently mentioned first, with how many notes mention each. Use this to find a person's id before reading their page. This is the user's own hand-curated contact list, not everyone who happens to appear in a note.",
    inputSchema: OBJ({}),
    handler: async (ownerId) => {
      const rows = await peopleRepo.listPeople(ownerId);
      return rows.map((p) => ({
        id: p.id,
        name: p.name,
        mentionCount: p.mentionCount,
        lastMentionedAt: iso(p.lastMentionedAt),
      }));
    },
  },
  {
    name: "people_get",
    description:
      "Read one contact's page: every note that mentions them (newest first, each with a snippet) plus their open and resolved commitments, split into what the user owes them and what they owe the user. Use this before answering 'where do things stand with X'. Mentions are name matches over live notes, so a note in the trash never appears.",
    inputSchema: OBJ(
      {
        id: S("The person's id, from people_list."),
        mentionLimit: N("Max mentions to return (default 25, max 100)."),
      },
      ["id"],
    ),
    handler: async (ownerId, args) => {
      const person = await peopleRepo.getPerson(ownerId, requireStr(args, "id"));
      if (!person) throw new Error("Person not found");
      const shapeCommitment = (c: {
        id: string;
        text: string;
        contextLabel: string | null;
        taskId: string | null;
        sourceNoteId: string | null;
        resolvedAt: Date | null;
        createdAt: Date;
      }) => ({
        id: c.id,
        text: c.text,
        resolved: c.resolvedAt !== null,
        resolvedAt: iso(c.resolvedAt),
        context: c.contextLabel,
        taskId: c.taskId,
        noteId: c.sourceNoteId,
        createdAt: iso(c.createdAt),
      });
      return {
        id: person.id,
        name: person.name,
        lastMentionedAt: iso(person.lastMentionedAt),
        mentions: person.mentions
          .slice(0, clampLimit(num(args, "mentionLimit"), 25, 100))
          .map((m) => ({
            noteId: m.noteId,
            noteTitle: m.noteTitle,
            noteDate: dayOnly(m.noteDailyDate),
            snippet: m.snippet,
            mentionedAt: iso(m.mentionDate),
          })),
        youOwe: person.youOwe.map(shapeCommitment),
        theyOwe: person.theyOwe.map(shapeCommitment),
      };
    },
  },
  {
    name: "people_create",
    description:
      "Add a contact by name and immediately build their mention timeline by scanning the user's notes for the name. Safe to call for a name that already exists — it returns the existing person rather than creating a duplicate. Adding someone is how the user opts into tracking them; don't add people speculatively just because a note mentions them.",
    inputSchema: OBJ({ name: S("The person's name, e.g. 'Sam Rivera'.") }, ["name"]),
    handler: async (ownerId, args) => {
      const person = await peopleRepo.createPerson(
        ownerId,
        requireStr(args, "name"),
      );
      if (!person) throw new Error("Name is empty after trimming");
      await peopleRepo.rebuildMentionsForPersonId(ownerId, person.id);
      return { id: person.id, name: person.name };
    },
  },
  {
    name: "people_update",
    description:
      "Rename a contact — correcting a spelling, or moving from 'Sam' to 'Sam Rivera'. Their mention timeline is rebuilt against the new name afterwards, so mentions follow the rename. Name is the only field a contact has; commitments are edited with the people_*_commitment tools.",
    inputSchema: OBJ(
      { id: S("The person's id."), name: S("The corrected name.") },
      ["id", "name"],
    ),
    handler: async (ownerId, args) => {
      const person = await peopleRepo.renamePerson(
        ownerId,
        requireStr(args, "id"),
        requireStr(args, "name"),
      );
      if (!person) throw new Error("Person not found, or the name is empty");
      return { id: person.id, name: person.name };
    },
  },
  {
    name: "people_delete",
    description:
      "Permanently delete a contact, along with their whole mention timeline and every commitment recorded against them. This is a hard delete — there is no trash for people and nothing here can be restored. The notes that mentioned them are untouched. Ask the user before calling this.",
    inputSchema: OBJ({ id: S("The person's id.") }, ["id"]),
    handler: async (ownerId, args) => {
      const id = requireStr(args, "id");
      await peopleRepo.deletePerson(ownerId, id);
      return { id, deleted: true };
    },
  },
  {
    name: "people_add_commitment",
    description:
      "Record something owed between the user and a contact. `direction` is 'you_owe' for something the user promised them, 'they_owe' for something they promised the user. Identical text in the same direction is deduped, so re-recording a commitment is safe. Use tasks_create instead when the user wants it in their task list rather than on a person's page.",
    inputSchema: OBJ(
      {
        personId: S("The person's id, from people_list."),
        direction: {
          type: "string",
          enum: ["you_owe", "they_owe"],
          description: "Who owes whom.",
        },
        text: S("What is owed, e.g. 'send the Q3 deck'."),
      },
      ["personId", "direction", "text"],
    ),
    handler: async (ownerId, args) => {
      const direction = requireStr(args, "direction");
      if (direction !== "you_owe" && direction !== "they_owe") {
        throw new Error("direction must be 'you_owe' or 'they_owe'");
      }
      const row = await peopleRepo.addCommitment(
        ownerId,
        requireStr(args, "personId"),
        direction,
        requireStr(args, "text"),
      );
      if (!row) throw new Error("Person not found, or the text was empty");
      return { id: row.id, text: row.text, direction: row.direction };
    },
  },
  {
    name: "people_resolve_commitment",
    description:
      "Mark a commitment settled, or reopen it with resolved=false. This is the right tool when something owed got done — people_delete_commitment throws it away instead, losing the record that it ever existed.",
    inputSchema: OBJ(
      {
        id: S("The commitment's id, from people_get."),
        resolved: B("Defaults to true."),
      },
      ["id"],
    ),
    handler: async (ownerId, args) => {
      const row = await peopleRepo.setCommitmentResolved(
        ownerId,
        requireStr(args, "id"),
        bool(args, "resolved") ?? true,
      );
      if (!row) throw new Error("Commitment not found");
      return { id: row.id, resolved: row.resolvedAt !== null };
    },
  },
  {
    name: "people_delete_commitment",
    description:
      "Permanently delete a commitment row. Not recoverable — there is no trash for commitments. Use this only for something recorded by mistake; if the commitment was actually fulfilled, use people_resolve_commitment so the history survives.",
    inputSchema: OBJ({ id: S("The commitment's id.") }, ["id"]),
    handler: async (ownerId, args) => {
      const id = requireStr(args, "id");
      await peopleRepo.deleteCommitment(ownerId, id);
      return { id, deleted: true };
    },
  },

  // ---- Threads -----------------------------------------------------------
  {
    name: "threads_list",
    description:
      "List the topic threads assembled from recurring subjects across the user's notes, most recently active first, with how many notes mention each and the span they cover. Use this to see what themes are running through someone's notes over time. Dismissed threads are excluded — threads_list_dismissed shows those.",
    inputSchema: OBJ({}),
    handler: async (ownerId) => {
      const rows = await threadsRepo.listThreads(ownerId);
      return rows.map((t) => ({
        id: t.id,
        topic: t.topic,
        status: t.status,
        mentionCount: t.mentionCount,
        firstMentionAt: iso(t.firstMentionAt),
        lastMentionAt: iso(t.lastMentionAt),
        promotedNoteId: t.promotedNoteId,
      }));
    },
  },
  {
    name: "threads_get",
    description:
      "Read one thread's full timeline: every mention in chronological order with its snippet and source note, oldest first, so the topic reads as a story. Use this after threads_list when the user asks how a topic developed.",
    inputSchema: OBJ({ id: S("The thread's id, from threads_list.") }, ["id"]),
    handler: async (ownerId, args) => {
      const thread = await threadsRepo.getThread(ownerId, requireStr(args, "id"));
      if (!thread) throw new Error("Thread not found");
      return {
        id: thread.id,
        topic: thread.topic,
        status: thread.status,
        promotedNoteId: thread.promotedNoteId,
        mentions: thread.mentions.map((m) => ({
          noteId: m.noteId,
          noteTitle: m.noteTitle,
          noteDate: dayOnly(m.noteDailyDate),
          snippet: m.snippet,
          mentionedAt: iso(m.mentionDate),
          quiet: m.quiet,
        })),
      };
    },
  },
  {
    name: "threads_set_status",
    description:
      "Change a thread's status: 'active' keeps it on the Threads page, 'promoted' marks that it graduated into a real note (pass promotedNoteId to record which), 'dismissed' hides it from the list. Dismissing is reversible with threads_reopen — nothing is deleted.",
    inputSchema: OBJ(
      {
        id: S("The thread's id."),
        status: {
          type: "string",
          enum: ["active", "promoted", "dismissed"],
          description: "The new status.",
        },
        promotedNoteId: S(
          "The note the thread became. Only meaningful with status 'promoted'.",
        ),
      },
      ["id", "status"],
    ),
    handler: async (ownerId, args) => {
      const status = requireStr(args, "status");
      if (status !== "active" && status !== "promoted" && status !== "dismissed") {
        throw new Error("status must be 'active', 'promoted', or 'dismissed'");
      }
      const promotedNoteId = str(args, "promotedNoteId");
      const thread = await threadsRepo.setThreadStatus(
        ownerId,
        requireStr(args, "id"),
        status,
        promotedNoteId,
      );
      if (!thread) throw new Error("Thread not found");
      return {
        id: thread.id,
        status: thread.status,
        promotedNoteId: thread.promotedNoteId,
      };
    },
  },
  {
    name: "threads_list_dismissed",
    description:
      "List threads the user dismissed, most recently dismissed first. Use this when someone asks what they hid, or to find the id of a thread to bring back with threads_reopen.",
    inputSchema: OBJ({ limit: N("Max results (default 20, max 50).") }),
    handler: async (ownerId, args) => {
      const rows = await threadsRepo.listDismissedThreads(
        ownerId,
        clampLimit(num(args, "limit"), 20, 50),
      );
      return rows.map((t) => ({
        id: t.id,
        topic: t.topic,
        dismissedAt: iso(t.updatedAt),
      }));
    },
  },
  {
    name: "threads_reopen",
    description:
      "Undo a dismissal — a dismissed thread goes back to active and reappears in threads_list. Only affects threads that are currently dismissed; anything else errors rather than silently changing status. Use threads_set_status for every other transition.",
    inputSchema: OBJ({ id: S("The thread's id, from threads_list_dismissed.") }, [
      "id",
    ]),
    handler: async (ownerId, args) => {
      const thread = await threadsRepo.reopenThread(
        ownerId,
        requireStr(args, "id"),
      );
      if (!thread) throw new Error("Thread not found, or it was not dismissed");
      return { id: thread.id, topic: thread.topic, status: thread.status };
    },
  },

  // ---- Habits ------------------------------------------------------------
  {
    name: "habits_list",
    description:
      "List the user's habits for a day (defaults to today) with whether each is already logged, whether the day is even a scheduled one, the current run of completed days, and a chain of the last several scheduled days. Habits are recurrence rules flagged as habits; they never go overdue and a missed day just breaks the chain, so don't report them as late tasks. Paused rules are omitted.",
    inputSchema: OBJ({ date: S("YYYY-MM-DD. Defaults to today.") }),
    handler: async (ownerId, args) => {
      const day = dateStr(args, "date") ?? localDateString();
      const rows = await habitsRepo.listHabitsForDay(ownerId, day);
      return rows.map((h) => ({
        id: h.id,
        title: h.title,
        date: day,
        scheduledToday: h.scheduledToday,
        completed: h.todayCompleted,
        loggedAt: h.loggedAtIso,
        runDays: h.runDays,
        chain: h.dots.map((d) => ({ date: d.date, state: d.state })),
      }));
    },
  },
  {
    name: "habits_log",
    description:
      "Log a habit for a day (defaults to today), or un-log it by calling again — this toggles. Works even on a day the habit wasn't scheduled, which is how an off-schedule log gets recorded. Pass the habit's rule id from habits_list, not a task id; use tasks_complete for ordinary tasks.",
    inputSchema: OBJ(
      {
        id: S("The habit's rule id, from habits_list."),
        date: S("YYYY-MM-DD. Defaults to today."),
      },
      ["id"],
    ),
    handler: async (ownerId, args) => {
      const day = dateStr(args, "date") ?? localDateString();
      const result = await habitsRepo.logHabitToday(
        ownerId,
        requireStr(args, "id"),
        day,
      );
      if (!result) throw new Error("Habit not found");
      return { id: requireStr(args, "id"), date: day, completed: result.completed };
    },
  },
  {
    name: "habits_create",
    description:
      "Create a habit — a recurrence rule that lives on the habit strip instead of the task lists. Takes the same explicit schedule as recurring_create (freq plus whatever that frequency needs). Use this rather than recurring_create + habits_set_flag when the user is describing something they want to keep up ('meditate every morning') as opposed to a chore that should appear as a due task. Habits never go overdue and a missed day only breaks the chain.",
    inputSchema: OBJ(
      {
        title: S("The habit, e.g. 'meditate'."),
        ...RECURRENCE_PROPS,
        anchorDate: S(
          "YYYY-MM-DD the schedule counts from. Defaults to today.",
        ),
      },
      ["title", "freq"],
    ),
    handler: async (ownerId, args) => {
      const rule = await habitsRepo.createHabit(
        ownerId,
        requireStr(args, "title"),
        recurrenceSpec(args),
        dateStr(args, "anchorDate") ?? localDateString(),
      );
      return {
        id: rule.id,
        title: rule.title,
        schedule: describeSchedule(recurringRepo.specOf(rule)),
        anchorDate: dayOnly(rule.anchorDate),
        isHabit: rule.isHabit,
      };
    },
  },
  {
    name: "habits_set_flag",
    description:
      "Turn an existing recurrence rule into a habit, or turn it back into a plain recurring task with isHabit=false. A rule is one or the other, never both: flagging it moves it off the task surfaces and onto the habit strip, so its occurrences stop appearing in tasks_list. Create the rule with recurring_create first.",
    inputSchema: OBJ(
      {
        id: S("The recurrence rule's id, from recurring_list."),
        isHabit: B("Defaults to true."),
      },
      ["id"],
    ),
    handler: async (ownerId, args) => {
      const id = requireStr(args, "id");
      const isHabit = bool(args, "isHabit") ?? true;
      await habitsRepo.setRecurringHabit(ownerId, id, isHabit);
      return { id, isHabit };
    },
  },

  // ---- Recurring rules ---------------------------------------------------
  // The schedule is taken as an explicit spec rather than a phrase — see the
  // `recurrenceSpec` helper for why.
  {
    name: "recurring_list",
    description:
      "List the user's recurring task rules, with each one's schedule in plain words, whether it's paused, and the day its schedule counts from. Habits are deliberately excluded — use habits_list for those. These are the rules; the individual occurrences they generate show up as ordinary tasks in tasks_list.",
    inputSchema: OBJ({}),
    handler: async (ownerId) => {
      const rows = await recurringRepo.listRecurringTasks(ownerId);
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        schedule: describeSchedule(recurringRepo.specOf(r)),
        freq: r.freq,
        weekday: r.weekday,
        intervalDays: r.intervalDays,
        monthDay: r.monthDay,
        remindAt: r.remindAt,
        paused: r.paused,
        anchorDate: dayOnly(r.anchorDate),
        lastOccurrence: dayOnly(r.lastDate),
      }));
    },
  },
  {
    name: "recurring_create",
    description:
      "Create a recurring task rule from an explicit schedule: a title plus `freq` and whatever that frequency needs (weekday for weekly, intervalDays for interval, monthDay for monthly). The schedule is given as structured fields rather than a phrase like 'every friday at 4pm' on purpose — an unrecognized phrase would fail silently, while a missing field here tells you exactly what to supply. Occurrences appear as normal tasks on their due days; for a one-off, use tasks_create instead.",
    inputSchema: OBJ(
      {
        title: S("What repeats, e.g. 'water the plants'."),
        ...RECURRENCE_PROPS,
        anchorDate: S(
          "YYYY-MM-DD the schedule counts from; the first occurrence is on or after it. Defaults to today.",
        ),
      },
      ["title", "freq"],
    ),
    handler: async (ownerId, args) => {
      const rule = await recurringRepo.createRecurringTask(
        ownerId,
        requireStr(args, "title"),
        recurrenceSpec(args),
        dateStr(args, "anchorDate") ?? localDateString(),
      );
      return {
        id: rule.id,
        title: rule.title,
        schedule: describeSchedule(recurringRepo.specOf(rule)),
        anchorDate: dayOnly(rule.anchorDate),
      };
    },
  },
  {
    name: "recurring_update",
    description:
      "Rewrite a rule's title and schedule. The whole schedule is replaced, so send every field the new frequency needs, not just the ones that changed. The anchor moves to `anchorDate` (today by default) and the occurrence cursor resets with it, so the next occurrence follows purely from the new schedule; already-created occurrence tasks stay where they are. To stop a rule temporarily rather than reshape it, use recurring_set_paused.",
    inputSchema: OBJ(
      {
        id: S("The rule's id, from recurring_list."),
        title: S("The rule's title."),
        ...RECURRENCE_PROPS,
        anchorDate: S("YYYY-MM-DD the new schedule counts from. Defaults to today."),
      },
      ["id", "title", "freq"],
    ),
    handler: async (ownerId, args) => {
      const rule = await recurringRepo.updateRecurringTask(
        ownerId,
        requireStr(args, "id"),
        requireStr(args, "title"),
        recurrenceSpec(args),
        dateStr(args, "anchorDate") ?? localDateString(),
      );
      if (!rule) throw new Error("Recurring rule not found");
      return {
        id: rule.id,
        title: rule.title,
        schedule: describeSchedule(recurringRepo.specOf(rule)),
        anchorDate: dayOnly(rule.anchorDate),
      };
    },
  },
  {
    name: "recurring_set_paused",
    description:
      "Pause a rule so it stops generating new occurrences, or resume it with paused=false. Reversible and non-destructive: the rule, its schedule and every occurrence it already produced stay put. Prefer this over recurring_delete whenever the user might want it back.",
    inputSchema: OBJ(
      { id: S("The rule's id."), paused: B("Defaults to true.") },
      ["id"],
    ),
    handler: async (ownerId, args) => {
      const rule = await recurringRepo.setRecurringPaused(
        ownerId,
        requireStr(args, "id"),
        bool(args, "paused") ?? true,
      );
      if (!rule) throw new Error("Recurring rule not found");
      return { id: rule.id, title: rule.title, paused: rule.paused };
    },
  },
  {
    name: "recurring_delete",
    description:
      "Permanently delete a recurrence rule. The rule and its schedule are gone for good — there is no trash for rules and no undo. Tasks it already generated survive as ordinary tasks. If the user only wants it to stop for now, use recurring_set_paused instead.",
    inputSchema: OBJ({ id: S("The rule's id.") }, ["id"]),
    handler: async (ownerId, args) => {
      const id = requireStr(args, "id");
      await recurringRepo.deleteRecurringTask(ownerId, id);
      return { id, deleted: true };
    },
  },

  // ---- Calendar ----------------------------------------------------------
  // Two sources, kept separate in the results because they behave differently:
  // `feedEvents` are read-only mirrors of the user's subscribed ICS calendar,
  // `manualEvents` are rows this app owns and can create or delete.
  {
    name: "calendar_list_day",
    description:
      "List everything on the user's calendar for one day (defaults to today): `feedEvents` from their subscribed calendar feed, which this app can only read, and `manualEvents` typed into this app, which it can also delete. `feedConfigured` is false when no calendar feed is set up at all — say so rather than reporting an empty day. For a stretch of days use calendar_list_range.",
    inputSchema: OBJ({ date: S("YYYY-MM-DD. Defaults to today.") }),
    handler: async (ownerId, args) => {
      const day = dateStr(args, "date") ?? localDateString();
      const { start, end } = localDayBounds(day);
      const [feed, manual] = await Promise.all([
        calendarRepo.listDayEvents(ownerId, start.toISOString(), end.toISOString()),
        eventsRepo.listEventsForRange(ownerId, day, day),
      ]);
      return {
        date: day,
        feedConfigured: feed.configured,
        feedEvents: feed.events.map((e) => ({
          uid: e.uid,
          title: e.title,
          allDay: e.allDay,
          startIso: e.allDay ? null : e.startIso,
          endIso: e.endIso,
        })),
        manualEvents: manual.map((e) => ({
          id: e.id,
          title: e.title,
          date: e.localDate,
          startMin: e.startMin,
          endMin: e.endMin,
        })),
      };
    },
  },
  {
    name: "calendar_list_range",
    description:
      "List calendar entries across an inclusive range of days, each tagged with the day it falls on — the tool for 'what does my week look like'. Same two sources as calendar_list_day: read-only `feedEvents` from the subscribed feed, and `manualEvents` this app owns. The feed side is capped at 60 days from `start`, so ask for a window you actually need.",
    inputSchema: OBJ(
      {
        start: S("First day, YYYY-MM-DD."),
        end: S("Last day, YYYY-MM-DD, inclusive."),
      },
      ["start", "end"],
    ),
    handler: async (ownerId, args) => {
      const start = dateStr(args, "start");
      const end = dateStr(args, "end");
      if (!start || !end) throw new Error("Both start and end are required");
      if (end < start) throw new Error("end must be on or after start");
      const [feed, manual] = await Promise.all([
        calendarRepo.listEventsForRange(ownerId, start, end),
        eventsRepo.listEventsForRange(ownerId, start, end),
      ]);
      return {
        start,
        end,
        feedConfigured: feed.configured,
        feedEvents: feed.events.map((e) => ({
          uid: e.uid,
          date: e.date,
          title: e.title,
          allDay: e.allDay,
          startIso: e.startIso,
          endIso: e.endIso,
        })),
        manualEvents: manual.map((e) => ({
          id: e.id,
          title: e.title,
          date: e.localDate,
          startMin: e.startMin,
          endMin: e.endMin,
        })),
      };
    },
  },
  {
    name: "calendar_list_meetings",
    description:
      "List today's timed meetings from the subscribed calendar feed, each with its attendees and — when a past note covered the same meeting — that note's still-open tasks and the day it was written. This is the 'what should I bring into my next meeting' view, not a full schedule: all-day events and declined meetings are excluded and the list is capped at a handful. Use calendar_list_day for the whole day.",
    inputSchema: OBJ({ date: S("YYYY-MM-DD. Defaults to today.") }),
    handler: async (ownerId, args) => {
      const day = dateStr(args, "date") ?? localDateString();
      const { start, end } = localDayBounds(day);
      const daily = await notesRepo.getDailyNote(ownerId, day);
      const result = await calendarRepo.listTodayMeetings(
        ownerId,
        start.toISOString(),
        end.toISOString(),
        daily?.id ?? null,
      );
      return {
        date: day,
        feedConfigured: result.configured,
        meetings: result.meetings.map((m) => ({
          uid: m.uid,
          title: m.title,
          startIso: m.startIso,
          endIso: m.endIso,
          attendees: m.attendees,
          lastMetDate: m.lastMetDate,
          openItems: m.openItems,
        })),
      };
    },
  },
  {
    name: "calendar_create_event",
    description:
      "Add an event to the user's own calendar in this app. Times are minutes from local midnight: omit startMin for an all-day event, give startMin alone for an untimed marker at that hour, or both for a real block. This never writes to the subscribed calendar feed — that stays read-only. To timebox an existing task instead of adding a new commitment, use blocks_place.",
    inputSchema: OBJ(
      {
        title: S("What the event is."),
        date: S("YYYY-MM-DD the event falls on."),
        startMin: N("Start, in minutes from local midnight (540 = 9:00 AM). Omit for all-day."),
        endMin: N("End, in minutes from local midnight. Requires startMin."),
      },
      ["title", "date"],
    ),
    handler: async (ownerId, args) => {
      const date = dateStr(args, "date");
      if (!date) throw new Error("Missing required argument: date");
      const startMin = minuteOfDay(args, "startMin");
      const endMin = minuteOfDay(args, "endMin");
      if (startMin === undefined && endMin !== undefined) {
        throw new Error("endMin needs a startMin — an end alone has no meaning");
      }
      const event = await eventsRepo.createEvent(
        ownerId,
        requireStr(args, "title"),
        date,
        startMin ?? null,
        endMin ?? null,
      );
      return {
        id: event.id,
        title: event.title,
        date: event.localDate,
        startMin: event.startMin,
        endMin: event.endMin,
      };
    },
  },
  {
    name: "calendar_delete_event",
    description:
      "Permanently delete an event the user created in this app. Not recoverable — there is no trash for events. Only works on `manualEvents` ids from calendar_list_day or calendar_list_range; events from the subscribed feed cannot be deleted here at all, and the way to silence one of those is calendar_decline_meeting.",
    inputSchema: OBJ({ id: S("The manual event's id.") }, ["id"]),
    handler: async (ownerId, args) => {
      const id = requireStr(args, "id");
      await eventsRepo.deleteEvent(ownerId, id);
      return { id, deleted: true };
    },
  },
  {
    name: "calendar_decline_meeting",
    description:
      "Stop the app offering a meeting scaffold for a calendar event, by its uid from calendar_list_meetings. This is a local preference only — it does not decline the invitation with the organizer or change anything in the real calendar, it just means this app stops asking. Idempotent, so declining twice is harmless.",
    inputSchema: OBJ({ uid: S("The meeting's uid, from calendar_list_meetings.") }, [
      "uid",
    ]),
    handler: async (ownerId, args) => {
      const uid = requireStr(args, "uid");
      await meetingsRepo.declineEvent(ownerId, uid);
      return { uid, declined: true };
    },
  },

  // ---- Timeline blocks ---------------------------------------------------
  {
    name: "blocks_list_day",
    description:
      "List the timeboxes on a day's timeline (defaults to today) — each one an existing task pinned to a start and end time, in minutes from local midnight, with whether that task is done. Blocks are a plan for the day, not the task list itself: use tasks_list for what's due.",
    inputSchema: OBJ({ date: S("YYYY-MM-DD. Defaults to today.") }),
    handler: async (ownerId, args) => {
      const day = dateStr(args, "date") ?? localDateString();
      const rows = await blocksRepo.listBlocksForDay(ownerId, day);
      return rows.map((b) => ({
        id: b.id,
        taskId: b.taskId,
        title: b.title,
        completed: b.completed,
        date: day,
        startMin: b.startMin,
        endMin: b.endMin,
      }));
    },
  },
  {
    name: "blocks_place",
    description:
      "Timebox an existing task on a day, giving it a start and end in minutes from local midnight (540–600 is 9:00–10:00 AM). A task can hold only one block per day, so calling this again for the same task and day moves that block rather than adding a second. Placing a block never changes the task's due date or completion — use tasks_set_due or tasks_complete for those.",
    inputSchema: OBJ(
      {
        taskId: S("The task's id, from tasks_list."),
        date: S("YYYY-MM-DD. Defaults to today."),
        startMin: N("Start, in minutes from local midnight (0–1440)."),
        endMin: N("End, in minutes from local midnight. Widened to at least 15 minutes after the start."),
      },
      ["taskId", "startMin", "endMin"],
    ),
    handler: async (ownerId, args) => {
      const day = dateStr(args, "date") ?? localDateString();
      const startMin = minuteOfDay(args, "startMin");
      const endMin = minuteOfDay(args, "endMin");
      if (startMin === undefined || endMin === undefined) {
        throw new Error("Both startMin and endMin are required");
      }
      const block = await blocksRepo.placeBlock(
        ownerId,
        requireStr(args, "taskId"),
        day,
        startMin,
        endMin,
      );
      if (!block) throw new Error("Task not found");
      return {
        id: block.id,
        taskId: block.taskId,
        title: block.title,
        date: day,
        startMin: block.startMin,
        endMin: block.endMin,
      };
    },
  },
  {
    name: "blocks_remove",
    description:
      "Take a timebox off the timeline. The task itself is untouched — it keeps its due date and completion state and simply stops being scheduled at that hour. Use tasks_complete if the user actually finished the work.",
    inputSchema: OBJ({ id: S("The block's id, from blocks_list_day.") }, ["id"]),
    handler: async (ownerId, args) => {
      const id = requireStr(args, "id");
      await blocksRepo.removeBlock(ownerId, id);
      return { id, removed: true };
    },
  },

  // ---- Automations -------------------------------------------------------
  {
    name: "automations_list",
    description:
      "List the user's plain-language automation rules, newest first, each with whether it's enabled and a one-line summary of the last thing it did. Read this before creating a rule so you don't add one that duplicates an existing one.",
    inputSchema: OBJ({}),
    handler: async (ownerId) => {
      const rows = await automationsRepo.listAutomations(ownerId);
      return rows.map((a) => ({
        id: a.id,
        rule: a.rule,
        enabled: a.enabled,
        createdAt: iso(a.createdAt),
        lastRun: a.lastRun
          ? {
              summary: a.lastRun.summary,
              ranAt: iso(a.lastRun.createdAt),
              undoneAt: iso(a.lastRun.undoneAt),
            }
          : null,
      }));
    },
  },
  {
    name: "automations_create",
    description:
      "Create an automation from a sentence describing when it should fire and what it should do, e.g. \"when I write a line starting with read:, add it to Reading list\". The rule is stored verbatim and interpreted when notes are saved — there is no compiled form, so write it the way the user said it. New rules start enabled.",
    inputSchema: OBJ({ rule: S("The rule, in the user's own words.") }, ["rule"]),
    handler: async (ownerId, args) => {
      const automation = await automationsRepo.createAutomation(
        ownerId,
        requireStr(args, "rule").slice(0, 500),
      );
      return {
        id: automation.id,
        rule: automation.rule,
        enabled: automation.enabled,
      };
    },
  },
  {
    name: "automations_set_enabled",
    description:
      "Turn an automation off so it stops firing, or back on with enabled=true. Fully reversible and keeps the rule text and its run history — the right choice whenever the user might want it back. automations_delete throws the rule away instead.",
    inputSchema: OBJ(
      { id: S("The automation's id."), enabled: B("Defaults to false (turn it off).") },
      ["id"],
    ),
    handler: async (ownerId, args) => {
      const automation = await automationsRepo.setAutomationEnabled(
        ownerId,
        requireStr(args, "id"),
        bool(args, "enabled") ?? false,
      );
      if (!automation) throw new Error("Automation not found");
      return { id: automation.id, rule: automation.rule, enabled: automation.enabled };
    },
  },
  {
    name: "automations_delete",
    description:
      "Permanently delete an automation and its entire run history. Not recoverable — there is no trash for automations, and the record of what it already did goes with it. Anything the rule previously created stays. Use automations_set_enabled to just switch it off.",
    inputSchema: OBJ({ id: S("The automation's id.") }, ["id"]),
    handler: async (ownerId, args) => {
      const id = requireStr(args, "id");
      await automationsRepo.deleteAutomation(ownerId, id);
      return { id, deleted: true };
    },
  },

  // ---- Week reviews ------------------------------------------------------
  {
    name: "week_review_get",
    description:
      "Read the stored week-review draft for a week, keyed by that week's Monday. Returns null when no draft has been written yet — this reads a cached draft, it does not compose one. Use notes and tasks tools to gather the week's material and week_review_upsert to store what you wrote.",
    inputSchema: OBJ({ weekStart: S("The week's Monday, YYYY-MM-DD.") }, [
      "weekStart",
    ]),
    handler: async (ownerId, args) => {
      const weekStart = dateStr(args, "weekStart");
      if (!weekStart) throw new Error("Missing required argument: weekStart");
      const review = await weekReviewsRepo.getWeekReview(ownerId, weekStart);
      if (!review) return null;
      return {
        weekStart: review.weekStart,
        content: review.content,
        insertedNoteId: review.insertedNoteId,
        updatedAt: iso(review.updatedAt),
      };
    },
  },
  {
    name: "week_review_upsert",
    description:
      "Store (or overwrite) the week-review draft for a week, keyed by that week's Monday. Overwriting is total — the previous draft is replaced and, if it had already been inserted into a note, that link is cleared so the draft reads as fresh again. The note it was previously inserted into is untouched. Read week_review_get first if you mean to extend a draft rather than replace it.",
    inputSchema: OBJ(
      {
        weekStart: S("The week's Monday, YYYY-MM-DD."),
        done: S("Prose summary of what got finished."),
        stillOpen: S("Prose summary of what is still outstanding."),
        doneDays: {
          type: "array",
          items: { type: "string" },
          description: "YYYY-MM-DD days the 'done' summary draws on.",
        },
        openDays: {
          type: "array",
          items: { type: "string" },
          description: "YYYY-MM-DD days the 'still open' summary draws on.",
        },
        threads: {
          type: "array",
          description: "Topics that ran through the week.",
          items: {
            type: "object",
            properties: {
              topic: { type: "string" },
              mentions: { type: "number" },
            },
            required: ["topic"],
          },
        },
      },
      ["weekStart", "done", "stillOpen"],
    ),
    handler: async (ownerId, args) => {
      const weekStart = dateStr(args, "weekStart");
      if (!weekStart) throw new Error("Missing required argument: weekStart");
      const days = (key: string) =>
        strList(args, key).filter((d) => {
          if (!DATE_RE.test(d)) throw new Error(`${key} entries must be YYYY-MM-DD, got: ${d}`);
          return true;
        });
      const rawThreads = Array.isArray(args.threads) ? args.threads : [];
      const threads = rawThreads
        .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
        .map((t) => ({
          topic: typeof t.topic === "string" ? t.topic : "",
          mentions: typeof t.mentions === "number" ? t.mentions : 0,
        }))
        .filter((t) => t.topic.length > 0);
      const review = await weekReviewsRepo.upsertWeekReview(ownerId, weekStart, {
        done: requireStr(args, "done"),
        doneDays: days("doneDays"),
        stillOpen: requireStr(args, "stillOpen"),
        openDays: days("openDays"),
        threads,
      });
      return { weekStart: review.weekStart, saved: true };
    },
  },

  // ---- Settings ----------------------------------------------------------
  {
    name: "settings_get",
    description:
      "Read the user's app settings: whether a calendar feed is subscribed, whether recall is on, and their timezone. The calendar feed URL is a secret address that grants read access to their whole calendar, so it is reported only as configured/not — never as the URL itself.",
    inputSchema: OBJ({}),
    handler: async (ownerId) => {
      const settings = await settingsRepo.getSettings(ownerId);
      return {
        calendarConfigured: settings.calendarIcsUrl !== null,
        recallEnabled: settings.recallEnabled,
        timezone: settings.timezone,
        threadsScannedAt: iso(settings.threadsScannedAt),
      };
    },
  },
  {
    name: "settings_update",
    description:
      "Change one or more app settings. Only the fields you send are touched; anything omitted keeps its current value. Pass calendarIcsUrl to subscribe to a calendar feed, or an empty string to unsubscribe — a wrong URL silently yields an empty calendar rather than an error, so only set it from a value the user gave you.",
    inputSchema: OBJ({
      calendarIcsUrl: S(
        "The calendar feed's secret ICS URL, or an empty string to unsubscribe.",
      ),
      recallEnabled: B("Whether the app surfaces recalled notes."),
      timezone: S("IANA timezone name, e.g. 'America/New_York'."),
    }),
    handler: async (ownerId, args) => {
      const patch: {
        calendarIcsUrl?: string | null;
        recallEnabled?: boolean;
        timezone?: string | null;
      } = {};
      if (typeof args.calendarIcsUrl === "string") {
        patch.calendarIcsUrl = args.calendarIcsUrl.trim() || null;
      }
      const recall = bool(args, "recallEnabled");
      if (recall !== undefined) patch.recallEnabled = recall;
      if (typeof args.timezone === "string") {
        patch.timezone = args.timezone.trim() || null;
      }
      if (Object.keys(patch).length === 0) {
        throw new Error("Nothing to update — pass at least one setting");
      }
      const settings = await settingsRepo.updateSettings(ownerId, patch);
      return {
        calendarConfigured: settings.calendarIcsUrl !== null,
        recallEnabled: settings.recallEnabled,
        timezone: settings.timezone,
      };
    },
  },

  // ---- Capture inbox -----------------------------------------------------
  // There is deliberately no tool for adding an item. The only way into the
  // inbox is `inbox.addSharedItem`, which calls `suggestDestination` on every
  // insert — a model request the user never asked for. `fileItem` and
  // `dismissItem` take no AI path at all, so the read/triage half is exposed
  // and the ingestion half stays with the OS share sheet that owns it.
  {
    name: "inbox_list",
    description:
      "List what is waiting in the capture inbox — links, text and photos shared into the app from elsewhere and not yet dealt with. Each item may carry a suggested folder worked out when it arrived; the suggestion is a hint, not a decision. Items flagged `isSample` are placeholder rows shown to new accounts, so don't treat them as things the user really saved.",
    inputSchema: OBJ({}),
    handler: async (ownerId) => {
      const rows = await inboxRepo.listInbox(ownerId);
      return rows.map((r) => ({
        id: r.id,
        source: r.source,
        title: r.title,
        excerpt: r.excerpt,
        url: r.url,
        attachmentUrl: r.attachmentUrl,
        suggestedFolderId: r.suggestedBubbleId,
        suggestedFolderTitle: r.bubbleTitle,
        suggestionReason: r.suggestionReason,
        isSample: r.isSample,
        receivedAt: iso(r.receivedAt),
      }));
    },
  },
  {
    name: "inbox_file",
    description:
      "Accept an inbox item: turn it into a real note carrying its title, text, link and any image, then clear it from the inbox. Pass folderId to file the note into a folder — folders_list has the ids, and an item's own suggestedFolderId is a reasonable default when the user hasn't said otherwise. Omit folderId to leave the note unfiled. The item is consumed either way; use inbox_dismiss when it shouldn't become a note at all.",
    inputSchema: OBJ(
      {
        id: S("The inbox item's id, from inbox_list."),
        folderId: S("Optional folder (bubble) id to file the new note under."),
      },
      ["id"],
    ),
    handler: async (ownerId, args) => {
      const id = requireStr(args, "id");
      const result = await inboxRepo.fileItem(
        ownerId,
        id,
        str(args, "folderId") ?? null,
      );
      if (!result) throw new Error("Inbox item not found");
      return { id, noteId: result.noteId, filed: true };
    },
  },
  {
    name: "inbox_dismiss",
    description:
      "Drop an inbox item without making a note of it — the 'not worth keeping' outcome. The row is marked dismissed rather than erased, but nothing in this API brings it back, so use inbox_file if there's any chance the user wants the content.",
    inputSchema: OBJ({ id: S("The inbox item's id, from inbox_list.") }, ["id"]),
    handler: async (ownerId, args) => {
      const id = requireStr(args, "id");
      await inboxRepo.dismissItem(ownerId, id);
      return { id, dismissed: true };
    },
  },
];

export const MCP_TOOLS_BY_NAME = new Map(MCP_TOOLS.map((t) => [t.name, t]));
