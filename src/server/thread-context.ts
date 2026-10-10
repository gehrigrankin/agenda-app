import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import { db } from "@/db";
import {
  noteTasks,
  notes,
  people,
  tasks,
  threadMentions,
  threads,
  voiceMemos,
} from "@/db/schema";
import { escapeLikePattern } from "@/server/notes";

/**
 * Context for one thread (the Threads page's right-hand sidebar): the people
 * whose names appear in its mentions, the open tasks linked to the notes it
 * spans, and notes that talk about the topic but aren't in the thread yet.
 * Everything is owner-scoped; callers are expected to degrade to an empty
 * context on errors (the action does).
 */

export interface ThreadContextPerson {
  id: string;
  name: string;
}
export interface ThreadContextTask {
  id: string;
  title: string;
  /** ISO instant (tasks store midnight UTC for date-only dues) or null. */
  dueAt: string | null;
}
export interface ThreadContextSuggestion {
  noteId: string;
  title: string;
  /** YYYY-MM-DD when the note is a daily note. */
  dailyDate: string | null;
}
export interface ThreadContext {
  people: ThreadContextPerson[];
  tasks: ThreadContextTask[];
  suggested: ThreadContextSuggestion[];
  /** Notes of this thread that hold a voice memo (timeline "voice" kind). */
  voiceNoteIds: string[];
}

export const EMPTY_THREAD_CONTEXT: ThreadContext = {
  people: [],
  tasks: [],
  suggested: [],
  voiceNoteIds: [],
};

const MAX_TEXT_PER_NOTE = 20_000;
const MAX_PEOPLE = 12;
const MAX_TASKS = 20;
const MAX_SUGGESTED = 5;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word, case-insensitive, Unicode-aware ("Sam" is not "Samuel"). */
function nameRegExp(name: string): RegExp {
  return new RegExp(
    `(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}(?=[^\\p{L}\\p{N}]|$)`,
    "iu",
  );
}

export async function getThreadContext(
  ownerId: string,
  threadId: string,
): Promise<ThreadContext> {
  const [thread] = await db
    .select({ id: threads.id, topic: threads.topic })
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.ownerId, ownerId)))
    .limit(1);
  if (!thread) return EMPTY_THREAD_CONTEXT;

  // The thread's live notes (trashed ones are hidden from the timeline too).
  const mentionRows = await db
    .select({
      noteId: notes.id,
      title: notes.title,
      text: sql<string>`left(coalesce(${notes.textContent}, ''), ${MAX_TEXT_PER_NOTE})`,
      snippet: threadMentions.snippet,
    })
    .from(threadMentions)
    .innerJoin(notes, eq(threadMentions.noteId, notes.id))
    .where(
      and(
        eq(threadMentions.threadId, thread.id),
        eq(notes.ownerId, ownerId),
        isNull(notes.deletedAt),
      ),
    );
  const noteIds = [...new Set(mentionRows.map((r) => r.noteId))];

  const [peopleList, openTasks, voice, suggested] = await Promise.all([
    findPeople(ownerId, mentionRows),
    noteIds.length > 0 ? findOpenTasks(ownerId, noteIds) : [],
    noteIds.length > 0 ? findVoiceNotes(ownerId, noteIds) : [],
    findSuggested(ownerId, thread.topic, noteIds),
  ]);

  return {
    people: peopleList,
    tasks: openTasks,
    suggested,
    voiceNoteIds: voice,
  };
}

async function findPeople(
  ownerId: string,
  mentionRows: Array<{ title: string; text: string; snippet: string }>,
): Promise<ThreadContextPerson[]> {
  if (mentionRows.length === 0) return [];
  const all = await db
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(eq(people.ownerId, ownerId))
    .orderBy(asc(people.name));
  if (all.length === 0) return [];
  const haystack = mentionRows
    .map((r) => `${r.title}\n${r.snippet}\n${r.text}`)
    .join("\n");
  return all
    .filter(
      (p) => p.name.trim().length >= 2 && nameRegExp(p.name).test(haystack),
    )
    .slice(0, MAX_PEOPLE);
}

async function findOpenTasks(
  ownerId: string,
  noteIds: string[],
): Promise<ThreadContextTask[]> {
  const rows = await db
    .selectDistinct({
      id: tasks.id,
      title: tasks.title,
      dueAt: tasks.dueAt,
    })
    .from(noteTasks)
    .innerJoin(tasks, eq(noteTasks.taskId, tasks.id))
    .where(
      and(
        inArray(noteTasks.noteId, noteIds),
        eq(tasks.ownerId, ownerId),
        isNull(tasks.completedAt),
      ),
    )
    .orderBy(sql`${tasks.dueAt} asc nulls last`, asc(tasks.title))
    .limit(MAX_TASKS);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    dueAt: r.dueAt?.toISOString() ?? null,
  }));
}

async function findVoiceNotes(
  ownerId: string,
  noteIds: string[],
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ noteId: voiceMemos.noteId })
    .from(voiceMemos)
    .where(
      and(eq(voiceMemos.ownerId, ownerId), inArray(voiceMemos.noteId, noteIds)),
    );
  return rows.flatMap((r) => (r.noteId ? [r.noteId] : []));
}

async function findSuggested(
  ownerId: string,
  topic: string,
  excludeNoteIds: string[],
): Promise<ThreadContextSuggestion[]> {
  const needle = topic.trim();
  if (needle.length < 2) return [];
  const like = `%${escapeLikePattern(needle)}%`;
  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      dailyDate: notes.dailyDate,
    })
    .from(notes)
    .where(
      and(
        eq(notes.ownerId, ownerId),
        isNull(notes.deletedAt),
        or(ilike(notes.title, like), ilike(notes.textContent, like)),
        excludeNoteIds.length > 0
          ? notInArray(notes.id, excludeNoteIds)
          : undefined,
      ),
    )
    .orderBy(desc(notes.updatedAt))
    .limit(MAX_SUGGESTED);
  return rows.map((r) => ({
    noteId: r.id,
    title: r.title,
    dailyDate: r.dailyDate ? r.dailyDate.toISOString().slice(0, 10) : null,
  }));
}
