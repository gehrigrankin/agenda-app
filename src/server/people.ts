import "server-only";

import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
} from "drizzle-orm";

import { db } from "@/db";
import { notes, people, personCommitments, personMentions } from "@/db/schema";
import { escapeLikePattern } from "@/server/notes";

/**
 * Data-access layer for people pages (`people` + `person_mentions` +
 * `person_commitments`). People are CONTACTS: you add them manually, or the
 * (optional) AI scan discovers them from your notes. Either way, the name-match
 * scanner below links every note that mentions a person's name and builds their
 * timeline — that part needs no API key. The AI scan additionally extracts
 * owe/owed commitments when a key is configured.
 *
 * Idempotency: the (ownerId, nameKey) unique index dedupes people, and the
 * name-match rebuild replaces a person's mentions wholesale so re-runs converge.
 */

export type CommitmentDirection = "you_owe" | "they_owe";

const MENTION_SCAN_NOTES = 400;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A whole-word, case-insensitive matcher for a person's name (Unicode-aware,
 * so "Sam" doesn't match "Samuel" or "same"). */
function nameBoundaryRegExp(name: string): RegExp {
  return new RegExp(
    `(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}(?=[^\\p{L}\\p{N}]|$)`,
    "iu",
  );
}

/**
 * A ~180-char window of text centered on the first whole-word occurrence of
 * `name`, whitespace-collapsed with ellipses — the mention's snippet.
 */
function contextSnippet(text: string, name: string): string | null {
  const clean = text.replace(/\s+/g, " ").trim();
  const m = nameBoundaryRegExp(name).exec(clean);
  if (!m) return null;
  const idx = m.index + m[1].length;
  const start = Math.max(0, idx - 70);
  const end = Math.min(clean.length, idx + name.length + 110);
  let snippet = clean.slice(start, end).trim();
  if (start > 0) snippet = `…${snippet}`;
  if (end < clean.length) snippet = `${snippet}…`;
  return snippet.slice(0, 300);
}

/**
 * Every person with mention stats, most recently mentioned first. Two
 * queries (people + one aggregate over mentions) — fine at personal scale.
 */
