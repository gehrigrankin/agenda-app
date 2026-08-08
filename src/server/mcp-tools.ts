import "server-only";

import type { SerializedEditorState } from "lexical";

import { localDateString } from "@/lib/dates";
import {
  blocksToMarkdown,
  docToMarkdown,
  markdownToBlocks,
  markdownToDoc,
} from "@/lib/markdown-lexical";
import { parseHashtags } from "@/lib/hashtags";
import * as bubblesRepo from "@/server/bubbles";
import * as noteLogsRepo from "@/server/note-logs";
import * as notesRepo from "@/server/notes";
import * as tagsRepo from "@/server/tags";
import * as tasksRepo from "@/server/tasks";

/**
 * The tool surface the MCP server exposes — notes, tasks, tags, folders,
 * daily jots, and call logs.
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
      "List the user's open tasks. `scope` picks which: 'due' (due today or overdue), 'upcoming' (due later), 'unscheduled' (captured with no date), or 'recent' (newest first, regardless of date).",
    inputSchema: OBJ({
      scope: {
        type: "string",
        enum: ["due", "upcoming", "unscheduled", "recent"],
        description: "Which set of open tasks to return. Defaults to 'due'.",
      },
      date: S("YYYY-MM-DD reference day for 'due' and 'upcoming'. Defaults to today."),
      limit: N("Max results for 'recent' (default 25, max 100)."),
    }),
    handler: async (ownerId, args) => {
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
      "Create a task. `#tags` typed into the title are parsed out and applied, the same as in the app's quick-add — so 'call the dentist #health' files itself under #health.",
    inputSchema: OBJ(
      {
        title: S("The task's title. May contain #tags."),
        due: S("YYYY-MM-DD due date. Omit for an unscheduled task."),
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
      const task = await tasksRepo.createStandaloneTask(
        ownerId,
        parsed.title || raw,
        due ? dueDate(due) : null,
      );
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
      return { id: task.id, title: task.title, due: due ?? null, tags };
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

  // ---- Tags, folders, logs ----------------------------------------------
  {
    name: "tags_list",
    description:
      "List every tag, with how many open tasks carry each. Use this before tagging to reuse an existing tag rather than creating a near-duplicate.",
    inputSchema: OBJ({}),
    handler: async (ownerId) => tagsRepo.listTags(ownerId),
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
];

export const MCP_TOOLS_BY_NAME = new Map(MCP_TOOLS.map((t) => [t.name, t]));
