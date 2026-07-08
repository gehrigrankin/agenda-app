"use server";

import { auth } from "@clerk/nextjs/server";

import { isAiConfigured } from "@/server/ai/client";
import { scanPeople } from "@/server/ai/people";
import {
  createPerson,
  deletePerson,
  getPerson,
  listPeople,
  rebuildMentionsForPersonId,
  rescanAllPeopleMentions,
  setCommitmentResolved,
} from "@/server/people";

/**
 * Server actions for the People page (design 15a). Same contract as
 * ../ai/actions.ts: Clerk auth via requireUserId, owner-scoped repo calls,
 * plain serializable return shapes (dates as ISO strings).
 */

async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  return userId;
}

export interface PeopleAiSettingsResult {
  aiConfigured: boolean;
}

export async function getPeopleAiSettingsAction(): Promise<PeopleAiSettingsResult> {
  await requireUserId();
  return { aiConfigured: isAiConfigured };
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
 * Refresh everyone's timeline. When a key is configured the AI scan runs first
 * (self-throttled unless forced) to discover new people + owe/owed; then the
 * no-AI name-match sweep rebuilds every contact's mentions. Works with no key —
 * it just skips the AI half.
 */
export async function refreshPeopleAction(
  force = false,
): Promise<PeopleRefreshOutcome> {
  const userId = await requireUserId();
  if (isAiConfigured) {
    try {
      await scanPeople(userId, { force });
    } catch (err) {
      console.error("[people] ai scan failed (continuing):", err);
    }
  }
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