export async function listPeople(ownerId: string) {
  const rows = await db
    .select({
      id: people.id,
      name: people.name,
      lastMentionedAt: people.lastMentionedAt,
    })
    .from(people)
    .where(eq(people.ownerId, ownerId));
  if (rows.length === 0) return [];

  const stats = await db
    .select({
      personId: personMentions.personId,
      mentionCount: count(personMentions.id),
    })
    .from(personMentions)
    .where(
      inArray(
        personMentions.personId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(personMentions.personId);
  const byPerson = new Map(stats.map((s) => [s.personId, s.mentionCount]));

  return rows
    .map((r) => ({ ...r, mentionCount: byPerson.get(r.id) ?? 0 }))
    .sort(
      (a, b) =>
        (b.lastMentionedAt?.getTime() ?? 0) - (a.lastMentionedAt?.getTime() ?? 0),
    );
}

/**
 * One person's full page: every mention (newest first, matching "RECENT
 * MENTIONS") plus commitments split by direction for the owe/owed columns.
 * Mentions whose note is in the Trash are hidden.
 */
export async function getPerson(ownerId: string, personId: string) {
  const [person] = await db
    .select()
    .from(people)
    .where(and(eq(people.id, personId), eq(people.ownerId, ownerId)))
    .limit(1);
  if (!person) return null;

  const mentions = await db
    .select({
      id: personMentions.id,
      noteId: personMentions.noteId,
      noteTitle: notes.title,
      noteDailyDate: notes.dailyDate,
      snippet: personMentions.snippet,
      mentionDate: personMentions.mentionDate,
    })
    .from(personMentions)
    .innerJoin(notes, eq(personMentions.noteId, notes.id))
    .where(and(eq(personMentions.personId, person.id), isNull(notes.deletedAt)))
    .orderBy(desc(personMentions.mentionDate));

  const commitments = await db
    .select()
    .from(personCommitments)
    .where(eq(personCommitments.personId, person.id))
    .orderBy(desc(personCommitments.createdAt));

  return {
    ...person,
    mentions,
    youOwe: commitments.filter((c) => c.direction === "you_owe"),
    theyOwe: commitments.filter((c) => c.direction === "they_owe"),
  };
}

/**
 * Idempotent write path for the People scan: upsert the person on
 * (ownerId, nameKey) — an existing person keeps its id and just gets its
 * `lastMentionedAt`/`updatedAt` bumped — then insert mentions and commitments,
 * deduped by their unique indexes. Note ids in `mentions` and
 * `commitments[].sourceNoteId` come from scan output over client-saved
 * content, so they're re-verified against the owner's own notes before
 * insert. Returns the person id (or null for a blank name).
 */
export async function upsertPersonWithData(
  ownerId: string,
  data: {
    name: string;
    mentions: Array<{ noteId: string; snippet: string; mentionDate: Date }>;
    commitments: Array<{
      direction: CommitmentDirection;
      text: string;
      contextLabel?: string | null;
      sourceNoteId?: string | null;
    }>;
  },
): Promise<string | null> {
  const name = data.name.trim().slice(0, 120);
  const nameKey = name.toLowerCase();
  if (!nameKey) return null;

  const lastMentionedAt = data.mentions.reduce<Date | null>(
    (latest, m) => (!latest || m.mentionDate > latest ? m.mentionDate : latest),
    null,
  );

  const [person] = await db
    .insert(people)
    .values({ ownerId, name, nameKey, lastMentionedAt })
    .onConflictDoUpdate({
      target: [people.ownerId, people.nameKey],
      set: {
        updatedAt: new Date(),
        ...(lastMentionedAt ? { lastMentionedAt } : {}),
      },
    })
    .returning({ id: people.id });

  const candidateNoteIds = new Set<string>();
  for (const m of data.mentions) candidateNoteIds.add(m.noteId);
  for (const c of data.commitments) {
    if (c.sourceNoteId) candidateNoteIds.add(c.sourceNoteId);
  }
  const owned =
    candidateNoteIds.size > 0
      ? await db
          .select({ id: notes.id })
          .from(notes)
          .where(
            and(eq(notes.ownerId, ownerId), inArray(notes.id, [...candidateNoteIds])),
          )
      : [];
  const ownedIds = new Set(owned.map((r) => r.id));

  if (data.mentions.length > 0) {
    const values = data.mentions
      .filter((m) => ownedIds.has(m.noteId))
      .map((m) => ({
        personId: person.id,
        ownerId,
        noteId: m.noteId,
        snippet: m.snippet.slice(0, 300),
        mentionDate: m.mentionDate,
      }));
    if (values.length > 0) {
      await db.insert(personMentions).values(values).onConflictDoNothing();
    }
  }

  if (data.commitments.length > 0) {
    const values = data.commitments
      .filter((c) => !c.sourceNoteId || ownedIds.has(c.sourceNoteId))
      .map((c) => ({
        personId: person.id,
        ownerId,
        direction: c.direction,
        text: c.text.slice(0, 300),
        contextLabel: c.contextLabel?.trim().slice(0, 120) || null,
        sourceNoteId: c.sourceNoteId ?? null,
      }));
    if (values.length > 0) {
      await db.insert(personCommitments).values(values).onConflictDoNothing();
    }
  }

  return person.id;
}

/**
 * Manually add a contact. Upserts on (ownerId, nameKey) so adding "Sam" when a
 * Sam already exists just returns the existing page rather than erroring.
 */
export async function createPerson(ownerId: string, name: string) {
  const clean = name.trim().slice(0, 120);
  const nameKey = clean.toLowerCase();
  if (!nameKey) return null;
  const [person] = await db
    .insert(people)
    .values({ ownerId, name: clean, nameKey })
    .onConflictDoUpdate({
      target: [people.ownerId, people.nameKey],
      set: { updatedAt: new Date() },
    })
    .returning();
  return person;
}

/** Remove a contact (cascades their mentions + commitments). */
export async function deletePerson(ownerId: string, id: string): Promise<void> {
  await db
    .delete(people)
    .where(and(eq(people.id, id), eq(people.ownerId, ownerId)));
}

/**
 * Rebuild one person's mentions from name matches across the owner's live
 * notes — the no-AI heart of the contact timeline. Every note whose text
 * contains the person's name as a whole word becomes one mention (a snippet of
 * surrounding context, dated by the note's day). The rebuild is wholesale
 * (delete-then-insert) so it's the single source of truth for mentions and
 * converges on re-run; `lastMentionedAt` is refreshed from the newest match.
 */
async function rebuildMentionsForPerson(
  ownerId: string,
  person: { id: string; name: string },
): Promise<number> {
  const candidates = await db
    .select({
      id: notes.id,
      dailyDate: notes.dailyDate,
      updatedAt: notes.updatedAt,
      text: notes.textContent,
    })
    .from(notes)
    .where(
      and(
        eq(notes.ownerId, ownerId),
        isNull(notes.deletedAt),
        isNotNull(notes.textContent),
        // Cheap prefilter; the whole-word check below removes substring hits.
        ilike(notes.textContent, `%${escapeLikePattern(person.name)}%`),
      ),
    )
    .orderBy(desc(notes.updatedAt))
    .limit(MENTION_SCAN_NOTES);

  const boundary = nameBoundaryRegExp(person.name);
  const rows: Array<{
    personId: string;
    ownerId: string;
    noteId: string;
    snippet: string;
    mentionDate: Date;
  }> = [];
  let latest: Date | null = null;
  for (const n of candidates) {
    if (!n.text || !boundary.test(n.text)) continue;
    const snippet = contextSnippet(n.text, person.name);
    if (!snippet) continue;
    const mentionDate = n.dailyDate ?? n.updatedAt;
    if (!latest || mentionDate > latest) latest = mentionDate;
    rows.push({ personId: person.id, ownerId, noteId: n.id, snippet, mentionDate });
  }

  await db.delete(personMentions).where(eq(personMentions.personId, person.id));
  if (rows.length > 0) {
    await db.insert(personMentions).values(rows).onConflictDoNothing();
  }
  await db
    .update(people)
    .set({ lastMentionedAt: latest, updatedAt: new Date() })
    .where(and(eq(people.id, person.id), eq(people.ownerId, ownerId)));
  return rows.length;
}

/** Rebuild mentions for a single contact by id (after adding them). */
export async function rebuildMentionsForPersonId(
  ownerId: string,
  id: string,
): Promise<void> {
  const [p] = await db
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(and(eq(people.id, id), eq(people.ownerId, ownerId)))
    .limit(1);
  if (p) await rebuildMentionsForPerson(ownerId, p);
}

/** Rebuild every contact's mention timeline (the name-match sweep). */
export async function rescanAllPeopleMentions(ownerId: string): Promise<number> {
  const ppl = await db
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(eq(people.ownerId, ownerId));
  for (const p of ppl) await rebuildMentionsForPerson(ownerId, p);
  return ppl.length;
}

/** Mark a commitment resolved/unresolved (the owe-row checkbox). */
export async function setCommitmentResolved(
  ownerId: string,
  commitmentId: string,
  resolved: boolean,
) {
  const [row] = await db
    .update(personCommitments)
    .set({ resolvedAt: resolved ? new Date() : null })
    .where(
      and(
        eq(personCommitments.id, commitmentId),
        eq(personCommitments.ownerId, ownerId),
      ),
    )
    .returning();
  return row ?? null;
}
