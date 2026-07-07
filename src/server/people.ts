import "server-only";

import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { notes, people, personCommitments, personMentions } from "@/db/schema";

/**
 * Data-access layer for auto-maintained people pages (`people` +
 * `person_mentions` + `person_commitments`). The People scan writes these; the
 * user never creates or files a person themselves. Rescans are idempotent: the
 * (ownerId, nameKey) unique index dedupes people, (personId, noteId, snippet)
 * dedupes mentions, and (personId, direction, text) dedupes commitments.
 */

export type CommitmentDirection = "you_owe" | "they_owe";

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
