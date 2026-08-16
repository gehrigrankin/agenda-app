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
import {
  notes,
  people,
  personCommitments,
  personMentions,
  type Person,
} from "@/db/schema";
import { escapeLikePattern } from "@/server/notes";

/**
 * Data-access layer for people pages (`people` + `person_mentions` +
 * `person_commitments`). People are CONTACTS, added by hand — this feature is
 * fully AI-free. The name-match scanner below finds every note that mentions
 * a person's name (whole-word, case-insensitive) and builds their timeline;
 * it runs on visit and on demand via Rescan. Owe/owed commitments are entered
 * manually, never extracted.
 *
 * Idempotency: the (ownerId, nameKey) unique index dedupes people, and the
 * name-match rebuild replaces a person's mentions wholesale so re-runs converge.
 */

export type CommitmentDirection = "you_owe" | "they_owe";

export interface ContactInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  photoUrl?: string | null;
}

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
      phone: people.phone,
      email: people.email,
      photoUrl: people.photoUrl,
      isFavorite: people.isFavorite,
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
    .sort((a, b) =>
      a.isFavorite !== b.isFavorite
        ? Number(b.isFavorite) - Number(a.isFavorite)
        : (b.lastMentionedAt?.getTime() ?? 0) -
          (a.lastMentionedAt?.getTime() ?? 0),
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
 * Manually add a contact. Upserts on (ownerId, nameKey) so adding "Sam" when a
 * Sam already exists just returns the existing page rather than erroring.
 */
export async function createPerson(ownerId: string, name: string) {
  const clean = name.trim().slice(0, 120);
  const nameKey = clean.toLowerCase();
  if (!nameKey) return null;
  const [existing] = await db
    .select()
    .from(people)
    .where(and(eq(people.ownerId, ownerId), eq(people.nameKey, nameKey)))
    .limit(1);
  if (existing) return existing;
  const [person] = await db
    .insert(people)
    .values({ ownerId, name: clean, nameKey })
    .returning();
  return person;
}

export async function findContactDuplicates(
  ownerId: string,
  input: ContactInput,
) {
  const nameKey = input.name.trim().toLowerCase();
  const rows = await db
    .select()
    .from(people)
    .where(eq(people.ownerId, ownerId));
  const phone = input.phone?.replace(/\D/g, "") || "";
  const email = input.email?.trim().toLowerCase() || "";
  return rows.filter(
    (row) =>
      row.nameKey === nameKey ||
      (phone && row.phone?.replace(/\D/g, "") === phone) ||
      (email && row.email?.trim().toLowerCase() === email),
  );
}

export async function importContact(ownerId: string, input: ContactInput) {
  const name = input.name.trim().slice(0, 120);
  if (!name) return null;
  const [person] = await db
    .insert(people)
    .values({
      ownerId,
      name,
      nameKey: name.toLowerCase(),
      phone: input.phone?.trim().slice(0, 80) || null,
      email: input.email?.trim().slice(0, 254) || null,
      photoUrl: input.photoUrl?.trim() || null,
    })
    .returning();
  return person;
}

export async function updatePerson(
  ownerId: string,
  personId: string,
  input: ContactInput & { isFavorite?: boolean },
) {
  const clean = input.name.trim().slice(0, 120);
  if (!clean) return null;
  const [person] = await db
    .update(people)
    .set({
      name: clean,
      nameKey: clean.toLowerCase(),
      phone: input.phone?.trim().slice(0, 80) || null,
      email: input.email?.trim().slice(0, 254) || null,
      photoUrl: input.photoUrl?.trim() || null,
      ...(typeof input.isFavorite === "boolean"
        ? { isFavorite: input.isFavorite }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(people.id, personId), eq(people.ownerId, ownerId)))
    .returning();
  if (person) await rebuildMentionsForPersonId(ownerId, person.id);
  return person ?? null;
}

/**
 * Rename a contact. The (ownerId, nameKey) unique index would turn a rename
 * onto another contact's key into a raw DB error, so the collision is caught
 * here and named: merging two contacts is a different operation than renaming
 * one, and guessing wrong loses a timeline.
 */
export async function renamePerson(
  ownerId: string,
  personId: string,
  name: string,
): Promise<Person | null> {
  const clean = name.trim().slice(0, 120);
  const nameKey = clean.toLowerCase();
  if (!nameKey) return null;

  const [clash] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.ownerId, ownerId), eq(people.nameKey, nameKey)))
    .limit(1);
  // Same key on the same row is just a case/whitespace edit — let it through.
  if (clash && clash.id !== personId) {
    throw new Error("A contact named that already exists");
  }

  const [person] = await db
    .update(people)
    .set({ name: clean, nameKey, updatedAt: new Date() })
    .where(and(eq(people.id, personId), eq(people.ownerId, ownerId)))
    .returning();
  if (!person) return null;

  // Mentions are derived from the name, so the old set is stale the instant the
  // rename lands. The rename itself has already succeeded, though — a failed
  // rebuild must not surface as a failed rename, and Rescan repairs it anyway.
  try {
    await rebuildMentionsForPersonId(ownerId, person.id);
  } catch (err) {
    console.error("[people] mention rebuild after rename failed:", err);
  }
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
    rows.push({
      personId: person.id,
      ownerId,
      noteId: n.id,
      snippet,
      mentionDate,
    });
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
export async function rescanAllPeopleMentions(
  ownerId: string,
): Promise<number> {
  const ppl = await db
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(eq(people.ownerId, ownerId));
  for (const p of ppl) await rebuildMentionsForPerson(ownerId, p);
  return ppl.length;
}

/** Add a manual commitment (you-owe / they-owe) to a contact. Deduped by the
 * (personId, direction, text) unique index. Returns the row (existing or new). */
export async function addCommitment(
  ownerId: string,
  personId: string,
  direction: CommitmentDirection,
  text: string,
) {
  const clean = text.trim().slice(0, 300);
  if (!clean) return null;
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, personId), eq(people.ownerId, ownerId)))
    .limit(1);
  if (!person) return null;

  const [inserted] = await db
    .insert(personCommitments)
    .values({ personId, ownerId, direction, text: clean })
    .onConflictDoNothing({
      target: [
        personCommitments.personId,
        personCommitments.direction,
        personCommitments.text,
      ],
    })
    .returning();
  if (inserted) return inserted;
  // Dedupe hit — return the row that already existed.
  const [existing] = await db
    .select()
    .from(personCommitments)
    .where(
      and(
        eq(personCommitments.personId, personId),
        eq(personCommitments.direction, direction),
        eq(personCommitments.text, clean),
      ),
    )
    .limit(1);
  return existing ?? null;
}

/** Remove a commitment. */
export async function deleteCommitment(
  ownerId: string,
  id: string,
): Promise<void> {
  await db
    .delete(personCommitments)
    .where(
      and(eq(personCommitments.id, id), eq(personCommitments.ownerId, ownerId)),
    );
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
