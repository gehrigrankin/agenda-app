"use server";

import { auth } from "@clerk/nextjs/server";

import {
  addCommitment,
  createPerson,
  deleteCommitment,
  deletePerson,
  getPerson,
  listPeople,
  rebuildMentionsForPersonId,
  rescanAllPeopleMentions,
  setCommitmentResolved,
} from "@/server/people";

/**
 * Server actions for the People page (design 15a, extended into contacts).
 * People is a fully AI-free feature: contacts are added by hand or discovered
 * by the name-match sweep, mentions are built from note text, and owe/owed
 * commitments are entered manually. Same contract as the other action files:
 * Clerk auth via requireUserId, owner-scoped repo calls, plain serializable
 * returns (dates as ISO strings).
 */

async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  return userId;
}

export interface PersonListItem {
  id: string;
  name: string;
  mentionCount: number;
  lastMentionedAt: string | null;
}

export async function listPeopleAction(): Promise<PersonListItem[]> {
  const userId = await requireUserId();
  const rows = await listPeople(userId);
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    mentionCount: p.mentionCount,
    lastMentionedAt: p.lastMentionedAt?.toISOString() ?? null,
  }));
}

export interface PeopleRefreshOutcome {
  /** How many contacts had their timelines rebuilt. */
  scanned: number;
}

/**
 * Rebuild every contact's mention timeline from note text (the name-match
 * sweep). No AI — this is the whole refresh path now. `force` is accepted for
 * call-site symmetry but the sweep always runs (it's cheap at personal scale).
 */
export async function refreshPeopleAction(): Promise<PeopleRefreshOutcome> {
  const userId = await requireUserId();
  const scanned = await rescanAllPeopleMentions(userId);
  return { scanned };
}

/** Add a contact manually, then build their timeline from existing notes. */
export async function createPersonAction(
  name: string,
): Promise<PersonListItem | null> {
  const userId = await requireUserId();
  const clean = (typeof name === "string" ? name : "").trim().slice(0, 120);
  if (!clean) return null;
  const person = await createPerson(userId, clean);
  if (!person) return null;
  await rebuildMentionsForPersonId(userId, person.id);
  const rows = await listPeople(userId);
  const created = rows.find((p) => p.id === person.id);
  return created
    ? {
        id: created.id,
        name: created.name,
        mentionCount: created.mentionCount,
        lastMentionedAt: created.lastMentionedAt?.toISOString() ?? null,
      }
    : { id: person.id, name: person.name, mentionCount: 0, lastMentionedAt: null };
}

export async function deletePersonAction(id: string): Promise<void> {
  const userId = await requireUserId();
  await deletePerson(userId, id);
}

export interface PersonMentionItem {
  id: string;
  noteId: string;
  noteTitle: string;
  noteDailyDate: string | null;
  snippet: string;
  mentionDate: string;
}

export interface PersonCommitmentItem {
  id: string;
  direction: "you_owe" | "they_owe";
  text: string;
  contextLabel: string | null;
  sourceNoteId: string | null;
  resolvedAt: string | null;
}

export interface PersonDetailResult {
  id: string;
  name: string;
  lastMentionedAt: string | null;
  mentionCount: number;
  mentions: PersonMentionItem[];
  youOwe: PersonCommitmentItem[];
  theyOwe: PersonCommitmentItem[];
}

export async function getPersonAction(
  personId: string,
): Promise<PersonDetailResult | null> {
  const userId = await requireUserId();
  const person = await getPerson(userId, personId);
  if (!person) return null;
  const mentions: PersonMentionItem[] = person.mentions.map((m) => ({
    id: m.id,
    noteId: m.noteId,
    noteTitle: m.noteTitle,
    noteDailyDate: m.noteDailyDate ? m.noteDailyDate.toISOString().slice(0, 10) : null,
    snippet: m.snippet,
    mentionDate: m.mentionDate.toISOString(),
  }));
  const toCommitment = (c: (typeof person.youOwe)[number]): PersonCommitmentItem => ({
    id: c.id,
    direction: c.direction,
    text: c.text,
    contextLabel: c.contextLabel,
    sourceNoteId: c.sourceNoteId,
    resolvedAt: c.resolvedAt?.toISOString() ?? null,
  });
  return {
    id: person.id,
    name: person.name,
    lastMentionedAt: person.lastMentionedAt?.toISOString() ?? null,
    mentionCount: mentions.length,
    mentions,
    youOwe: person.youOwe.map(toCommitment),
    theyOwe: person.theyOwe.map(toCommitment),
  };
}

export async function toggleCommitmentAction(
  commitmentId: string,
  resolved: boolean,
): Promise<void> {
  const userId = await requireUserId();
  await setCommitmentResolved(userId, commitmentId, resolved);
}

export async function addCommitmentAction(
  personId: string,
  direction: "you_owe" | "they_owe",
  text: string,
): Promise<PersonCommitmentItem | null> {
  const userId = await requireUserId();
  if (direction !== "you_owe" && direction !== "they_owe") {
    throw new Error("Invalid direction");
  }
  const row = await addCommitment(userId, personId, direction, text);
  if (!row) return null;
  return {
    id: row.id,
    direction: row.direction,
    text: row.text,
    contextLabel: row.contextLabel,
    sourceNoteId: row.sourceNoteId,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

export async function deleteCommitmentAction(id: string): Promise<void> {
  const userId = await requireUserId();
  await deleteCommitment(userId, id);
}
